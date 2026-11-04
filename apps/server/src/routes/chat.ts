import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { conversationCreateSchema, conversationPatchSchema, sendTurnSchema } from '@lumen/shared';
import { errors, log } from '../core.ts';
import { ChatRepo, messageDto } from '../repos/chat.ts';
import { LibraryRepo } from '../repos/library.ts';
import { buildTutorSystemPrompt, retrieveContext } from '../services/tutor.ts';
import { streamWithFallback, taskForConversation, type ChatMessage, type ResolvedStep } from '../services/ai.ts';
import { AiResolver } from '../services/tutor.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

function conversationDto(row: ReturnType<ChatRepo['list']>[number]) {
  return { id: row.id, kind: row.kind, title: row.title, documentId: row.document_id, updatedAt: row.updated_at };
}

export function chatRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const chat = new ChatRepo(deps.db);
  const library = new LibraryRepo(deps.db);
  const resolver = new AiResolver(deps.db, deps.masterKey, deps.config);

  r.get('/conversations', (c) => {
    const userId = requireUser(c);
    const q = c.req.query('kind');
    const kind = q === 'chat' || q === 'tutor' ? q : undefined;
    return c.json({ conversations: chat.list(userId, kind).map(conversationDto) });
  });

  r.post('/conversations', async (c) => {
    const userId = requireUser(c);
    const input = conversationCreateSchema.parse(await c.req.json());
    if (input.documentId && !library.document(userId, input.documentId)) throw errors.badRequest('Unknown document');
    const title = input.title ?? (input.kind === 'tutor' ? 'New tutoring session' : 'New chat');
    const row = chat.create(userId, input.kind, title, input.documentId ?? null);
    return c.json({ conversation: conversationDto(row) }, 201);
  });

  r.get('/conversations/:id', (c) => {
    const userId = requireUser(c);
    const row = chat.conversation(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Conversation not found');
    return c.json({
      conversation: conversationDto(row),
      messages: chat.messages(row.id).map(messageDto),
    });
  });

  r.patch('/conversations/:id', async (c) => {
    const userId = requireUser(c);
    const row = chat.conversation(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Conversation not found');
    const input = conversationPatchSchema.parse(await c.req.json());
    chat.rename(userId, row.id, input.title);
    return c.json({ conversation: conversationDto({ ...row, title: input.title }) });
  });

  r.delete('/conversations/:id', (c) => {
    const userId = requireUser(c);
    const row = chat.conversation(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Conversation not found');
    deps.chatCancels.get(row.id)?.abort();
    chat.delete(userId, row.id);
    return c.json({ ok: true });
  });

  r.post('/conversations/:id/cancel', (c) => {
    const userId = requireUser(c);
    const row = chat.conversation(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Conversation not found');
    const controller = deps.chatCancels.get(row.id);
    if (controller) controller.abort();
    return c.json({ ok: true });
  });

  /**
   * Send one user turn; streams the assistant reply over SSE.
   * Events: `meta` (citations, model), `delta` (text), `done` (message id),
   * `error` (typed failure). The user message persists BEFORE streaming so a
   * mid-stream failure never duplicates or loses the turn.
   */
  r.post('/conversations/:id/turn', async (c) => {
    const userId = requireUser(c);
    const row = chat.conversation(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Conversation not found');
    const input = sendTurnSchema.parse(await c.req.json());
    if (deps.chatCancels.has(row.id)) throw errors.conflict('A turn is already in flight — cancel it first');

    const document = (row.document_id ? library.document(userId, row.document_id) : null) ?? null;
    const isTutor = row.kind === 'tutor';
    let citations: Awaited<ReturnType<typeof retrieveContext>>[number]['dto'][] = [];
    const messages: ChatMessage[] = [];

    if (isTutor) {
      const retrieved = await retrieveContext(deps.db, userId, document, input.content);
      citations = retrieved.map((r) => r.dto);
      messages.push({ role: 'system', content: buildTutorSystemPrompt(citations, document) });
    }
    for (const m of chat.recentMessages(row.id, 12)) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: input.content });
    chat.append(row.id, 'user', input.content, [], null);

    const task = taskForConversation(row.kind);
    let steps: ResolvedStep[];
    try {
      steps = resolver.resolve(userId, task);
    } catch (err) {
      // Persist nothing further; surface the typed error to the client.
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: err instanceof Error && 'status' in err ? (err as { status: number }).status : 503, message: err instanceof Error ? err.message : 'No provider' }) });
      });
    }

    const controller = new AbortController();
    deps.chatCancels.set(row.id, controller);
    const primary = steps[0]!;

    return streamSSE(c, async (stream) => {
      try {
        await stream.writeSSE({ event: 'meta', data: JSON.stringify({ citations, model: primary.model, provider: primary.label }) });
        let full = '';
        let model = primary.model;
        for await (const event of streamWithFallback(steps, messages, controller.signal)) {
          if (controller.signal.aborted) break;
          if (event.type === 'delta') {
            full += event.text;
            await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.text }) });
          } else if (event.step) {
            model = event.step.model;
          }
        }
        if (controller.signal.aborted && full.length === 0) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 499, message: 'Turn cancelled' }) });
          return;
        }
        const saved = chat.append(row.id, 'assistant', full, citations, model);
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ message: messageDto(saved) }) });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Generation failed';
        log('warn', 'chat.turn-failed', { conversationId: row.id, error: message });
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 502, message }) });
      } finally {
        deps.chatCancels.delete(row.id);
      }
    });
  });

  return r;
}
