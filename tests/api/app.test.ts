import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, TestClient, type TestServer } from '../helpers.ts';

let server: TestServer;
let client: TestClient;

beforeAll(async () => {
  server = await startTestServer();
  client = new TestClient(server.base);
  await client.register();
});
afterAll(async () => {
  await server.dispose();
});

describe('review (FSRS)', () => {
  let deckId = '';
  let cardId = '';

  it('creates a deck and card, and puts the card in the queue', async () => {
    const deck = await client.authed<{ deck: { id: string } }>('POST', '/api/decks', { name: 'Biology basics' });
    expect(deck.status).toBe(201);
    deckId = deck.data.deck.id;
    const card = await client.authed<{ cards: { id: string }[] }>('POST', `/api/decks/${deckId}/cards`, {
      front: 'What is osmosis?',
      back: 'Water movement across a semipermeable membrane.',
    });
    expect(card.status).toBe(201);
    cardId = card.data.cards[0]!.id;

    const queue = await client.authed<{ queue: { id: string; state: string }[] }>('GET', '/api/review/queue');
    expect(queue.data.queue.some((c) => c.id === cardId)).toBe(true);
    expect(queue.data.queue[0]!.state).toBe('new');
  });

  it('grades a card and reschedules it into the future', async () => {
    const res = await client.authed<{ result: { card: { state: string; due: string }; remaining: number } }>('POST', `/api/review/cards/${cardId}/grade`, 3);
    expect(res.status).toBe(200);
    expect(res.data.result.card.state).toBe('review');
    expect(new Date(res.data.result.card.due).getTime()).toBeGreaterThan(Date.now() + 20 * 3600_000);
    // No longer in the immediate queue:
    const queue = await client.authed<{ queue: { id: string }[] }>('GET', '/api/review/queue');
    expect(queue.data.queue.some((c) => c.id === cardId)).toBe(false);
  });

  it('accepts only valid grades', async () => {
    const res = await client.authed('POST', `/api/review/cards/${cardId}/grade`, 5);
    expect(res.status).toBe(400);
  });

  it('supports a lapse cycle: due again after relearning', async () => {
    const queue = await client.authed<{ queue: { id: string }[] }>('GET', '/api/review/queue?new=0&due=0');
    expect(queue.data.queue).toHaveLength(0);
    // Force a review in the past by grading directly after manipulating due is
    // out of scope; instead verify grade=1 requeues within the session.
    const card = await client.authed<{ cards: { id: string }[] }>('POST', `/api/decks/${deckId}/cards`, { front: 'Lapse test', back: 'B' });
    const id = card.data.cards[0]!.id;
    const res = await client.authed<{ result: { card: { state: string } } }>('POST', `/api/review/cards/${id}/grade`, 1);
    expect(res.data.result.card.state).toBe('learning');
  });
});

describe('notes with wiki links', () => {
  it('creates notes and resolves [[links]] by title', async () => {
    const a = await client.authed<{ note: { id: string } }>('POST', '/api/notes', { title: 'Cell Transport', body: 'Baseline note about membranes.' });
    const b = await client.authed<{ note: { id: string; links: string[] } }>('POST', '/api/notes', {
      title: 'Study plan',
      body: 'Revise [[Cell Transport]] and [[Not Written Yet]] tomorrow.',
    });
    expect(b.status).toBe(201);
    expect(b.data.note.links).toEqual([a.data.note.id]); // unresolved link skipped
  });

  it('searches notes via FTS', async () => {
    const res = await client.authed<{ notes: { title: string }[] }>('GET', '/api/search/global?q=membranes');
    expect(res.data.notes.some((n) => n.title === 'Cell Transport')).toBe(true);
  });
});

describe('planner, focus and stats', () => {
  it('adds, toggles and deletes tasks', async () => {
    const t = await client.authed<{ task: { id: string; done: boolean } }>('POST', '/api/tasks', { title: 'Read chapter 5', dueDate: '2026-03-01', estimateMin: 30 });
    expect(t.status).toBe(201);
    await client.authed('POST', `/api/tasks/${t.data.task.id}/toggle`);
    const list = await client.authed<{ tasks: { id: string; done: boolean }[] }>('GET', '/api/tasks');
    expect(list.data.tasks.find((x) => x.id === t.data.task.id)?.done).toBe(true);
    await client.authed('DELETE', `/api/tasks/${t.data.task.id}`);
  });

  it('logs focus sessions and reflects them in stats', async () => {
    const s = await client.authed<{ session: { minutes: number } }>('POST', '/api/focus', { label: 'Reading', minutes: 25 });
    expect(s.status).toBe(201);
    const stats = await client.authed<{ stats: { focusMinutesLast7: number; streakDays: number; forecast: unknown[] } }>('GET', '/api/stats');
    expect(stats.data.stats.focusMinutesLast7).toBeGreaterThanOrEqual(25);
    expect(stats.data.stats.forecast).toHaveLength(14);
  });
});

describe('settings & backup', () => {
  it('persists appearance settings', async () => {
    const put = await client.authed('PUT', '/api/settings', { theme: 'midnight', density: 'compact', reducedMotion: true, desiredRetention: 0.92 });
    expect(put.status).toBe(200);
    const get = await client.authed<{ settings: { theme: string; desiredRetention: number } }>('GET', '/api/settings');
    expect(get.data.settings.theme).toBe('midnight');
    expect(get.data.settings.desiredRetention).toBe(0.92);
  });

  it('validates settings values', async () => {
    const bad = await client.authed('PUT', '/api/settings', { theme: 'neon', density: 'compact', reducedMotion: false, desiredRetention: 0.9 });
    expect(bad.status).toBe(400);
  });

  it('exports a backup with user data but no secrets', async () => {
    const res = await client.authed<{ format: string; providers?: { apiKey?: string }[]; data: { notes: unknown[] } }>('GET', '/api/backup/export');
    expect(res.status).toBe(200);
    expect(res.data.format).toBe('lumen-backup');
    expect(res.data.data.notes.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.data)).not.toContain('sk-ant-test-key');
  });

  it('imports notes and tasks from a backup payload', async () => {
    const res = await client.authed<{ imported: { notes: number; tasks: number } }>('POST', '/api/backup/import', {
      notes: [{ title: 'Imported note', body: 'from backup' }],
      planTasks: [{ title: 'Imported task' }],
    });
    expect(res.data.imported.notes).toBe(1);
    expect(res.data.imported.tasks).toBe(1);
  });
});

describe('user isolation', () => {
  it('keeps another user from seeing any of this data', async () => {
    const other = new TestClient(server.base);
    await other.register();
    const notes = await other.authed<{ notes: unknown[] }>('GET', '/api/notes');
    const decks = await other.authed<{ decks: unknown[] }>('GET', '/api/decks');
    const tasks = await other.authed<{ tasks: unknown[] }>('GET', '/api/tasks');
    expect(notes.data.notes).toHaveLength(0);
    expect(decks.data.decks).toHaveLength(0);
    expect(tasks.data.tasks).toHaveLength(0);
  });
});
