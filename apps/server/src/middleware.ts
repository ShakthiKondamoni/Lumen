import type { Hono} from 'hono';
import { type Context } from 'hono';
import { getCookie, deleteCookie, setCookie } from 'hono/cookie';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db/db.ts';
import { AppError, errors, log, newRequestId, setLogLevel } from './core.ts';
import { IdentityRepo } from './repos/identity.ts';
import type { RateLimiter } from './security.ts';
import { hashToken } from './security.ts';
import type { JobRunner } from './services/jobs.ts';
import type { FileStorage } from './services/storage.ts';

export type Env = { Variables: { requestId: string; userId: string } };

export interface Deps {
  config: Config;
  db: Db;
  masterKey: Buffer;
  storage: FileStorage;
  runner: JobRunner;
  chatCancels: Map<string, AbortController>;
  authLimiter: RateLimiter;
}

const SESSION_COOKIE = 'lumen_session';
const CSRF_COOKIE = 'lumen_csrf';
const CSRF_HEADER = 'x-csrf-token';
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/register', '/api/auth/login']);

export function requireUser(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) throw errors.unauthorized();
  return userId;
}

export function setSessionCookies(c: Context<Env>, token: string, expires: Date, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', secure, expires });
  const csrf = hashToken(token).slice(0, 32);
  setCookie(c, CSRF_COOKIE, csrf, { httpOnly: false, sameSite: 'Strict', path: '/', secure, expires });
}

export function clearSessionCookies(c: Context<Env>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  deleteCookie(c, CSRF_COOKIE, { path: '/' });
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function csrfCookieName(): string {
  return CSRF_COOKIE;
}

/** Builds the middleware stack shared by all API routers. */
export function applyCoreMiddleware(app: Hono<Env>, deps: Deps): void {
  setLogLevel(deps.config.logLevel);

  app.use('*', async (c, next) => {
    c.set('requestId', newRequestId());
    const started = Date.now();
    await next();
    log('info', 'request', {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - started,
    });
  });

  // Local-application boundary: loopback hosts only. Browser origins must
  // match the local host; the desktop shell calls from lumen://local (its
  // renderer is sandboxed and cannot fake that origin).
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? '';
    const port = String(deps.config.port);
    const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
    const origin = c.req.header('origin');
    const originAllowed =
      !origin || allowedHosts.some((h) => origin === `http://${h}`) || origin === 'lumen://local';
    if (!allowedHosts.includes(host) || !originAllowed) {
      throw new AppError('FORBIDDEN_HOST', 403, 'Untrusted local application origin');
    }
    if (origin === 'lumen://local') {
      // Desktop shell: the custom protocol origin is separate from
      // http://127.0.0.1, so it needs explicit CORS with credentials.
      c.header('access-control-allow-origin', origin);
      c.header('access-control-allow-credentials', 'true');
      c.header('access-control-allow-headers', 'content-type, x-csrf-token');
      c.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  });

  // Session resolution + CSRF + route protection.
  app.use('/api/*', async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const identity = new IdentityRepo(deps.db);
      const session = identity.sessionByTokenHash(hashToken(token));
      if (session && new Date(session.expires_at) > new Date()) {
        c.set('userId', session.user_id);
      }
    }
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
    if (mutating && c.get('userId')) {
      const csrfCookie = getCookie(c, CSRF_COOKIE);
      const header = c.req.header(CSRF_HEADER);
      if (!csrfCookie || !header || header !== csrfCookie) {
        throw errors.forbidden('CSRF token missing or invalid');
      }
    }
    const path = new URL(c.req.url).pathname;
    if (!PUBLIC_PATHS.has(path) && !c.get('userId')) {
      throw errors.unauthorized();
    }
    await next();
  });
}

export function errorMapper(err: Error): { status: number; body: { error: { code: string; message: string } } } {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.join('.') ?? '';
    return { status: 400, body: { error: { code: 'VALIDATION', message: where ? `${where}: ${first?.message}` : first?.message ?? 'Invalid input' } } };
  }
  log('error', 'request.unhandled', { error: err.stack ?? String(err) });
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong on the server' } } };
}
