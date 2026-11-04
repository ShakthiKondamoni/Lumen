import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';

export interface TaskRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  due_date: string | null;
  estimate_min: number | null;
  done: number;
}

export interface FocusRow {
  id: string;
  user_id: string;
  label: string;
  minutes: number;
  started_at: string;
  completed: number;
}

export interface ConceptRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  label: string;
  summary: string;
}

export class PlanRepo {
  constructor(private readonly db: Db) {}

  // ----- planner -----
  tasks(userId: string): TaskRow[] {
    return this.db.all<TaskRow>('SELECT * FROM plan_tasks WHERE user_id = ? ORDER BY done, due_date IS NULL, due_date, created_at', userId);
  }

  createTask(userId: string, title: string, subjectId: string | null, dueDate: string | null, estimateMin: number | null): TaskRow {
    const row: TaskRow = { id: randomUUID(), user_id: userId, subject_id: subjectId, title, due_date: dueDate, estimate_min: estimateMin, done: 0 };
    this.db.run(
      'INSERT INTO plan_tasks (id, user_id, subject_id, title, due_date, estimate_min, done, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      row.id, userId, subjectId, title, dueDate, estimateMin, new Date().toISOString(),
    );
    return row;
  }

  setTaskDone(userId: string, id: string, done: boolean): void {
    this.db.run('UPDATE plan_tasks SET done = ? WHERE user_id = ? AND id = ?', done ? 1 : 0, userId, id);
  }

  deleteTask(userId: string, id: string): void {
    this.db.run('DELETE FROM plan_tasks WHERE user_id = ? AND id = ?', userId, id);
  }

  // ----- focus -----
  addFocus(userId: string, label: string, minutes: number, startedAt: Date, completed: boolean): FocusRow {
    const row: FocusRow = { id: randomUUID(), user_id: userId, label, minutes, started_at: startedAt.toISOString(), completed: completed ? 1 : 0 };
    this.db.run(
      'INSERT INTO focus_sessions (id, user_id, label, minutes, started_at, completed) VALUES (?, ?, ?, ?, ?, ?)',
      row.id, userId, label, minutes, row.started_at, row.completed,
    );
    return row;
  }

  recentFocus(userId: string, limit = 30): FocusRow[] {
    return this.db.all<FocusRow>('SELECT * FROM focus_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?', userId, limit);
  }

  focusMinutes(userId: string, sinceIso: string): number {
    const row = this.db.get<{ m: number | null }>(
      'SELECT SUM(minutes) AS m FROM focus_sessions WHERE user_id = ? AND started_at >= ? AND completed = 1',
      userId, sinceIso,
    );
    return row?.m ?? 0;
  }

  // ----- concepts -----
  concepts(userId: string): (ConceptRow & { edges: { toId: string; toLabel: string; label: string }[] })[] {
    const rows = this.db.all<ConceptRow>('SELECT * FROM concepts WHERE user_id = ? ORDER BY label', userId);
    const edges = this.db.all<{ from_id: string; to_id: string; to_label: string; label: string }>(
      `SELECT e.from_id, e.to_id, c2.label AS to_label, e.label FROM concept_edges e
       JOIN concepts c2 ON c2.id = e.to_id WHERE e.user_id = ?`,
      userId,
    );
    return rows.map((r) => ({ ...r, edges: edges.filter((e) => e.from_id === r.id).map((e) => ({ toId: e.to_id, toLabel: e.to_label, label: e.label })) }));
  }

  createConcept(userId: string, label: string, summary: string, subjectId: string | null): ConceptRow {
    const row: ConceptRow = { id: randomUUID(), user_id: userId, subject_id: subjectId, label, summary };
    this.db.run('INSERT INTO concepts (id, user_id, subject_id, label, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)', row.id, userId, subjectId, label, summary, new Date().toISOString());
    return row;
  }

  deleteConcept(userId: string, id: string): void {
    this.db.run('DELETE FROM concepts WHERE user_id = ? AND id = ?', userId, id);
  }

  addEdge(userId: string, fromId: string, toId: string, label: string): void {
    this.db.run('INSERT INTO concept_edges (id, user_id, from_id, to_id, label) VALUES (?, ?, ?, ?, ?)', randomUUID(), userId, fromId, toId, label);
  }
}
