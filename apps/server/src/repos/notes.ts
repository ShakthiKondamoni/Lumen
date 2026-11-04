import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

// Lazy match: content runs up to the first closing brackets, so [[A]] and
// [[B]] both resolve inside one line.
const WIKI_LINK = /\[\[(.+?)\]\]/g;

export function extractWikiTargets(body: string): string[] {
  return [...body.matchAll(WIKI_LINK)].map((m) => m[1]!.trim()).filter(Boolean);
}

export class NotesRepo {
  constructor(private readonly db: Db) {}

  list(userId: string): NoteRow[] {
    return this.db.all<NoteRow>('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC', userId);
  }

  note(userId: string, id: string): NoteRow | undefined {
    return this.db.get<NoteRow>('SELECT * FROM notes WHERE user_id = ? AND id = ?', userId, id);
  }

  upsert(userId: string, id: string | undefined, title: string, body: string): NoteRow {
    const now = new Date().toISOString();
    if (id) {
      const existing = this.note(userId, id);
      if (existing) {
        this.db.run('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE user_id = ? AND id = ?', title, body, now, userId, id);
        this.relink(userId, id, body);
        return { ...existing, title, body, updated_at: now };
      }
    }
    const row: NoteRow = { id: randomUUID(), user_id: userId, title, body, created_at: now, updated_at: now };
    this.db.run('INSERT INTO notes (id, user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', row.id, userId, title, body, now, now);
    this.relink(userId, row.id, body);
    return row;
  }

  delete(userId: string, id: string): void {
    this.db.run('DELETE FROM notes WHERE user_id = ? AND id = ?', userId, id);
  }

  /** Re-resolve [[wiki links]] against note titles. Unresolved targets are skipped. */
  relink(userId: string, noteId: string, body: string): void {
    this.db.run('DELETE FROM note_links WHERE src_note_id = ?', noteId);
    const targets = extractWikiTargets(body);
    if (targets.length === 0) return;
    const stmt = this.db.raw.prepare('INSERT OR IGNORE INTO note_links (src_note_id, dst_note_id) VALUES (?, ?)');
    this.db.transaction(() => {
      for (const t of targets) {
        const dst = this.db.get<{ id: string }>(
          "SELECT id FROM notes WHERE user_id = ? AND (title = ? OR title = ? COLLATE NOCASE)",
          userId,
          t,
          t,
        );
        if (dst) stmt.run(noteId, dst.id);
      }
    });
  }

  outgoing(noteId: string): string[] {
    return this.db.all<{ dst_note_id: string }>('SELECT dst_note_id FROM note_links WHERE src_note_id = ?', noteId).map((r) => r.dst_note_id);
  }

  /** Search notes with FTS; falls back to LIKE for short/odd queries. */
  search(userId: string, query: string, limit = 20): NoteRow[] {
    try {
      const rows = this.db.all<{ id: string }>(
        `SELECT n.id FROM notes_fts f JOIN notes n ON n.rowid = f.rowid
         WHERE notes_fts MATCH ? AND n.user_id = ? ORDER BY rank LIMIT ?`,
        query,
        userId,
        limit,
      );
      if (rows.length > 0) return rows.map((r) => this.note(userId, r.id)).filter((n): n is NoteRow => Boolean(n));
    } catch {
      // malformed FTS query — fall through to LIKE
    }
    const like = `%${query.replace(/[%_]/g, ' ')}%`;
    return this.db.all<NoteRow>(
      'SELECT * FROM notes WHERE user_id = ? AND (title LIKE ? OR body LIKE ?) ORDER BY updated_at DESC LIMIT ?',
      userId,
      like,
      like,
      limit,
    );
  }
}
