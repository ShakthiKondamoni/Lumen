import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.ts';
import { defaultSettings, type Settings } from '@lumen/shared';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

export class IdentityRepo {
  constructor(private readonly db: Db) {}

  userByEmail(email: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email);
  }

  userById(id: string): UserRow | undefined {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  createUser(email: string, name: string, passwordHash: string): UserRow {
    const user: UserRow = {
      id: randomUUID(),
      email,
      name,
      password_hash: passwordHash,
      created_at: new Date().toISOString(),
    };
    this.db.run(
      'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      user.id,
      user.email,
      user.name,
      user.password_hash,
      user.created_at,
    );
    this.db.run(
      'INSERT INTO user_settings (user_id) VALUES (?)',
      user.id,
    );
    return user;
  }

  createSession(userId: string, tokenHash: string, expiresAt: Date): SessionRow {
    const row: SessionRow = {
      id: randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    };
    this.db.run(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      row.id,
      row.user_id,
      row.token_hash,
      row.expires_at,
      new Date().toISOString(),
    );
    return row;
  }

  sessionByTokenHash(tokenHash: string): SessionRow | undefined {
    return this.db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  deleteAllSessions(userId: string): void {
    this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  purgeExpiredSessions(now = new Date()): void {
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
  }

  audit(userId: string | null, event: string, detail?: unknown): void {
    this.db.run(
      'INSERT INTO audit_events (id, user_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?)',
      randomUUID(),
      userId,
      event,
      detail === undefined ? null : JSON.stringify(detail),
      new Date().toISOString(),
    );
  }

  getSettings(userId: string): Settings {
    const row = this.db.get<{
      theme: string;
      density: string;
      reduced_motion: number;
      desired_retention: number;
    }>('SELECT * FROM user_settings WHERE user_id = ?', userId);
    if (!row) return defaultSettings;
    return {
      theme: row.theme as Settings['theme'],
      density: row.density as Settings['density'],
      reducedMotion: row.reduced_motion === 1,
      desiredRetention: row.desired_retention,
    };
  }

  putSettings(userId: string, s: Settings): void {
    this.db.run(
      `INSERT INTO user_settings (user_id, theme, density, reduced_motion, desired_retention)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, density = excluded.density,
         reduced_motion = excluded.reduced_motion, desired_retention = excluded.desired_retention`,
      userId,
      s.theme,
      s.density,
      s.reducedMotion ? 1 : 0,
      s.desiredRetention,
    );
  }
}
