import { Hono } from 'hono';
import { searchSchema } from '@lumen/shared';
import { LibraryRepo } from '../repos/library.ts';
import { NotesRepo } from '../repos/notes.ts';
import { hybridSearch, toChunkDto } from '../services/intel.ts';
import { ftsQuery } from '../services/tutor.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

export function searchRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();

  r.post('/search', async (c) => {
    const userId = requireUser(c);
    const input = searchSchema.parse(await c.req.json());
    const library = new LibraryRepo(deps.db);
    const keyword = library.keywordSearch(userId, ftsQuery(input.q), input.limit ?? 12, input.documentId);
    const embedded = library.allEmbeddedChunks(userId).filter((ch) => !input.documentId || ch.document_id === input.documentId);
    const fused = hybridSearch(input.q, keyword, embedded, input.limit ?? 12);
    const titles = new Map(library.listDocuments(userId).map((d) => [d.id, d.title]));
    return c.json({
      results: fused.map((row) => toChunkDto(row, titles.get(row.document_id) ?? 'Document', row.fused)),
    });
  });

  // Global search across notes + documents for the command palette.
  r.get('/search/global', (c) => {
    const userId = requireUser(c);
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ notes: [], documents: [] });
    const notes = new NotesRepo(deps.db);
    const noteRows = notes.search(userId, q, 8).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updated_at }));
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
    const docs = deps.db
      .all<{ id: string; title: string; created_at: string }>(
        'SELECT id, title, created_at FROM documents WHERE user_id = ? AND title LIKE ? ORDER BY created_at DESC LIMIT 8',
        userId, like,
      )
      .map((d) => ({ id: d.id, title: d.title, createdAt: d.created_at }));
    return c.json({ notes: noteRows, documents: docs });
  });

  return r;
}
