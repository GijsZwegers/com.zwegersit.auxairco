import { createHash } from 'node:crypto';
import { login, AuxLoginResult } from './client';
import { login as legacyLogin, LegacyAuxLoginResult } from './legacyClient';
import { LegacyRegion } from './legacyConstants';
import { isSessionExpired, loginFailureReason, LoginFailureReason } from './errors';
import AuthPausedError from './authPausedError';

export { default as AuthPausedError } from './authPausedError';

export interface Credentials {
  email: string;
  password: string;
  protocol: 'new' | 'legacy';
  country: string;
  region?: LegacyRegion;
}

export type CloudSession = AuxLoginResult | LegacyAuxLoginResult;

interface Failure {
  reason: LoginFailureReason;
  retryAfter: number;
  notified?: boolean;
}

interface AuthHost {
  settings: { get(key: string): unknown; set(key: string, value: unknown): void; unset(key: string): void };
  __(key: string, tokens?: Record<string, string>): string;
  notifications: { createNotification(options: { excerpt: string }): Promise<unknown> };
}

export function accountKey(credentials: Credentials): string {
  return createHash('sha256').update(JSON.stringify([
    credentials.protocol, credentials.protocol === 'legacy' ? credentials.region : credentials.country,
    credentials.email.trim().toLowerCase(),
  ])).digest('hex');
}

const LOCK_WAIT_MS = 10 * 60 * 1000;

export class AuthManager {

  private sessions = new Map<string, { password: string; session: CloudSession }>();
  private pending = new Map<string, Promise<CloudSession>>();
  private host: AuthHost;
  private now: () => number;

  constructor(host: AuthHost, now: () => number = Date.now) {
    this.host = host;
    this.now = now;
  }

  private settingKey(credentials: Credentials): string {
    return `aux_auth_${accountKey(credentials)}`;
  }

  private failure(credentials: Credentials): Failure | null {
    return (this.host.settings.get(this.settingKey(credentials)) as Failure | undefined) ?? null;
  }

  private paused(failure: Failure): AuthPausedError {
    let key = failure.reason;
    if (failure.retryAfter <= this.now() && (key === 'locked' || key === 'lock_warning')) key = 'login_failed';
    return new AuthPausedError(this.host.__(`auth.${key}`), failure.reason);
  }

  assertAllowed(credentials: Credentials, manual = false): void {
    const failure = this.failure(credentials);
    // Waiting alone never resumes automatic attempts. Repair is required.
    if (failure && (!manual || failure.retryAfter > this.now())) throw this.paused(failure);
  }

  seed(credentials: Credentials, session: CloudSession): void {
    const key = accountKey(credentials);
    if (!this.sessions.has(key) && !this.failure(credentials)) {
      this.sessions.set(key, { password: credentials.password, session });
    }
  }

  private pause(credentials: Credentials, reason: LoginFailureReason): AuthPausedError {
    const existing = this.failure(credentials);
    const failure: Failure = {
      reason,
      retryAfter: reason === 'locked' || reason === 'lock_warning' ? this.now() + LOCK_WAIT_MS : 0,
      notified: existing?.notified,
    };
    this.sessions.delete(accountKey(credentials));
    this.host.settings.set(this.settingKey(credentials), failure);
    return this.paused(failure);
  }

  async notifyOnce(credentials: Credentials, message: string): Promise<void> {
    const failure = this.failure(credentials);
    if (!failure || failure.notified) return;
    // Claim before awaiting so multiple devices cannot send duplicates.
    this.host.settings.set(this.settingKey(credentials), { ...failure, notified: true });
    try {
      await this.host.notifications.createNotification({ excerpt: `AUX Airco: ${message}` });
    } catch (error) {
      const latest = this.failure(credentials);
      if (latest) this.host.settings.set(this.settingKey(credentials), { ...latest, notified: false });
      throw error;
    }
  }

  async authenticate(credentials: Credentials, manual = false, rejected?: CloudSession): Promise<CloudSession> {
    this.assertAllowed(credentials, manual);
    const key = accountKey(credentials);
    const pending = this.pending.get(key);
    if (pending) {
      await pending;
      this.assertAllowed(credentials, manual);
      const completed = this.sessions.get(key);
      if (completed?.password === credentials.password) return completed.session;
      return this.authenticate(credentials, manual);
    }
    const cached = this.sessions.get(key);
    if (!manual && cached && cached.session !== rejected) {
      // Old device credentials must not invalidate a newly repaired session.
      if (cached.password !== credentials.password) {
        throw new AuthPausedError(this.host.__('auth.invalid_credentials'), 'invalid_credentials');
      }
      return cached.session;
    }
    const attempt = (async () => {
      try {
        const session = credentials.protocol === 'legacy'
          ? await legacyLogin(credentials.email, credentials.password, credentials.region as LegacyRegion)
          : await login(credentials.email, credentials.password, credentials.country);
        this.sessions.set(key, { password: credentials.password, session });
        this.host.settings.unset(this.settingKey(credentials));
        return session;
      } catch (error) {
        const reason = loginFailureReason(error);
        if (reason) throw this.pause(credentials, reason);
        throw error;
      }
    })();
    this.pending.set(key, attempt);
    try {
      return await attempt;
    } finally {
      this.pending.delete(key);
    }
  }

  async run<T>(credentials: Credentials, action: (session: CloudSession) => Promise<T>): Promise<T> {
    const session = await this.authenticate(credentials);
    try {
      this.assertAllowed(credentials);
      const result = await action(session);
      this.assertAllowed(credentials);
      return result;
    } catch (error) {
      const reason = loginFailureReason(error);
      if (reason) throw this.pause(credentials, reason);
      // Network/server/device errors do not justify another password login.
      if (!isSessionExpired(error)) throw error;
      const renewed = await this.authenticate(credentials, false, session);
      try {
        this.assertAllowed(credentials);
        const result = await action(renewed);
        this.assertAllowed(credentials);
        return result;
      } catch (retryError) {
        const retryReason = loginFailureReason(retryError);
        if (retryReason) throw this.pause(credentials, retryReason);
        throw retryError;
      }
    }
  }

}

const managers = new WeakMap<object, AuthManager>();

export function getAuthManager(host: AuthHost): AuthManager {
  let manager = managers.get(host);
  if (!manager) {
    manager = new AuthManager(host);
    managers.set(host, manager);
  }
  return manager;
}
