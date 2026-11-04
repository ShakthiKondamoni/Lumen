import { Hono } from 'hono';
import { noteUpsertSchema } from '@lumen/shared';
import { errors } from '../core.ts';
import { NotesRepo, type NoteRow } from '../repos/notes.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

function noteDto(row: NoteRow, links: string[]) {
  return { id: row.id, title: row.title, body: row.body, links, updatedAt: row.updated_at };
}

export function notesRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const notes = new NotesRepo(deps.db);

  r.get('/notes', (c) => {
    const userId = requireUser(c);
    return c.json({ notes: notes.list(userId).map((n) => ({ id: n.id, title: n.title, body: n.body, links: notes.outgoing(n.id), updatedAt: n.updated_at })) });
  });

  r.get('/notes/:id', (c) => {
    const userId = requireUser(c);
    const row = notes.note(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Note not found');
    return c.json({ note: noteDto(row, notes.outgoing(row.id)) });
  });

  r.post('/notes', async (c) => {
    const userId = requireUser(c);
    const input = noteUpsertSchema.parse(await c.req.json());
    const row = notes.upsert(userId, input.id, input.title, input.body);
    return c.json({ note: noteDto(row, notes.outgoing(row.id)) }, 201);
  });

  r.delete('/notes/:id', (c) => {
    const userId = requireUser(c);
    const row = notes.note(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Note not found');
    notes.delete(userId, row.id);
    return c.json({ ok: true });
  });

  return r;
}
