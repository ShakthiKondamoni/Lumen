import { Hono } from 'hono';
import { JobRepo } from '../repos/jobs.ts';
import { errors } from '../core.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

function jobDto(row: ReturnType<JobRepo['list']>[number]) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    status: row.status,
    progress: row.progress,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function jobsRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const jobs = new JobRepo(deps.db);

  r.get('/jobs', (c) => {
    const userId = requireUser(c);
    return c.json({ jobs: jobs.list(userId).map(jobDto) });
  });

  r.get('/jobs/:id', (c) => {
    const userId = requireUser(c);
    const row = jobs.job(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Job not found');
    return c.json({ job: jobDto(row) });
  });

  r.post('/jobs/:id/cancel', (c) => {
    const userId = requireUser(c);
    const ok = jobs.requestCancel(userId, c.req.param('id'));
    if (!ok) throw errors.conflict('Job already finished');
    return c.json({ ok: true });
  });

  return r;
}
