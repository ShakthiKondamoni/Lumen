import { Hono } from 'hono';
import { settingsSchema } from '@lumen/shared';
import { IdentityRepo } from '../repos/identity.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

export function settingsRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const identity = new IdentityRepo(deps.db);

  r.get('/settings', (c) => {
    return c.json({ settings: identity.getSettings(requireUser(c)) });
  });

  r.put('/settings', async (c) => {
    const userId = requireUser(c);
    const input = settingsSchema.parse(await c.req.json());
    identity.putSettings(userId, input);
    return c.json({ settings: input });
  });

  return r;
}
