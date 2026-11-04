import { Db } from '../db/db.ts';
import type { NoteRow } from './notes.ts';

export interface StickyNoteRow {
  id: string;
  user_id: string;
  subject_id?: string | null;
  document_id?: string | null;
  page_number?: number | null;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export class StickyNotesRepo {
  constructor(private readonly db: Db) {}

  list(userId: string, filters?: { subjectId?: string; documentId?: string; pageNumber?: number }): StickyNoteRow[] {
    let sql = 'SELECT * FROM sticky_notes WHERE user_id = ?';
    const params: unknown[] = [userId];
    if (filters?.subjectId) {
      sql += ' AND subject_id = ?';
      params.push(filters.subjectId);
    }
    if (filters?.documentId) {
      sql += ' AND document_id = ?';
      params.push(filters.documentId);
    }
    if (filters?.pageNumber !== undefined) {
      sql += ' AND page_number = ?';
      params.push(filters.pageNumber);
    }
    sql += ' ORDER BY updated_at DESC';
    return this.db.all<StickyNoteRow>(sql, ...params);
  }

  upsert(
    userId: string,
    id: string | undefined,
    title: string,
    body: string,
    subjectId?: string | null,
    documentId?: string | null,
    pageNumber?: number | null,
  ): StickyNoteRow {
    const now = new Date().toISOString();
    if (id) {
      const existing = this.db.get<StickyNoteRow>('SELECT * FROM sticky_notes WHERE id = ? AND user_id = ?', id, userId);
      if (existing) {
        this.db.run(
          'UPDATE sticky_notes SET title = ?, body = ?, subject_id = ?, document_id = ?, page_number = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          title,
          body,
          subjectId,
          documentId,
          pageNumber,
          now,
          id,
          userId,
        );
        return { ...existing, title, body, subject_id: subjectId, document_id: documentId, page_number: pageNumber, updated_at: now };
      }
    }
    const newId = crypto.randomUUID();
    this.db.run(
      'INSERT INTO sticky_notes (id, user_id, subject_id, document_id, page_number, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId,
      userId,
      subjectId,
      documentId,
      pageNumber,
      title,
      body,
      now,
      now,
    );
    return {
      id: newId,
      user_id: userId,
      subject_id: subjectId ?? null,
      document_id: documentId ?? null,
      page_number: pageNumber ?? null,
      title,
      body,
      created_at: now,
      updated_at: now,
    };
  }

  delete(userId: string, id: string): void {
    this.db.run('DELETE FROM sticky_notes WHERE id = ? AND user_id = ?', id, userId);
  }
}
