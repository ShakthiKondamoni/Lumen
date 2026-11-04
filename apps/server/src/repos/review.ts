import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import { initMemory, reviewMemory, type FSRSMemory, type Grade } from '@lumen/shared';

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  subject_id: string | null;
}

export interface CardRow {
  id: string;
  user_id: string;
  deck_id: string;
  front: string;
  back: string;
  source_document_id: string | null;
  state: FSRSMemory['state'];
  stability: number;
  difficulty: number;
  due: string;
  last_review: string | null;
  reps: number;
  lapses: number;
  suspended: number;
}

const MEMORY_COLS = 'state, stability, difficulty, due, last_review, reps, lapses' as const;

function memoryOf(row: CardRow): FSRSMemory {
  return {
    stability: row.stability,
    difficulty: row.difficulty,
    state: row.state,
    due: row.due,
    lastReview: row.last_review,
    reps: row.reps,
    lapses: row.lapses,
  };
}

export class ReviewRepo {
  constructor(private readonly db: Db) {}

  // ----- decks -----
  decks(userId: string): (DeckRow & { new_count: number; due_count: number })[] {
    const now = new Date().toISOString();
    return this.db.all<DeckRow & { new_count: number; due_count: number }>(
      `SELECT d.*,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.state = 'new' AND c.suspended = 0) AS new_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.state != 'new' AND c.due <= ? AND c.suspended = 0) AS due_count
       FROM decks d WHERE d.user_id = ? ORDER BY d.name`,
      now,
      userId,
    );
  }

  createDeck(userId: string, name: string, subjectId: string | null): DeckRow {
    const row: DeckRow = { id: randomUUID(), user_id: userId, name, subject_id: subjectId };
    this.db.run('INSERT INTO decks (id, user_id, name, subject_id, created_at) VALUES (?, ?, ?, ?, ?)', row.id, userId, name, subjectId, new Date().toISOString());
    return row;
  }

  deleteDeck(userId: string, id: string): void {
    this.db.run('DELETE FROM decks WHERE user_id = ? AND id = ?', userId, id);
  }

  // ----- cards -----
  addCard(userId: string, deckId: string, front: string, back: string, sourceDocumentId: string | null, now: Date): CardRow {
    const mem = initMemory(now);
    const row: CardRow = {
      id: randomUUID(),
      user_id: userId,
      deck_id: deckId,
      front,
      back,
      source_document_id: sourceDocumentId,
      state: mem.state,
      stability: mem.stability,
      difficulty: mem.difficulty,
      due: mem.due,
      last_review: mem.lastReview,
      reps: mem.reps,
      lapses: mem.lapses,
      suspended: 0,
    };
    this.db.run(
      `INSERT INTO cards (id, user_id, deck_id, front, back, source_document_id, state, stability, difficulty, due, last_review, reps, lapses, suspended, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      row.id, userId, deckId, front, back, sourceDocumentId,
      row.state, row.stability, row.difficulty, row.due, row.last_review, row.reps, row.lapses, now.toISOString(),
    );
    return row;
  }

  card(userId: string, id: string): CardRow | undefined {
    return this.db.get<CardRow>('SELECT * FROM cards WHERE user_id = ? AND id = ?', userId, id);
  }

  deleteCard(userId: string, id: string): void {
    this.db.run('DELETE FROM cards WHERE user_id = ? AND id = ?', userId, id);
  }

  /** The daily queue: new cards interleaved with due cards, capped. */
  reviewQueue(userId: string, newLimit: number, dueLimit: number, now: Date): CardRow[] {
    const nowIso = now.toISOString();
    const due = this.db.all<CardRow>(
      `SELECT * FROM cards WHERE user_id = ? AND suspended = 0 AND state != 'new' AND due <= ?
       ORDER BY due LIMIT ?`,
      userId, nowIso, dueLimit,
    );
    const fresh = this.db.all<CardRow>(
      `SELECT * FROM cards WHERE user_id = ? AND suspended = 0 AND state = 'new'
       ORDER BY created_at LIMIT ?`,
      userId, newLimit,
    );
    // Interleave: alternate due/new so new material is spread through the session.
    const queue: CardRow[] = [];
    let di = 0;
    let ni = 0;
    while (di < due.length || ni < fresh.length) {
      if (di < due.length) queue.push(due[di++]!);
      if (ni < fresh.length) queue.push(fresh[ni++]!);
    }
    return queue;
  }

  applyReview(userId: string, cardId: string, grade: Grade, now: Date, desiredRetention: number): CardRow | undefined {
    const row = this.card(userId, cardId);
    if (!row) return undefined;
    const mem = reviewMemory(memoryOf(row), grade, now, desiredRetention);
    this.db.run(
      `UPDATE cards SET state = ?, stability = ?, difficulty = ?, due = ?, last_review = ?, reps = ?, lapses = ? WHERE user_id = ? AND id = ?`,
      mem.state, mem.stability, mem.difficulty, mem.due, mem.lastReview, mem.reps, mem.lapses, userId, cardId,
    );
    this.db.run(
      'INSERT INTO review_log (id, user_id, card_id, grade, reviewed_at) VALUES (?, ?, ?, ?, ?)',
      randomUUID(), userId, cardId, grade, now.toISOString(),
    );
    return this.card(userId, cardId);
  }

  // ----- stats -----
  reviewedCount(userId: string, sinceIso: string): number {
    const row = this.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM review_log WHERE user_id = ? AND reviewed_at >= ?',
      userId, sinceIso,
    );
    return row?.n ?? 0;
  }

  /** Day-by-day due counts for the next N days (forecast). */
  forecast(userId: string, days: number, now: Date): { day: string; due: number }[] {
    const rows = this.db.all<{ due_day: string; n: number }>(
      `SELECT substr(due, 1, 10) AS due_day, COUNT(*) AS n FROM cards
       WHERE user_id = ? AND suspended = 0 AND state != 'new' AND due <= ?
       GROUP BY due_day`,
      userId,
      new Date(now.getTime() + days * 86_400_000).toISOString(),
    );
    const byDay = new Map(rows.map((r) => [r.due_day, r.n]));
    const out: { day: string; due: number }[] = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(now.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day, due: byDay.get(day) ?? 0 });
    }
    return out;
  }
}

export { MEMORY_COLS };
