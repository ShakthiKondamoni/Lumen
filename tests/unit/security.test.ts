import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, hashToken, loadMasterKey, newSessionToken, RateLimiter, verifyPassword } from '../../apps/server/src/security.ts';

describe('password hashing', () => {
  it('verifies correct and rejects wrong passwords', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^s1\$/);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password entirely', hash)).resolves.toBe(false);
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false);
  });

  it('salts every hash differently', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});

describe('session tokens', () => {
  it('are opaque and hash stably', () => {
    const t = newSessionToken();
    expect(t).toHaveLength(43);
    expect(hashToken(t)).toHaveLength(64);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(newSessionToken()));
  });
});

describe('API key encryption', () => {
  it('round-trips and rejects tampered ciphertext', () => {
    const key = loadMasterKey(join(mkdtempSync(join(tmpdir(), 'lumen-key-')), 'secret.key'));
    const ct = encryptSecret('sk-super-secret-123', key);
    expect(ct).not.toContain('sk-super-secret');
    expect(decryptSecret(ct, key)).toBe('sk-super-secret-123');
    const tampered = Buffer.from(ct, 'base64');
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(decryptSecret(tampered.toString('base64'), key)).toBeNull();
  });

  it('uses a per-instance master key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumen-key-'));
    const key1 = loadMasterKey(join(dir, 'a.key'));
    const key2 = loadMasterKey(join(dir, 'b.key'));
    const ct = encryptSecret('value', key1);
    expect(decryptSecret(ct, key2)).toBeNull();
  });
});

describe('rate limiter', () => {
  it('allows up to max then blocks within the window', () => {
    const limiter = new RateLimiter(1000, 3);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    expect(limiter.allow('other')).toBe(true);
  });

  it('recovers after the window passes', async () => {
    const limiter = new RateLimiter(30, 1);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    await new Promise((r) => setTimeout(r, 45));
    expect(limiter.allow('k')).toBe(true);
  });
});
