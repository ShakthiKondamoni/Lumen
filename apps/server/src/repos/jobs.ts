import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { JobStatus } from '@lumen/shared';

export interface JobRow {
  id: string;
  user_id: string;
  kind: string;
  label: string;
  payload: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  attempts: number;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
}

export class JobRepo {
  constructor(private readonly db: Db) {}

  create(userId: string, kind: string, label: string, payload: Record<string, unknown>): JobRow {
    const now = new Date().toISOString();
    const row: JobRow = {
      id: randomUUID(),
      user_id: userId,
      kind,
      label,
      payload: JSON.stringify(payload),
      status: 'queued',
      progress: 0,
      error: null,
      attempts: 0,
      cancel_requested: 0,
      created_at: now,
      updated_at: now,
    };
    this.db.run(
      `INSERT INTO jobs (id, user_id, kind, label, payload, status, progress, error, attempts, cancel_requested, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, NULL, 0, 0, ?, ?)`,
      row.id,
      userId,
      kind,
      label,
      row.payload,
      now,
      now,
    );
    return row;
  }

  job(userId: string, id: string): JobRow | undefined {
    return this.db.get<JobRow>('SELECT * FROM jobs WHERE user_id = ? AND id = ?', userId, id);
  }

  list(userId: string, limit = 50): JobRow[] {
    return this.db.all<JobRow>(
      'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      userId,
      limit,
    );
  }

  update(id: string, patch: Partial<Pick<JobRow, 'status' | 'progress' | 'error' | 'attempts' | 'cancel_requested'>>): void {
    const existing = this.db.get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
    if (!existing) return;
    this.db.run(
      'UPDATE jobs SET status = ?, progress = ?, error = ?, attempts = ?, cancel_requested = ?, updated_at = ? WHERE id = ?',
      patch.status ?? existing.status,
      patch.progress ?? existing.progress,
      patch.error !== undefined ? patch.error : existing.error,
      patch.attempts ?? existing.attempts,
      patch.cancel_requested ?? existing.cancel_requested,
      new Date().toISOString(),
      id,
    );
  }

  /** Mark a job cancelled before it starts; returns false when it already finished. */
  requestCancel(userId: string, id: string): boolean {
    const row = this.job(userId, id);
    if (!row) return false;
    if (row.status === 'done' || row.status === 'failed' || row.status === 'cancelled') return false;
    const nextStatus: JobStatus = row.status === 'queued' ? 'cancelled' : row.status;
    this.update(id, { status: nextStatus, cancel_requested: 1 });
    return true;
  }
}
