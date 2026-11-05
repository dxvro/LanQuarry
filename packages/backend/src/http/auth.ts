import { createHash, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthStatus } from '../contract.js';
import { AppError } from './errors.js';
import { dropUpgradeAfterResponse } from './upgrade.js';

export const SESSION_COOKIE = 'cm_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 3600;

// Keys are "METHOD route-pattern" of the matched route, never the requested path, so percent-encoding or
// dot segments cannot turn a protected route into a public one. Every other matched route needs a login.
// The last four entries are the catch-all patterns of a static frontend (Phase 4).
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/health',
  'HEAD /api/health',
  'POST /api/auth/login',
  'GET /api/auth/status',
  'POST /api/auth/logout',
  'GET /',
  'HEAD /',
  'GET /*',
  'HEAD /*',
]);

const CATCH_ALL_ROUTES: ReadonlySet<string> = new Set(['GET /*', 'HEAD /*']);

// Unmatched requests are answered 404, but anything that could be meant as an API path (after decoding
// and normalising) is treated as protected, so a probe cannot tell which API paths exist.
export function targetsApi(url: string): boolean {
  let path = url.split('?')[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    return true;
  }
  const normalized = posix.normalize(path.replaceAll('\\', '/')).toLowerCase();
  return normalized === '/api' || normalized.startsWith('/api/');
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const raw of (header ?? '').split(';')) {
    const part = raw.trim();
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies[name] ??= decodeURIComponent(value);
    } catch {
      cookies[name] ??= value;
    }
  }
  return cookies;
}

export interface LoginLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  now?: () => number;
}

interface Attempts {
  failures: number;
  windowStart: number;
}

export class LoginLimiter {
  private readonly attempts = new Map<string, Attempts>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(options: LoginLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
  }

  // seconds until the next attempt is allowed, 0 if allowed now
  retryAfterSeconds(key: string): number {
    const entry = this.attempts.get(key);
    if (entry === undefined) return 0;
    const remaining = entry.windowStart + this.windowMs - this.now();
    if (remaining <= 0) {
      this.attempts.delete(key);
      return 0;
    }
    return entry.failures >= this.maxFailures ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(key: string): void {
    if (this.attempts.size > 1000) this.prune();
    const entry = this.attempts.get(key);
    if (entry === undefined || entry.windowStart + this.windowMs <= this.now()) {
      this.attempts.set(key, { failures: 1, windowStart: this.now() });
    } else {
      entry.failures++;
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private prune(): void {
    for (const [key, entry] of this.attempts) {
      if (entry.windowStart + this.windowMs <= this.now()) this.attempts.delete(key);
    }
  }
}

export interface AuthOptions {
  token: string | undefined;
  limiter?: LoginLimiter;
  failureDelayMs?: number;
}

export class Auth {
  private readonly tokenDigest: Buffer | null;
  private readonly sessionDigest: Buffer | null;
  readonly limiter: LoginLimiter;
  readonly failureDelayMs: number;

  constructor(options: AuthOptions) {
    this.tokenDigest = options.token === undefined ? null : digest(options.token);
    this.sessionDigest = options.token === undefined ? null : digest(`craftmanager-session:${options.token}`);
    this.limiter = options.limiter ?? new LoginLimiter();
    this.failureDelayMs = options.failureDelayMs ?? 400;
  }

  get enabled(): boolean {
    return this.tokenDigest !== null;
  }

  verifyToken(candidate: string): boolean {
    return this.tokenDigest !== null && timingSafeEqual(digest(candidate), this.tokenDigest);
  }

  private verifySession(candidate: string): boolean {
    return this.sessionDigest !== null && timingSafeEqual(digest(candidate), digest(this.sessionDigest.toString('hex')));
  }

  sessionValue(): string {
    return this.sessionDigest?.toString('hex') ?? '';
  }

  isAuthenticated(request: FastifyRequest): boolean {
    if (!this.enabled) return true;
    const header = request.headers.authorization;
    if (header !== undefined) {
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (match?.[1] !== undefined && this.verifyToken(match[1].trim())) return true;
    }
    const cookie = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    return cookie !== undefined && this.verifySession(cookie);
  }

  loginCookie(): string {
    return `${SESSION_COOKIE}=${this.sessionValue()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}

const loginBody = z.object({ token: z.string().min(1).max(500) });
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function registerAuth(app: FastifyInstance, auth: Auth): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!auth.enabled || auth.isAuthenticated(request)) return;
    if (request.is404) {
      if (!targetsApi(request.url)) return;
    } else {
      const route = `${request.method} ${request.routeOptions.url ?? ''}`;
      // the static catch-all also matches /api/... paths that have no route of their own; those stay protected
      if (PUBLIC_ROUTES.has(route) && !(CATCH_ALL_ROUTES.has(route) && targetsApi(request.url))) return;
    }
    dropUpgradeAfterResponse(request, reply);
    throw new AppError(401, 'UNAUTHORIZED', 'Anmeldung erforderlich. Bitte mit dem Zugriffstoken anmelden.');
  });

  app.get('/api/auth/status', async (request): Promise<AuthStatus> => ({
    authRequired: auth.enabled,
    authenticated: auth.isAuthenticated(request),
  }));

  app.post('/api/auth/login', async (request, reply) => {
    const { token } = loginBody.parse(request.body);
    if (!auth.enabled) return { authRequired: false, authenticated: true };
    const key = request.ip;
    const retryAfter = auth.limiter.retryAfterSeconds(key);
    if (retryAfter > 0) {
      void reply.header('Retry-After', String(retryAfter));
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Zu viele fehlgeschlagene Anmeldeversuche. Bitte in ${retryAfter} Sekunden erneut versuchen.`, {
        retryAfterSeconds: retryAfter,
      });
    }
    if (!auth.verifyToken(token)) {
      auth.limiter.recordFailure(key);
      await wait(auth.failureDelayMs);
      throw new AppError(401, 'INVALID_TOKEN', 'Das Zugriffstoken ist ungültig.');
    }
    auth.limiter.reset(key);
    void reply.header('Set-Cookie', auth.loginCookie());
    return { authRequired: true, authenticated: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    void reply.header('Set-Cookie', auth.clearCookie());
    return { authenticated: false };
  });
}
