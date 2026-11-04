import type { Db } from '../db/db.ts';
import { errors } from '../core.ts';
import { IdentityRepo } from '../repos/identity.ts';
import { hashPassword, verifyPassword, newSessionToken, hashToken, loadMasterKey } from '../security.ts';
import type { Config } from '../config.ts';

// ---------- account service (register / login / session lifecycle) ----------
export class AccountService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
  ) {}

  async register(email: string, name: string, password: string) {
    const identity = new IdentityRepo(this.db);
    const existing = identity.userByEmail(email);
    if (existing) throw errors.conflict('An account with this email already exists');
    const passwordHash = await hashPassword(password);
    const user = identity.createUser(email, name, passwordHash);
    identity.audit(user.id, 'auth.register', { email });
    return user;
  }

  async login(email: string, password: string) {
    const identity = new IdentityRepo(this.db);
    const user = identity.userByEmail(email);
    // Always run a hash comparison to keep timing uniform.
    const stored = user?.password_hash ?? (await hashPassword('timing-pad-value'));
    const ok = await verifyPassword(password, stored);
    if (!user || !ok) throw errors.unauthorized('Invalid email or password');
    const token = newSessionToken();
    const expires = new Date(Date.now() + 30 * 86_400_000);
    identity.createSession(user.id, hashToken(token), expires);
    identity.audit(user.id, 'auth.login', {});
    identity.purgeExpiredSessions();
    return { user, token, expires };
  }

  logout(token: string): void {
    const identity = new IdentityRepo(this.db);
    identity.deleteSession(hashToken(token));
  }

  logoutAll(userId: string): void {
    const identity = new IdentityRepo(this.db);
    identity.deleteAllSessions(userId);
    identity.audit(userId, 'auth.logout-all', {});
  }

  masterKey(): Buffer {
    return loadMasterKey(this.config.secretKeyPath);
  }
}
