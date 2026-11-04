import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';

export interface QuizRow {
  id: string;
  user_id: string;
  title: string;
  kind: 'practice' | 'mock';
  document_id: string | null;
  time_limit_min: number | null;
  created_at: string;
}

export interface QuestionRow {
  id: string;
  quiz_id: string;
  ordinal: number;
  prompt: string;
  choices: string; // JSON array; empty for short-answer
  answer_index: number | null;
  answer_text: string | null;
  explanation: string;
  chunk_id: string | null;
}

export interface AttemptRow {
  id: string;
  quiz_id: string;
  user_id: string;
  score_pct: number;
  detail: string; // JSON per-question results
  started_at: string;
  finished_at: string;
}

export class QuizRepo {
  constructor(private readonly db: Db) {}

  create(userId: string, title: string, kind: 'practice' | 'mock', documentId: string | null, timeLimitMin: number | null): QuizRow {
    const row: QuizRow = { id: randomUUID(), user_id: userId, title, kind, document_id: documentId, time_limit_min: timeLimitMin, created_at: new Date().toISOString() };
    this.db.run(
      'INSERT INTO quizzes (id, user_id, title, kind, document_id, time_limit_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id, userId, title, kind, documentId, timeLimitMin, row.created_at,
    );
    return row;
  }

  quiz(userId: string, id: string): QuizRow | undefined {
    return this.db.get<QuizRow>('SELECT * FROM quizzes WHERE user_id = ? AND id = ?', userId, id);
  }

  list(userId: string): (QuizRow & { question_count: number; best_score: number | null })[] {
    return this.db.all<QuizRow & { question_count: number; best_score: number | null }>(
      `SELECT q.*,
        (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
        (SELECT MAX(a.score_pct) FROM quiz_attempts a WHERE a.quiz_id = q.id) AS best_score
       FROM quizzes q WHERE q.user_id = ? ORDER BY q.created_at DESC`,
      userId,
    );
  }

  delete(userId: string, id: string): void {
    this.db.run('DELETE FROM quizzes WHERE user_id = ? AND id = ?', userId, id);
  }

  addQuestions(quizId: string, rows: Omit<QuestionRow, 'id' | 'quiz_id'>[]): void {
    const stmt = this.db.raw.prepare(
      `INSERT INTO quiz_questions (id, quiz_id, ordinal, prompt, choices, answer_index, answer_text, explanation, chunk_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      for (const r of rows) stmt.run(randomUUID(), quizId, r.ordinal, r.prompt, r.choices, r.answer_index, r.answer_text, r.explanation, r.chunk_id);
    });
  }

  questions(quizId: string): QuestionRow[] {
    return this.db.all<QuestionRow>('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY ordinal', quizId);
  }

  addAttempt(userId: string, quizId: string, scorePct: number, detail: unknown): AttemptRow {
    const now = new Date().toISOString();
    const row: AttemptRow = { id: randomUUID(), quiz_id: quizId, user_id: userId, score_pct: scorePct, detail: JSON.stringify(detail), started_at: now, finished_at: now };
    this.db.run(
      'INSERT INTO quiz_attempts (id, quiz_id, user_id, score_pct, detail, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id, quizId, userId, scorePct, row.detail, row.started_at, row.finished_at,
    );
    return row;
  }

  attempts(userId: string, quizId?: string): AttemptRow[] {
    if (quizId) {
      return this.db.all<AttemptRow>('SELECT * FROM quiz_attempts WHERE user_id = ? AND quiz_id = ? ORDER BY finished_at DESC', userId, quizId);
    }
    return this.db.all<AttemptRow>('SELECT * FROM quiz_attempts WHERE user_id = ? ORDER BY finished_at DESC LIMIT 100', userId);
  }

  averageScore(userId: string): number | null {
    const row = this.db.get<{ avg: number | null }>('SELECT AVG(score_pct) AS avg FROM quiz_attempts WHERE user_id = ?', userId);
    return row?.avg ?? null;
  }
}
