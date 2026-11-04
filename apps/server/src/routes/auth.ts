import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { loginSchema, registerSchema, publicUserSchema } from '@lumen/shared';
import { errors } from '../core.ts';
import { IdentityRepo, publicUser } from '../repos/identity.ts';
import { hashToken, newSessionToken } from '../security.ts';
import { AccountService } from '../services/account.ts';
import type { Deps, Env } from '../middleware.ts';
import { clearSessionCookies, csrfCookieName, requireUser, sessionCookieName, setSessionCookies } from '../middleware.ts';

export function authRouter(deps: Deps): Hono<Env> {
  const r = new Hono<Env>();
  const service = new AccountService(deps.db, deps.config);

  r.get('/health', (c) => c.json({ ok: true, service: 'lumen-api' }));

  r.post('/auth/register', async (c) => {
    if (!deps.authLimiter.allow(`register:local`)) throw errors.rateLimited('Too many attempts — wait a minute');
    const input = registerSchema.parse(await c.req.json());
    const user = await service.register(input.email, input.name, input.password);
    const token = newSessionToken();
    const expires = new Date(Date.now() + 30 * 86_400_000);
    new IdentityRepo(deps.db).createSession(user.id, hashToken(token), expires);
    setSessionCookies(c, token, expires, deps.config.isProd);
    return c.json({ user: publicUser(user) }, 201);
  });

  r.post('/auth/login', async (c) => {
    if (!deps.authLimiter.allow(`login:local`)) throw errors.rateLimited('Too many attempts — wait a minute');
    const input = loginSchema.parse(await c.req.json());
    const { user, token, expires } = await service.login(input.email, input.password);
    setSessionCookies(c, token, expires, deps.config.isProd);
    return c.json({ user: publicUser(user) });
  });

  r.post('/auth/logout', (c) => {
    const token = getCookie(c, sessionCookieName());
    if (token) service.logout(token);
    clearSessionCookies(c);
    return c.json({ ok: true });
  });

  r.post('/auth/logout-all', (c) => {
    const userId = requireUser(c);
    service.logoutAll(userId);
    clearSessionCookies(c);
    return c.json({ ok: true });
  });

  r.get('/auth/me', (c) => {
    const userId = requireUser(c);
    const user = new IdentityRepo(deps.db).userById(userId);
    if (!user) throw errors.unauthorized();
    return c.json({ user: publicUserSchema.parse(publicUser(user)) });
  });

  r.get('/auth/csrf', (c) => {
    // Double-submit pattern: the (readable) CSRF cookie value is echoed to
    // the authenticated client so origins that cannot read 127.0.0.1
    // cookies (e.g. the desktop lumen:// renderer) can still send the header.
    requireUser(c);
    const token = getCookie(c, csrfCookieName());
    if (!token) throw errors.unauthorized('No active session');
    return c.json({ token });
  });

  r.put('/auth/account', async (c) => {
    const userId = requireUser(c);
    const identity = new IdentityRepo(deps.db);
    const input = z.object({ name: z.string().trim().min(1).max(80) }).parse(await c.req.json());
    const user = identity.userById(userId);
    if (!user) throw errors.unauthorized();
    // Name is the only mutable field; email changes would require re-verification.
    deps.db.run('UPDATE users SET name = ? WHERE id = ?', input.name, userId);
    identity.audit(userId, 'account.rename', { name: input.name });
    return c.json({ user: { ...publicUser(user), name: input.name } });
  });

  return r;
}
