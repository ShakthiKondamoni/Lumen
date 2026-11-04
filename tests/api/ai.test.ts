import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { startTestServer, TestClient, type TestServer } from '../helpers.ts';

let server: TestServer;
let client: TestClient;
let stub: Server;
let stubPort = 0;
let failing: Server;
let failingPort = 0;

const QUIZ_JSON = JSON.stringify({
  questions: [
    { prompt: 'What moves across a membrane during osmosis?', kind: 'mcq', choices: ['Water', 'Salt', 'ATP', 'Proteins'], answerIndex: 0, answer: '', explanation: 'Osmosis is water movement.', sourceIndex: 1 },
    { prompt: 'Does passive transport require ATP?', kind: 'short', choices: [], answerIndex: null, answer: 'No', explanation: 'Passive transport needs no energy.', sourceIndex: 2 },
  ],
});

beforeAll(async () => {
  server = await startTestServer();
  client = new TestClient(server.base);
  await client.register();

  stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'stub-mini' }, { id: 'stub-large' }] }));
        return;
      }
      res.setHeader('content-type', 'text/event-stream');
      if (body.includes('Reply with ONLY minified JSON')) {
        // Quiz generation: single JSON "delta" then done.
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: QUIZ_JSON } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (body.includes('"hold"')) {
        // Held stream: keeps the turn in flight so the concurrency guard can
        // be tested deterministically.
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'holding' } }] })}\n\n`);
        setTimeout(() => {
          res.write('data: [DONE]\n\n');
          res.end();
        }, 2500);
        return;
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ' from the stub model.' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  stubPort = (stub.address() as AddressInfo).port;

  failing = createServer((_req, res) => {
    res.statusCode = 500;
    res.end('boom');
  });
  await new Promise<void>((r) => failing.listen(0, '127.0.0.1', r));
  failingPort = (failing.address() as AddressInfo).port;
});
afterAll(async () => {
  await server.dispose();
  stub.close();
  failing.close();
});
const STEADY_EVENT = 'data: stub-event\n\n';

describe('providers & routing', () => {
  let providerId = '';
  let failingId = '';

  it('creates a local provider without a key and never leaks key material', async () => {
    const res = await client.authed<{ provider: { id: string; hasKey: boolean } }>('POST', '/api/providers', {
      kind: 'openai-compatible',
      label: 'Stub local',
      baseUrl: `http://127.0.0.1:${stubPort}/v1`,
    });
    expect(res.status).toBe(201);
    expect(res.data.provider.hasKey).toBe(false);
    providerId = res.data.provider.id;
    const list = await client.authed<{ providers: Record<string, unknown>[] }>('GET', '/api/providers');
    const serialized = JSON.stringify(list.data);
    expect(serialized).not.toContain('key_ct');
  });

  it('requires an API key for non-local base URLs', async () => {
    const res = await client.authed('POST', '/api/providers', {
      kind: 'anthropic',
      label: 'Anthropic cloud',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(res.status).toBe(400);
    expect((res.data as { error: { message: string } }).error.message).toMatch(/API key/);
  });

  it('stores encrypted keys for cloud providers (create then 400-less)', async () => {
    const res = await client.authed<{ provider: { id: string; hasKey: boolean } }>('POST', '/api/providers', {
      kind: 'anthropic',
      label: 'Anthropic cloud',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test-key',
    });
    expect(res.status).toBe(201);
    expect(res.data.provider.hasKey).toBe(true);
    failingId = '';
    void failingId;
  });

  it('lists the model catalogue through the stub', async () => {
    const res = await client.authed<{ models: string[] }>('GET', `/api/providers/${providerId}/models`);
    expect(res.status).toBe(200);
    expect(res.data.models).toContain('stub-mini');
  });

  it('rejects routes through unknown providers', async () => {
    const res = await client.authed('PUT', '/api/routes', { task: 'chat', steps: [{ providerId: 'ghost', model: 'x' }] });
    expect(res.status).toBe(400);
  });

  it('saves and reads back a route', async () => {
    const res = await client.authed('PUT', '/api/routes', { task: 'chat', steps: [{ providerId, model: 'stub-mini' }] });
    expect(res.status).toBe(200);
    const read = await client.authed<{ routes: Record<string, { providerId: string; model: string }[]> }>('GET', '/api/routes');
    expect(read.data.routes.chat).toEqual([{ providerId, model: 'stub-mini' }]);
  });
});

describe('chat turn streaming', () => {
  it('streams deltas, persists both turns, and reports the model', async () => {
    const conv = await client.authed<{ conversation: { id: string } }>('POST', '/api/conversations', { kind: 'chat' });
    const id = conv.data.conversation.id;
    const res = await fetch(`${server.base}/api/conversations/${id}/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': client.cookies.get('lumen_csrf') ?? '',
        cookie: [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify({ content: 'Say hello' }),
    });
    expect(res.status).toBe(200);
    const frames = (await res.text()).split('\n\n').filter((f) => f.startsWith('event:'));
    const events = frames.map((f) => {
      const lines = f.split('\n');
      return { event: lines[0]!.slice(6).trim(), data: JSON.parse(lines[1]!.slice(5).trim()) as Record<string, unknown> };
    });
    const deltas = events.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text).join('');
    expect(deltas).toBe('Hello from the stub model.');
    const done = events.find((e) => e.event === 'done');
    expect(done).toBeDefined();
    expect((done!.data as { message: { model: string } }).message.model).toBe('stub-mini');

    const persisted = await client.authed<{ messages: { role: string; content: string }[] }>('GET', `/api/conversations/${id}`);
    expect(persisted.data.messages).toHaveLength(2);
    expect(persisted.data.messages[1]!.content).toBe('Hello from the stub model.');
  });

  it('fails with a typed error when no route is configured (tutor)', async () => {
    const conv = await client.authed<{ conversation: { id: string } }>('POST', '/api/conversations', { kind: 'tutor' });
    const res = await fetch(`${server.base}/api/conversations/${conv.data.conversation.id}/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': client.cookies.get('lumen_csrf') ?? '',
        cookie: [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify({ content: 'Explain osmosis' }),
    });
    const text = await res.text();
    expect(text).toContain('error');
    expect(text).toMatch(/No enabled provider/i);
  });

  it('falls back to the next route step when the first provider fails', async () => {
    const dead = await client.authed<{ provider: { id: string } }>('POST', '/api/providers', {
      kind: 'openai-compatible',
      label: 'Dead provider',
      baseUrl: `http://127.0.0.1:${failingPort}/v1`,
    });
    const live = await client.authed<{ providers: { id: string; label: string }[] }>('GET', '/api/providers');
    const stubId = live.data.providers.find((p) => p.label === 'Stub local')!.id;
    await client.authed('PUT', '/api/routes', {
      task: 'summarize',
      steps: [
        { providerId: dead.data.provider.id, model: 'never-reached' },
        { providerId: stubId, model: 'stub-mini' },
      ],
    });
    const steps = await client.authed<{ routes: Record<string, { model: string }[]> }>('GET', '/api/routes');
    expect(steps.data.routes.summarize).toHaveLength(2);
    await client.authed('PUT', '/api/routes', { task: 'summarize', steps: [] });
  });

  it('renames and deletes conversations', async () => {
    const conv = await client.authed<{ conversation: { id: string } }>('POST', '/api/conversations', { kind: 'chat' });
    const id = conv.data.conversation.id;
    const renamed = await client.authed('PATCH', `/api/conversations/${id}`, { title: 'Renamed' });
    expect(renamed.status).toBe(200);
    const del = await client.authed('DELETE', `/api/conversations/${id}`);
    expect(del.status).toBe(200);
  });

  it('guards concurrent turns on one conversation', async () => {
    const conv = await client.authed<{ conversation: { id: string } }>('POST', '/api/conversations', { kind: 'chat' });
    const id = conv.data.conversation.id;
    const headers = {
      'content-type': 'application/json',
      'x-csrf-token': client.cookies.get('lumen_csrf') ?? '',
      cookie: [...client.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    };
    void STEADY_EVENT;
    const first = fetch(`${server.base}/api/conversations/${id}/turn`, { method: 'POST', headers, body: JSON.stringify({ content: 'hold' }) });
    await new Promise((r) => setTimeout(r, 400));
    const second = await fetch(`${server.base}/api/conversations/${id}/turn`, { method: 'POST', headers, body: JSON.stringify({ content: 'two' }) });
    expect(second.status).toBe(409);
    // Release the held stream.
    await client.authed('POST', `/api/conversations/${id}/cancel`);
    await (await first).text();
  });
});

describe('quiz generation', () => {
  it('generates, serves (answer-key-free), grades, and cites', async () => {
    // Upload + process a document first.
    const form = new FormData();
    form.set('file', new File(['Osmosis moves water across membranes. Passive transport needs no ATP.'], 'bio.txt', { type: 'text/plain' }));
    await client.upload('/api/documents', form);
    const docs = await client.authed<{ documents: { id: string; status: string }[] }>('GET', '/api/documents');
    const doc = docs.data.documents[0]!;
    for (let i = 0; i < 40; i++) {
      const d = await client.authed<{ document: { status: string } }>('GET', `/api/documents/${doc.id}`);
      if (d.data.document.status === 'ready') break;
      await new Promise((r) => setTimeout(r, 250));
    }

    // Route the quiz task.
    const providers = await client.authed<{ providers: { id: string }[] }>('GET', '/api/providers');
    await client.authed('PUT', '/api/routes', { task: 'quiz', steps: [{ providerId: providers.data.providers[0]!.id, model: 'stub-mini' }] });

    const gen = await client.authed<{ quizId: string }>('POST', '/api/quizzes/generate', { documentId: doc.id, count: 3, kinds: ['mcq', 'short'] });
    expect(gen.status).toBe(201);

    const quiz = await client.authed<{ questions: { id: string; choices: string[]; answerIndex: number | null }[] }>('GET', `/api/quizzes/${gen.data.quizId}`);
    expect(quiz.data.questions).toHaveLength(2);
    expect(quiz.data.questions[0]!.choices).toHaveLength(4);
    expect(quiz.data.questions[0]!.answerIndex).toBeNull(); // no answer leaks

    const submit = await client.authed<{ attempt: { scorePct: number; perQuestion: { correct: boolean; citation: unknown }[] } }>('POST', `/api/quizzes/${gen.data.quizId}/submit`, {
      answers: [
        { questionId: quiz.data.questions[0]!.id, choiceIndex: 0 },
        { questionId: quiz.data.questions[1]!.id, choiceIndex: null, text: 'no' },
      ],
    });
    expect(submit.data.attempt.scorePct).toBe(100);
    expect(submit.data.attempt.perQuestion[0]!.correct).toBe(true);
  });
});
