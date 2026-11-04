import type { Db } from '../db/db.ts';
import { errors } from '../core.ts';
import { IdentityRepo } from '../repos/identity.ts';
import { LibraryRepo } from '../repos/library.ts';
import { NotesRepo } from '../repos/notes.ts';
import { ReviewRepo } from '../repos/review.ts';
import { PlanRepo } from '../repos/plan.ts';

/**
 * JSON backup of one user's data. Files (originals) are not included — the
 * export records their titles/metadata so the scope is explicit.
 */
export function exportBackup(db: Db, userId: string): Record<string, unknown> {
  // Tables with a direct user_id column…
  const direct = [
    'subjects',
    'documents',
    'conversations',
    'notes',
    'decks',
    'cards',
    'review_log',
    'quizzes',
    'quiz_attempts',
    'plan_tasks',
    'focus_sessions',
    'concepts',
    'concept_edges',
  ] as const;
  // …and child tables scoped through their parents.
  const joined: Record<string, string> = {
    messages: 'SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = ?',
    note_links: 'SELECT nl.* FROM note_links nl JOIN notes n ON n.id = nl.src_note_id WHERE n.user_id = ?',
    quiz_questions: 'SELECT qq.* FROM quiz_questions qq JOIN quizzes q ON q.id = qq.quiz_id WHERE q.user_id = ?',
  };
  const data: Record<string, unknown> = {};
  for (const t of direct) {
    data[t] = db.all(`SELECT * FROM ${t} WHERE user_id = ?`, userId);
  }
  for (const [t, sql] of Object.entries(joined)) {
    data[t] = db.all(sql, userId);
  }
  const identity = new IdentityRepo(db);
  return {
    format: 'lumen-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: publicProfile(db, userId),
    settings: identity.getSettings(userId),
    providers: db
      .all<{ kind: string; label: string; base_url: string }>('SELECT kind, label, base_url FROM providers WHERE user_id = ?', userId)
      .map((p) => ({ ...p, apiKey: '(not exported)' })),
    modelRoutes: db.all('SELECT task, steps_json FROM model_routes WHERE user_id = ?', userId),
    data,
  };
}

function publicProfile(db: Db, userId: string) {
  const u = new IdentityRepo(db).userById(userId);
  return u ? { email: u.email, name: u.name } : null;
}

/** Replace-all import for notes, tasks and decks (the three mutable corpora). */
export function importBackup(db: Db, userId: string, backup: { notes?: { title: string; body: string }[]; planTasks?: { title: string; dueDate?: string | null }[]; decks?: { name: string; cards: { front: string; back: string }[] }[] }): { notes: number; tasks: number; cards: number } {
  const notes = new NotesRepo(db);
  const plan = new PlanRepo(db);
  const review = new ReviewRepo(db);
  let noteCount = 0;
  let taskCount = 0;
  let cardCount = 0;
  for (const n of backup.notes ?? []) {
    notes.upsert(userId, undefined, String(n.title).slice(0, 160), String(n.body ?? ''));
    noteCount++;
  }
  for (const t of backup.planTasks ?? []) {
    plan.createTask(userId, String(t.title).slice(0, 160), null, t.dueDate ?? null, null);
    taskCount++;
  }
  for (const d of backup.decks ?? []) {
    const deck = review.createDeck(userId, String(d.name).slice(0, 80), null);
    for (const c of d.cards ?? []) {
      review.addCard(userId, deck.id, String(c.front), String(c.back), null, new Date());
      cardCount++;
    }
  }
  return { notes: noteCount, tasks: taskCount, cards: cardCount };
}

export function assertOwnedDocument(db: Db, userId: string, documentId: string) {
  const doc = new LibraryRepo(db).document(userId, documentId);
  if (!doc) throw errors.notFound('Document not found');
  return doc;
}
