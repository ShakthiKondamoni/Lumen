import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { MIGRATIONS } from './migrations.ts';

type SqlParam = null | number | bigint | string | Uint8Array;

export interface RunResult {
  changes: number | bigint;
}

export class Db {
  constructor(public readonly raw: DatabaseSync) {}

  run(sql: string, ...params: unknown[]): RunResult {
    return this.raw.prepare(sql).run(...(params as SqlParam[]));
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as SqlParam[])) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.raw.prepare(sql).get(...(params as SqlParam[])) as T | undefined;
  }

  transaction<T>(fn: () => T): T {
    this.run('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.run('COMMIT');
      return result;
    } catch (err) {
      this.run('ROLLBACK');
      throw err;
    }
  }
}

export function openDb(path: string): Db {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  return new Db(raw);
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrate(db: Db): { applied: string[] } {
  db.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    db.all<{ id: string }>('SELECT id FROM schema_migrations').map((r) => r.id),
  );
  const fresh: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) {
      const row = db.get<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE id = ?',
        m.id,
      );
      if (row && row.checksum !== checksum(m.sql)) {
        throw new Error(`Migration ${m.id} was modified after it was applied — refusing to start.`);
      }
      continue;
    }
    db.transaction(() => {
      db.raw.exec(m.sql);
      db.run(
        'INSERT INTO schema_migrations (id, checksum, applied_at) VALUES (?, ?, ?)',
        m.id,
        checksum(m.sql),
        new Date().toISOString(),
      );
    });
    fresh.push(m.id);
  }
  return { applied: fresh };
}
