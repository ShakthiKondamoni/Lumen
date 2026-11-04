import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { errors } from '../core.ts';

/**
 * File storage boundary: every uploaded file lives under filesDir keyed by a
 * random storage key. Path traversal is impossible because keys are generated
 * here and re-validated on every use.
 */
export class FileStorage {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private pathFor(storageKey: string): string {
    if (!/^[a-f0-9-]{36}$/.test(storageKey)) throw errors.badRequest('Invalid storage key');
    const p = resolve(this.root, storageKey);
    if (!p.startsWith(resolve(this.root))) throw errors.forbidden('Path escape rejected');
    return p;
  }

  async save(buffer: Buffer): Promise<{ storageKey: string; checksum: string }> {
    const storageKey = crypto.randomUUID();
    const p = this.pathFor(storageKey);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, buffer);
    return { storageKey, checksum: sha256(buffer) };
  }

  async read(storageKey: string): Promise<Buffer> {
    const p = this.pathFor(storageKey);
    if (!existsSync(p)) throw errors.notFound('File missing from storage');
    return readFile(p);
  }

  readStream(storageKey: string): NodeJS.ReadableStream {
    return createReadStream(this.pathFor(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
