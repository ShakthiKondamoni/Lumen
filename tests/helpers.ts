import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { openDb, migrate, type Db } from '../apps/server/src/db/db.ts';
import { loadConfig } from '../apps/server/src/config.ts';
import { FileStorage } from '../apps/server/src/services/storage.ts';
import { JobRunner } from '../apps/server/src/services/jobs.ts';
import { RateLimiter, loadMasterKey } from '../apps/server/src/security.ts';
import { buildApp, type Deps } from '../apps/server/src/index.ts';

export interface TestServer {
  base: string;
  db: Db;
  deps: Deps;
  dispose: () => Promise<void>;
}

/** Boots a real Lumen API against a throwaway data dir on an ephemeral port. */
export async function startTestServer(): Promise<TestServer> {
  const dir = await mkdtemp(join(tmpdir(), 'lumen-test-'));
  // Port 0 (OS-assigned) is applied after parsing; the schema requires >= 1.
  const config = { ...loadConfig({ LUMEN_DATA_DIR: dir, LUMEN_PORT: '8687', LOG_LEVEL: 'error', NODE_ENV: 'test' }), port: 0 };
  const db = openDb(config.dbPath);
  migrate(db);
  const masterKey = loadMasterKey(config.secretKeyPath);
  const storage = new FileStorage(config.filesDir);
  const runner = new JobRunner(db, config, storage, 1);
  const deps: Deps = {
    config,
    db,
    masterKey,
    storage,
    runner,
    chatCancels: new Map(),
    authLimiter: new RateLimiter(60_000, 1000),
  };
  const app = buildApp(deps);
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => setTimeout(r, 60));
  const address = server.address() as AddressInfo;
  // The host-boundary middleware reads config.port per request; align it.
  config.port = address.port;
  return {
    base: `http://127.0.0.1:${address.port}`,
    db,
    deps,
    dispose: async () => {
      runner.stop();
      await new Promise((r) => setTimeout(r, 30));
      server.close();
      db.raw.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Cookie-jar HTTP client that speaks the session+CSRF protocol. */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(readonly base: string) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private storeCookies(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.storeCookies(res);
    return res;
  }

  async json<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: T }> {
    const res = await this.raw(method, path, body, headers);
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as T) : ({} as T) };
  }

  /** Registers a fresh account and returns the CSRF token for mutations. */
  async register(email = `u${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name = 'Tester', password = 'correct horse battery'): Promise<{ email: string; password: string; csrf: string }> {
    // A browser always sends the CSRF header when the jar already holds one
    // (e.g. registering while another session is still active).
    const csrf = this.cookies.get('lumen_csrf');
    const { status } = await this.json('POST', '/api/auth/register', { email, name, password }, csrf ? { 'x-csrf-token': csrf } : {});
    if (status !== 201) throw new Error(`register failed with ${status}`);
    const { data } = await this.json<{ token: string }>('GET', '/api/auth/csrf');
    return { email, password, csrf: data.token };
  }

  /** Authenticated request helper: injects the CSRF header automatically. */
  async authed<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const csrf = this.cookies.get('lumen_csrf') ?? '';
    return this.json<T>(method, path, body, { 'x-csrf-token': csrf, ...extra });
  }

  /** Multipart upload with session cookies + CSRF header (browser-equivalent). */
  async upload<T>(path: string, form: FormData): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      body: form,
      headers: {
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader(), 'x-csrf-token': this.cookies.get('lumen_csrf') ?? '' } : {}),
      },
    });
    this.storeCookies(res);
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as T) : ({} as T) };
  }
}

/** Waits until a job reaches one of the given statuses. */
export async function waitForJob(client: TestClient, jobId: string, statuses: string[], timeoutMs = 20000): Promise<{ status: string; error: string | null }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await client.authed<{ job: { status: string; error: string | null } }>('GET', `/api/jobs/${jobId}`);
    if (statuses.includes(data.job.status)) return data.job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Job ${jobId} did not reach ${statuses.join('/')} in time`);
}

export async function waitForDocumentStatus(client: TestClient, documentId: string, statuses: string[], timeoutMs = 20000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await client.authed<{ document: { status: string } }>('GET', `/api/documents/${documentId}`);
    if (statuses.includes(data.document.status)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Document ${documentId} did not reach ${statuses.join('/')} in time`);
}
