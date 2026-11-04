import { Hono } from 'hono';
import { providerCreateSchema, providerUpdateSchema, publicProviderSchema, routeSetSchema } from '@lumen/shared';
import { errors, log } from '../core.ts';
import { ProviderRepo } from '../repos/providers.ts';
import { encryptSecret } from '../security.ts';
import { AiResolver } from '../services/tutor.ts';
import { listModels } from '../services/ai.ts';
import type { Deps, Env } from '../middleware.ts';
import { requireUser } from '../middleware.ts';

function toPublic(row: { id: string; kind: string; label: string; base_url: string; enabled: number; key_ct: string | null }) {
  return publicProviderSchema.parse({
    id: row.id,
    kind: row.kind,
    label: row.label,
    baseUrl: row.base_url,
    enabled: row.enabled === 1,
    hasKey: row.key_ct !== null,
  });
}

export function providersRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const repo = new ProviderRepo(deps.db);
  const resolver = new AiResolver(deps.db, deps.masterKey, deps.config);

  r.get('/providers', (c) => {
    const userId = requireUser(c);
    return c.json({ providers: repo.list(userId).map(toPublic) });
  });

  r.post('/providers', async (c) => {
    const userId = requireUser(c);
    const input = providerCreateSchema.parse(await c.req.json());
    const needsKey = input.kind !== 'openai-compatible' || !/^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/.test(input.baseUrl);
    if (needsKey && !input.apiKey) {
      throw errors.badRequest('This provider requires an API key. Local servers (localhost) may leave it empty.');
    }
    const keyCt = input.apiKey ? encryptSecret(input.apiKey, deps.masterKey) : null;
    const row = repo.create(userId, input.kind, input.label, input.baseUrl, keyCt);
    return c.json({ provider: toPublic(row) }, 201);
  });

  r.patch('/providers/:id', async (c) => {
    const userId = requireUser(c);
    const input = providerUpdateSchema.parse(await c.req.json());
    const patch: Parameters<ProviderRepo['update']>[2] = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.baseUrl !== undefined) patch.base_url = input.baseUrl;
    if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;
    if (input.apiKey !== undefined) patch.key_ct = input.apiKey.length > 0 ? encryptSecret(input.apiKey, deps.masterKey) : null;
    repo.update(userId, c.req.param('id'), patch);
    const row = repo.get(userId, c.req.param('id'));
    if (!row) throw errors.notFound('Provider not found');
    return c.json({ provider: toPublic(row) });
  });

  r.delete('/providers/:id', (c) => {
    const userId = requireUser(c);
    repo.delete(userId, c.req.param('id'));
    return c.json({ ok: true });
  });

  r.post('/providers/:id/test', async (c) => {
    const userId = requireUser(c);
    const step = resolver.resolveSingle(userId, c.req.param('id'));
    try {
      const models = await listModels(step);
      return c.json({ ok: true, modelCount: models.length, sample: models.slice(0, 10) });
    } catch (err) {
      log('info', 'providers.test-failed', { error: String(err) });
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' }, 200);
    }
  });

  r.get('/providers/:id/models', async (c) => {
    const userId = requireUser(c);
    const step = resolver.resolveSingle(userId, c.req.param('id'));
    const models = await listModels(step);
    return c.json({ models });
  });

  r.get('/routes', (c) => {
    const userId = requireUser(c);
    const tasks = ['chat', 'tutor', 'quiz', 'summarize'] as const;
    return c.json({ routes: Object.fromEntries(tasks.map((t) => [t, repo.getRoute(userId, t)])) });
  });

  r.put('/routes', async (c) => {
    const userId = requireUser(c);
    const input = routeSetSchema.parse(await c.req.json());
    // Only allow routes through providers that exist and belong to this user.
    for (const step of input.steps) {
      if (!repo.get(userId, step.providerId)) throw errors.badRequest('Unknown provider in route');
    }
    repo.putRoute(userId, input.task, input.steps);
    return c.json({ ok: true });
  });

  return r;
}
