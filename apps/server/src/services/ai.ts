import type { ProviderKind, RouteTask } from '@lumen/shared';
import { log } from '../core.ts';
import { errors } from '../core.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ResolvedStep {
  providerId: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; inputTokens: number | null; outputTokens: number | null };

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

// ---------- SSE helpers ----------
async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) throw errors.upstream('Provider returned an empty stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}

async function raiseUpstream(res: Response, provider: string): Promise<never> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // ignore body read failures
  }
  log('warn', 'ai.upstream-error', { provider, status: res.status, detail });
  throw errors.upstream(`Provider ${provider} failed (HTTP ${res.status})`);
}

// ---------- adapters ----------
async function* streamOpenAICompatible(step: ResolvedStep, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${step.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...(step.apiKey ? { authorization: `Bearer ${step.apiKey}` } : {}) },
    body: JSON.stringify({ model: step.model, messages, stream: true }),
    signal,
  });
  if (!res.ok) await raiseUpstream(res, step.label);
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let parsed: {
      choices?: { delta?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) yield { type: 'delta', text: delta };
    if (parsed.usage) yield { type: 'usage', inputTokens: parsed.usage.prompt_tokens ?? null, outputTokens: parsed.usage.completion_tokens ?? null };
  }
}

async function* streamAnthropic(step: ResolvedStep, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const res = await fetch(`${step.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'x-api-key': step.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: step.model,
      max_tokens: 4096,
      stream: true,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal,
  });
  if (!res.ok) await raiseUpstream(res, step.label);
  for await (const data of sseLines(res)) {
    let parsed: {
      type?: string;
      delta?: { text?: string };
      message?: { usage?: { input_tokens?: number } };
      usage?: { output_tokens?: number };
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (parsed.type === 'content_block_delta' && parsed.delta?.text) yield { type: 'delta', text: parsed.delta.text };
    if (parsed.type === 'message_start' && parsed.message?.usage) yield { type: 'usage', inputTokens: parsed.message.usage.input_tokens ?? null, outputTokens: null };
    if (parsed.type === 'message_delta' && parsed.usage) yield { type: 'usage', inputTokens: null, outputTokens: parsed.usage.output_tokens ?? null };
  }
}

async function* streamGemini(step: ResolvedStep, messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const base = step.baseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(step.model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'x-goog-api-key': step.apiKey ?? '' },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: rest.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    }),
    signal,
  });
  if (!res.ok) await raiseUpstream(res, step.label);
  for await (const data of sseLines(res)) {
    let parsed: {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (text) yield { type: 'delta', text };
    if (parsed.usageMetadata) yield { type: 'usage', inputTokens: parsed.usageMetadata.promptTokenCount ?? null, outputTokens: parsed.usageMetadata.candidatesTokenCount ?? null };
  }
}

function adapterFor(kind: ProviderKind) {
  if (kind === 'openai-compatible') return streamOpenAICompatible;
  if (kind === 'anthropic') return streamAnthropic;
  return streamGemini;
}

/**
 * Streams from one resolved step. Applies fallback ONLY while nothing has
 * been emitted to the client yet; once tokens stream, failures propagate.
 */
export async function* streamWithFallback(
  steps: ResolvedStep[],
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<StreamEvent & { step?: ResolvedStep }> {
  let lastError: unknown = null;
  for (const step of steps) {
    let emitted = false;
    try {
      for await (const event of adapterFor(step.kind)(step, messages, signal)) {
        emitted = emitted || event.type === 'delta';
        yield { ...event, step };
      }
      return;
    } catch (err) {
      if (signal.aborted) return;
      lastError = err;
      if (emitted) throw err;
      log('warn', 'ai.fallback', { provider: step.label, model: step.model, error: String(err) });
    }
  }
  if (lastError) throw lastError;
  throw errors.noProvider('No model is reachable for this task');
}

export async function completeChat(step: ResolvedStep, messages: ChatMessage[]): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }> {
  let text = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  for await (const event of adapterFor(step.kind)(step, messages, new AbortController().signal)) {
    if (event.type === 'delta') text += event.text;
    else {
      if (event.inputTokens !== null) inputTokens = event.inputTokens;
      if (event.outputTokens !== null) outputTokens = event.outputTokens;
    }
  }
  return { text, inputTokens, outputTokens };
}

// ---------- catalogue / testing ----------
export async function listModels(step: ResolvedStep): Promise<string[]> {
  const base = step.baseUrl.replace(/\/$/, '');
  let url: string;
  const headers: Record<string, string> = {};
  if (step.kind === 'anthropic') {
    url = `${base}/v1/models`;
    headers['x-api-key'] = step.apiKey ?? '';
    headers['anthropic-version'] = '2023-06-01';
  } else if (step.kind === 'gemini') {
    url = `${base}/v1beta/models`;
    headers['x-goog-api-key'] = step.apiKey ?? '';
  } else {
    url = `${base}/models`;
    if (step.apiKey) headers.authorization = `Bearer ${step.apiKey}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) await raiseUpstream(res, step.label);
  const body = (await res.json()) as {
    data?: { id?: string }[];
    models?: { name?: string }[];
  };
  if (Array.isArray(body.data)) return body.data.map((m) => m.id ?? '').filter(Boolean);
  if (Array.isArray(body.models)) return body.models.map((m) => (m.name ?? '').replace(/^models\//, '')).filter(Boolean);
  return [];
}

export function taskForConversation(kind: 'chat' | 'tutor'): RouteTask {
  return kind === 'tutor' ? 'tutor' : 'chat';
}
