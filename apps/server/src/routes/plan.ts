import { Hono } from 'hono';
import { conceptCreateSchema, conceptEdgeSchema, taskCreateSchema } from '@lumen/shared';
import { errors } from '../core.ts';
import { PlanRepo } from '../repos/plan.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

export function planRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const plan = new PlanRepo(deps.db);

  r.get('/tasks', (c) => {
    const userId = requireUser(c);
    return c.json({ tasks: plan.tasks(userId).map((t) => ({ id: t.id, title: t.title, subjectId: t.subject_id, dueDate: t.due_date, estimateMin: t.estimate_min, done: t.done === 1 })) });
  });

  r.post('/tasks', async (c) => {
    const userId = requireUser(c);
    const input = taskCreateSchema.parse(await c.req.json());
    const row = plan.createTask(userId, input.title, input.subjectId ?? null, input.dueDate ?? null, input.estimateMin ?? null);
    return c.json({ task: { id: row.id, title: row.title, subjectId: row.subject_id, dueDate: row.due_date, estimateMin: row.estimate_min, done: false } }, 201);
  });

  r.post('/tasks/:id/toggle', (c) => {
    const userId = requireUser(c);
    const row = plan.tasks(userId).find((t) => t.id === c.req.param('id'));
    if (!row) throw errors.notFound('Task not found');
    plan.setTaskDone(userId, row.id, row.done !== 1);
    return c.json({ ok: true });
  });

  r.delete('/tasks/:id', (c) => {
    const userId = requireUser(c);
    plan.deleteTask(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  r.post('/focus', async (c) => {
    const userId = requireUser(c);
    const body = await c.req.json() as { label?: string; minutes?: number; startedAt?: string };
    const minutes = Math.max(1, Math.min(240, Math.round(body.minutes ?? 25)));
    const startedAt = body.startedAt && !Number.isNaN(Date.parse(body.startedAt)) ? new Date(body.startedAt) : new Date();
    const row = plan.addFocus(userId, (body.label ?? '').slice(0, 80), minutes, startedAt, true);
    return c.json({ session: { id: row.id, label: row.label, minutes: row.minutes, startedAt: row.started_at, completed: true } }, 201);
  });

  r.get('/focus', (c) => {
    const userId = requireUser(c);
    return c.json({ sessions: plan.recentFocus(userId).map((s) => ({ id: s.id, label: s.label, minutes: s.minutes, startedAt: s.started_at, completed: s.completed === 1 })) });
  });

  r.get('/concepts', (c) => {
    const userId = requireUser(c);
    return c.json({ concepts: plan.concepts(userId).map((k) => ({ id: k.id, label: k.label, summary: k.summary, edges: k.edges })) });
  });

  r.post('/concepts', async (c) => {
    const userId = requireUser(c);
    const input = conceptCreateSchema.parse(await c.req.json());
    const row = plan.createConcept(userId, input.label, input.summary ?? '', input.subjectId ?? null);
    return c.json({ concept: { id: row.id, label: row.label, summary: row.summary, edges: [] } }, 201);
  });

  r.post('/concepts/edges', async (c) => {
    const userId = requireUser(c);
    const input = conceptEdgeSchema.parse(await c.req.json());
    const concepts = plan.concepts(userId);
    if (!concepts.some((k) => k.id === input.fromId) || !concepts.some((k) => k.id === input.toId)) {
      throw errors.badRequest('Unknown concept');
    }
    plan.addEdge(userId, input.fromId, input.toId, input.label);
    return c.json({ ok: true }, 201);
  });

  r.delete('/concepts/:id', (c) => {
    const userId = requireUser(c);
    plan.deleteConcept(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  return r;
}
