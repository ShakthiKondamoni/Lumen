import { Hono } from 'hono';
import { cardCreateSchema, deckCreateSchema, gradeSchema } from '@lumen/shared';
import { errors } from '../core.ts';
import { IdentityRepo } from '../repos/identity.ts';
import { ReviewRepo } from '../repos/review.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

export function cardDto(row: ReturnType<ReviewRepo['addCard']>, deckName: string) {
  return {
    id: row.id,
    deckId: row.deck_id,
    deckName,
    front: row.front,
    back: row.back,
    state: row.state,
    due: row.due,
    sourceDocumentId: row.source_document_id,
  };
}

export function reviewRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const review = new ReviewRepo(deps.db);
  const identity = new IdentityRepo(deps.db);

  r.get('/decks', (c) => {
    const userId = requireUser(c);
    return c.json({
      decks: review.decks(userId).map((d) => ({ id: d.id, name: d.name, subjectId: d.subject_id, newCount: d.new_count, dueCount: d.due_count })),
    });
  });

  r.post('/decks', async (c) => {
    const userId = requireUser(c);
    const input = deckCreateSchema.parse(await c.req.json());
    const row = review.createDeck(userId, input.name, input.subjectId ?? null);
    return c.json({ deck: { id: row.id, name: row.name, subjectId: row.subject_id, newCount: 0, dueCount: 0 } }, 201);
  });

  r.delete('/decks/:id', (c) => {
    const userId = requireUser(c);
    review.deleteDeck(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  r.post('/decks/:id/cards', async (c) => {
    const userId = requireUser(c);
    const deckId = c.req.param('id');
    const input = cardCreateSchema.parse(await c.req.json());
    const deck = review.decks(userId).find((d) => d.id === deckId);
    if (!deck) throw errors.badRequest('Unknown deck');
    const created = [];
    const count = input.count ?? 1;
    for (let i = 0; i < count; i++) {
      const front = count > 1 ? `${input.front} (${i + 1})` : input.front;
      const back = count > 1 ? `${input.back} (${i + 1})` : input.back;
      created.push(cardDto(review.addCard(userId, deckId, front, back, null, new Date()), deck.name));
    }
    return c.json({ cards: created }, 201);
  });

  r.delete('/cards/:id', (c) => {
    const userId = requireUser(c);
    review.deleteCard(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  r.get('/review/queue', (c) => {
    const userId = requireUser(c);
    const newLimit = Math.min(Number(c.req.query('new') ?? 10) || 10, 50);
    const dueLimit = Math.min(Number(c.req.query('due') ?? 40) || 40, 200);
    const queue = review.reviewQueue(userId, newLimit, dueLimit, new Date());
    const names = new Map(review.decks(userId).map((d) => [d.id, d.name]));
    return c.json({ queue: queue.map((row) => cardDto(row, names.get(row.deck_id) ?? 'Deck')), remaining: queue.length });
  });

  r.post('/review/cards/:id/grade', async (c) => {
    const userId = requireUser(c);
    const input = gradeSchema.parse(await c.req.json());
    const settings = identity.getSettings(userId);
    const updated = review.applyReview(userId, c.req.param('id'), input, new Date(), settings.desiredRetention);
    if (!updated) throw errors.notFound('Card not found');
    const queue = review.reviewQueue(userId, 0, 1000, new Date());
    const names = new Map(review.decks(userId).map((d) => [d.id, d.name]));
    return c.json({ result: { card: cardDto(updated, names.get(updated.deck_id) ?? 'Deck'), remaining: queue.length } });
  });

  return r;
}
