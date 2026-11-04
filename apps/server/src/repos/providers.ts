import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { ProviderKind, RouteStep, RouteTask } from '@lumen/shared';

export interface ProviderRow {
  id: string;
  user_id: string;
  kind: ProviderKind;
  label: string;
  base_url: string;
  key_ct: string | null;
  enabled: number;
}

export type { RouteStep };

export class ProviderRepo {
  constructor(private readonly db: Db) {}

  list(userId: string): ProviderRow[] {
    return this.db.all<ProviderRow>(
      'SELECT * FROM providers WHERE user_id = ? ORDER BY created_at',
      userId,
    );
  }

  get(userId: string, id: string): ProviderRow | undefined {
    return this.db.get<ProviderRow>(
      'SELECT * FROM providers WHERE user_id = ? AND id = ?',
      userId,
      id,
    );
  }

  create(
    userId: string,
    kind: ProviderKind,
    label: string,
    baseUrl: string,
    keyCt: string | null,
  ): ProviderRow {
    const row: ProviderRow = {
      id: randomUUID(),
      user_id: userId,
      kind,
      label,
      base_url: baseUrl,
      key_ct: keyCt,
      enabled: 1,
    };
    this.db.run(
      `INSERT INTO providers (id, user_id, kind, label, base_url, key_ct, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      row.id,
      userId,
      kind,
      label,
      baseUrl,
      keyCt,
      new Date().toISOString(),
    );
    return row;
  }

  update(userId: string, id: string, patch: Partial<Pick<ProviderRow, 'label' | 'base_url' | 'key_ct' | 'enabled'>>): void {
    const existing = this.get(userId, id);
    if (!existing) return;
    this.db.run(
      'UPDATE providers SET label = ?, base_url = ?, key_ct = ?, enabled = ? WHERE user_id = ? AND id = ?',
      patch.label ?? existing.label,
      patch.base_url ?? existing.base_url,
      patch.key_ct !== undefined ? patch.key_ct : existing.key_ct,
      patch.enabled ?? existing.enabled,
      userId,
      id,
    );
  }

  delete(userId: string, id: string): void {
    this.db.run('DELETE FROM providers WHERE user_id = ? AND id = ?', userId, id);
    // Drop dangling route references so routing never points at a ghost.
    for (const task of ['chat', 'tutor', 'quiz', 'summarize'] as const) {
      const row = this.db.get<{ steps_json: string }>(
        'SELECT steps_json FROM model_routes WHERE user_id = ? AND task = ?',
        userId,
        task,
      );
      if (!row) continue;
      const steps = JSON.parse(row.steps_json) as RouteStep[];
      const filtered = steps.filter((s) => s.providerId !== id);
      if (filtered.length !== steps.length) this.putRoute(userId, task, filtered);
    }
  }

  getRoute(userId: string, task: RouteTask): RouteStep[] {
    const row = this.db.get<{ steps_json: string }>(
      'SELECT steps_json FROM model_routes WHERE user_id = ? AND task = ?',
      userId,
      task,
    );
    return row ? (JSON.parse(row.steps_json) as RouteStep[]) : [];
  }

  putRoute(userId: string, task: RouteTask, steps: RouteStep[]): void {
    this.db.run(
      `INSERT INTO model_routes (user_id, task, steps_json) VALUES (?, ?, ?)
       ON CONFLICT(user_id, task) DO UPDATE SET steps_json = excluded.steps_json`,
      userId,
      task,
      JSON.stringify(steps),
    );
  }
}
