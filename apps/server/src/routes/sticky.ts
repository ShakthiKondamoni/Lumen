import { Hono } from 'hono';
import { requireUser } from '../middleware.ts';
import { errors } from '../core.ts';
import { StickyNotesRepo, type StickyNoteRow } from '../repos/stickyNotes.ts';
import type { Deps, Env } from '../middleware.ts';

export function stickyRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const repo = new StickyNotesRepo(deps.db);

  // List notes with optional filters
  r.get('/sticky', (c) => {
    const userId = requireUser(c);
    const subjectId = c.req.query('subjectId') || undefined;
    const documentId = c.req.query('documentId') || undefined;
    const page = c.req.query('page');
    const notes = repo.list(userId, {
      subjectId,
      documentId,
      pageNumber: page ? Number(page) : undefined,
    });
    return c.json({ sticky: notes });
  });

  // Create / update a sticky note
  r.post('/sticky', async (c) => {
    const userId = requireUser(c);
    const input = await c.req.json();
    const row = repo.upsert(
      userId,
      input.id,
      input.title,
      input.body,
      input.subjectId ?? null,
      input.documentId ?? null,
      input.pageNumber ?? null,
    );
    return c.json({ sticky: row }, 201);
  });

  // Delete a sticky note
  r.delete('/sticky/:id', (c) => {
    const userId = requireUser(c);
    const id = c.req.param('id');
    const existing = repo.db.get<StickyNoteRow>('SELECT * FROM sticky_notes WHERE id = ? AND user_id = ?', id, userId);
    if (!existing) throw errors.notFound('Sticky note not found');
    repo.delete(userId, id);
    return c.json({ ok: true });
  });

  return r;
}
