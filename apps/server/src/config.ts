import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  LUMEN_DATA_DIR: z.string().min(1).default('./data'),
  LUMEN_PORT: z.coerce.number().int().min(1).max(65535).default(8687),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.string().default('development'),
});

export type Config = {
  dataDir: string;
  dbPath: string;
  filesDir: string;
  exportsDir: string;
  secretKeyPath: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  isProd: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const dataDir = resolve(parsed.LUMEN_DATA_DIR);
  mkdirSync(dataDir, { recursive: true });
  const filesDir = resolve(dataDir, 'files');
  const exportsDir = resolve(dataDir, 'exports');
  mkdirSync(filesDir, { recursive: true });
  mkdirSync(exportsDir, { recursive: true });
  return {
    dataDir,
    dbPath: resolve(dataDir, 'lumen.sqlite'),
    filesDir,
    exportsDir,
    secretKeyPath: resolve(dataDir, 'secret.key'),
    port: parsed.LUMEN_PORT,
    logLevel: parsed.LOG_LEVEL,
    isProd: parsed.NODE_ENV === 'production',
  };
}
