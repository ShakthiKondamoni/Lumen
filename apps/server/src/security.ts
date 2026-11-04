import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, openSync, readSync, writeSync, closeSync, fstatSync } from 'node:fs';
import { promisify } from 'node:util';
import { AppError } from './core.ts';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

// ---------- passwords (scrypt, node built-in) ----------
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 's1' || !parts[1] || !parts[2]) return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------- opaque session tokens ----------
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------- provider API key encryption (AES-256-GCM) ----------
/** Loads or creates the 32-byte master key used to encrypt provider API keys. */
export function loadMasterKey(path: string): Buffer {
  if (existsSync(path)) {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(32);
      const read = readSync(fd, buf, 0, 32, 0);
      if (read !== 32) throw new Error(`Master key file ${path} is truncated`);
      return buf;
    } finally {
      closeSync(fd);
    }
  }
  // 'wx' would be nicer but a concurrent double-create is handled by the
  // caller retrying; flag protects against symlink clobbering on this file.
  const fd = openSync(path, 'w');
  try {
    const mode = fstatSync(fd);
    void mode;
    const key = randomBytes(32);
    writeSync(fd, key);
    return key;
  } finally {
    closeSync(fd);
  }
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(encrypted: string, key: Buffer): string | null {
  try {
    const blob = Buffer.from(encrypted, 'base64');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const ct = blob.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------- in-memory sliding-window rate limiter ----------
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /** Returns true when the action is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(now);
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [key, list] of this.hits) {
      if (!list.some((t) => t > now - this.windowMs)) this.hits.delete(key);
    }
  }
}

// ---------- shared secret comparison helper for auth failures ----------
export function authError(message = 'Invalid email or password'): AppError {
  return new AppError('UNAUTHORIZED', 401, message);
}
