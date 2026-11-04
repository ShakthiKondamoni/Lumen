import { randomUUID } from 'node:crypto';

// ---------- errors ----------
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  badRequest: (m = 'Invalid request') => new AppError('BAD_REQUEST', 400, m),
  unauthorized: (m = 'Sign in required') => new AppError('UNAUTHORIZED', 401, m),
  forbidden: (m = 'Not allowed') => new AppError('FORBIDDEN', 403, m),
  notFound: (m = 'Not found') => new AppError('NOT_FOUND', 404, m),
  conflict: (m = 'Already exists') => new AppError('CONFLICT', 409, m),
  payloadTooLarge: (m = 'File too large') => new AppError('PAYLOAD_TOO_LARGE', 413, m),
  unsupportedMedia: (m = 'Unsupported file type') => new AppError('UNSUPPORTED_MEDIA', 415, m),
  rateLimited: (m = 'Too many requests') => new AppError('RATE_LIMITED', 429, m),
  noProvider: (m = 'No AI provider is configured for this task') => new AppError('NO_PROVIDER', 503, m),
  upstream: (m = 'AI provider request failed') => new AppError('UPSTREAM', 502, m),
};

// ---------- structured logging ----------
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: Level = 'info';

export function setLogLevel(level: Level): void {
  minLevel = level;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (order[level] < order[minLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

// ---------- request ids ----------
export function newRequestId(): string {
  return randomUUID();
}
