import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, TestClient, type TestServer } from '../helpers.ts';

let server: TestServer;
let client: TestClient;

beforeAll(async () => {
  server = await startTestServer();
  client = new TestClient(server.base);
});
afterAll(async () => {
  await server.dispose();
});

describe('auth & request security', () => {
  it('registers, reads back the session, and logs out', async () => {
    const creds = await client.register();
    const me = await client.authed<{ user: { email: string; name: string } }>('GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe(creds.email);
    const out = await client.authed('POST', '/api/auth/logout');
    expect(out.status).toBe(200);
    const after = await client.authed('GET', '/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('rejects wrong passwords and unknown users with one uniform error', async () => {
    await client.register('uniform@test.local', 'Uni', 'long enough password');
    const wrong = await client.authed('POST', '/api/auth/login', { email: 'uniform@test.local', password: 'not the password' });
    const unknown = await client.authed('POST', '/api/auth/login', { email: 'nobody@test.local', password: 'whatever goes here' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data).toEqual(unknown.data);
  });

  it('rejects duplicate registration with 409', async () => {
    await client.register('dupe@test.local', 'D', 'long enough password');
    const dup = await client.authed('POST', '/api/auth/register', { email: 'dupe@test.local', name: 'D2', password: 'long enough password' });
    expect(dup.status).toBe(409);
  });

  it('enforces password length on registration', async () => {
    const res = await client.authed('POST', '/api/auth/register', { email: 'short@test.local', name: 'S', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('blocks unauthenticated access to protected routes', async () => {
    const fresh = new TestClient(server.base);
    const res = await fresh.json('GET', '/api/documents');
    expect(res.status).toBe(401);
  });

  it('rejects mutating requests without the CSRF header', async () => {
    await client.register();
    // Raw request without x-csrf-token but with session cookies:
    const res = await client.raw('POST', '/api/subjects', JSON.stringify({ name: 'X' }), { 'content-type': 'application/json' });
    expect(res.status).toBe(403);
  });

  it('rejects cross-site origins (CSRF origin boundary)', async () => {
    // undici silently overrides a fake Host header, but Origin is honest —
    // and the boundary middleware rejects non-local origins outright.
    const res = await fetch(`${server.base}/api/auth/login`, {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.z', password: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns structured 404s for unknown endpoints', async () => {
    const res = await client.authed('GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.data).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('supports logout-all (sessions revoked)', async () => {
    await client.register('logout-all@test.local', 'LA', 'long enough password');
    const second = new TestClient(server.base);
    await second.register('logout-all-2@test.local', 'LA2', 'long enough password');
    await second.authed('POST', '/api/auth/login', { email: 'logout-all@test.local', password: 'long enough password' });
    await client.authed('POST', '/api/auth/logout-all');
    expect((await client.authed('GET', '/api/auth/me')).status).toBe(401);
    expect((await second.authed('GET', '/api/auth/me')).status).toBe(401);
  });
});
