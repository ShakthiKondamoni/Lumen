import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, migrate } from '../../apps/server/src/db/db.ts';
import { MIGRATIONS } from '../../apps/server/src/db/migrations.ts';

describe('migrations', () => {
  it('apply cleanly to a fresh database and are idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-mig-'));
    const db = openDb(join(dir, 't.sqlite'));
    const first = migrate(db);
    expect(first.applied).toHaveLength(MIGRATIONS.length);
    const second = migrate(db);
    expect(second.applied).toHaveLength(0);
    db.raw.close();
  });

  it('detects tampering with an applied migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-mig-'));
    const db = openDb(join(dir, 't.sqlite'));
    migrate(db);
    db.run("UPDATE schema_migrations SET checksum = 'deadbeef' WHERE id = '001_identity'");
    expect(() => migrate(db)).toThrow(/modified after it was applied/);
    db.raw.close();
  });

  it('creates all expected tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-mig-'));
    const db = openDb(join(dir, 't.sqlite'));
    migrate(db);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const expected of ['users', 'sessions', 'user_settings', 'providers', 'model_routes', 'subjects', 'documents', 'chunks', 'chunks_fts', 'jobs', 'conversations', 'messages', 'notes', 'decks', 'cards', 'review_log', 'quizzes', 'quiz_questions', 'quiz_attempts', 'plan_tasks', 'focus_sessions', 'concepts']) {
      expect(tables).toContain(expected);
    }
    db.raw.close();
  });
});
