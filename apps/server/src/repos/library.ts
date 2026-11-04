import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import type { DocumentStatus } from '@lumen/shared';

export interface SubjectRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  filename: string;
  mime: string;
  size_bytes: number;
  checksum: string;
  storage_key: string;
  page_count: number | null;
  status: DocumentStatus;
  needs_ocr: number;
  created_at: string;
}

export interface ChunkRow {
  id: string;
  user_id: string;
  document_id: string;
  page_start: number;
  page_end: number;
  heading_path: string;
  content: string;
  embedding: Buffer | null;
}

export class LibraryRepo {
  constructor(private readonly db: Db) {}

  // ----- subjects -----
  listSubjects(userId: string): (SubjectRow & { document_count: number })[] {
    return this.db.all<SubjectRow & { document_count: number }>(
      `SELECT s.*, COUNT(d.id) AS document_count FROM subjects s
       LEFT JOIN documents d ON d.subject_id = s.id
       WHERE s.user_id = ? GROUP BY s.id ORDER BY s.name`,
      userId,
    );
  }

  createSubject(userId: string, name: string, color: string): SubjectRow {
    const row: SubjectRow = { id: randomUUID(), user_id: userId, name, color };
    this.db.run(
      'INSERT INTO subjects (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)',
      row.id,
      userId,
      name,
      color,
      new Date().toISOString(),
    );
    return row;
  }

  renameSubject(userId: string, id: string, name: string): void {
    this.db.run('UPDATE subjects SET name = ? WHERE user_id = ? AND id = ?', name, userId, id);
  }

  deleteSubject(userId: string, id: string): void {
    this.db.run('DELETE FROM subjects WHERE user_id = ? AND id = ?', userId, id);
  }

  subject(userId: string, id: string): SubjectRow | undefined {
    return this.db.get<SubjectRow>('SELECT * FROM subjects WHERE user_id = ? AND id = ?', userId, id);
  }

  // ----- documents -----
  createDocument(d: Omit<DocumentRow, 'created_at'>): DocumentRow {
    const row: DocumentRow = { ...d, created_at: new Date().toISOString() };
    this.db.run(
      `INSERT INTO documents (id, user_id, subject_id, title, filename, mime, size_bytes, checksum, storage_key, page_count, status, needs_ocr, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.user_id,
      row.subject_id,
      row.title,
      row.filename,
      row.mime,
      row.size_bytes,
      row.checksum,
      row.storage_key,
      row.page_count,
      row.status,
      row.needs_ocr,
      row.created_at,
    );
    return row;
  }

  document(userId: string, id: string): DocumentRow | undefined {
    return this.db.get<DocumentRow>('SELECT * FROM documents WHERE user_id = ? AND id = ?', userId, id);
  }

  listDocuments(userId: string, subjectId?: string): DocumentRow[] {
    if (subjectId) {
      return this.db.all<DocumentRow>(
        'SELECT * FROM documents WHERE user_id = ? AND subject_id = ? ORDER BY created_at DESC',
        userId,
        subjectId,
      );
    }
    return this.db.all<DocumentRow>(
      'SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC',
      userId,
    );
  }

  documentByChecksum(userId: string, checksum: string): DocumentRow | undefined {
    return this.db.get<DocumentRow>(
      'SELECT * FROM documents WHERE user_id = ? AND checksum = ?',
      userId,
      checksum,
    );
  }

  updateDocument(userId: string, id: string, patch: Partial<Pick<DocumentRow, 'status' | 'page_count' | 'needs_ocr' | 'title' | 'subject_id'>>): void {
    const existing = this.document(userId, id);
    if (!existing) return;
    this.db.run(
      'UPDATE documents SET status = ?, page_count = ?, needs_ocr = ?, title = ?, subject_id = ? WHERE user_id = ? AND id = ?',
      patch.status ?? existing.status,
      patch.page_count !== undefined ? patch.page_count : existing.page_count,
      patch.needs_ocr !== undefined ? patch.needs_ocr : existing.needs_ocr,
      patch.title ?? existing.title,
      patch.subject_id !== undefined ? patch.subject_id : existing.subject_id,
      userId,
      id,
    );
  }

  deleteDocument(userId: string, id: string): DocumentRow | undefined {
    const existing = this.document(userId, id);
    if (!existing) return undefined;
    this.db.run('DELETE FROM documents WHERE user_id = ? AND id = ?', userId, id);
    return existing;
  }

  // ----- chunks -----
  insertChunks(userId: string, documentId: string, rows: Omit<ChunkRow, 'user_id' | 'document_id' | 'id'>[]): void {
    const stmt = this.db.raw.prepare(
      `INSERT INTO chunks (id, user_id, document_id, page_start, page_end, heading_path, content, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const r of rows) {
        stmt.run(randomUUID(), userId, documentId, r.page_start, r.page_end, r.heading_path, r.content, r.embedding, now);
      }
    });
  }

  chunksForDocument(userId: string, documentId: string): ChunkRow[] {
    return this.db.all<ChunkRow>(
      'SELECT * FROM chunks WHERE user_id = ? AND document_id = ? ORDER BY page_start, rowid',
      userId,
      documentId,
    );
  }

  chunk(userId: string, id: string): ChunkRow | undefined {
    return this.db.get<ChunkRow>('SELECT * FROM chunks WHERE user_id = ? AND id = ?', userId, id);
  }

  deleteChunksForDocument(userId: string, documentId: string): void {
    this.db.run('DELETE FROM chunks WHERE user_id = ? AND document_id = ?', userId, documentId);
  }

  countChunks(userId: string, documentId?: string): number {
    const row = documentId
      ? this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE user_id = ? AND document_id = ?', userId, documentId)
      : this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE user_id = ?', userId);
    return row?.n ?? 0;
  }

  allEmbeddedChunks(userId: string): ChunkRow[] {
    return this.db.all<ChunkRow>(
      `SELECT c.* FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.user_id = ? AND c.embedding IS NOT NULL AND d.status != 'failed'`,
      userId,
    );
  }

  /** Keyword search over FTS5; returns chunk rows with bm25 rank (lower = better). */
  keywordSearch(userId: string, query: string, limit: number, documentId?: string): (ChunkRow & { rank: number })[] {
    const filter = documentId ? 'AND c.document_id = ?' : '';
    const params: unknown[] = [query, userId, limit];
    if (documentId) params.push(documentId);
    return this.db.all<ChunkRow & { rank: number }>(
      `SELECT c.*, bm25(chunks_fts, 10.0) AS rank
       FROM chunks_fts f JOIN chunks c ON c.rowid = f.rowid
       WHERE chunks_fts MATCH ? AND c.user_id = ? ${filter}
       ORDER BY rank LIMIT ?`,
      ...params,
    );
  }
}

export function chunkDtoFromRow(row: ChunkRow, documentTitle: string, score?: number) {
  return {
    id: row.id,
    documentId: row.document_id,
    documentTitle,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    headingPath: row.heading_path,
    content: row.content,
    ...(score !== undefined ? { score } : {}),
  };
}
