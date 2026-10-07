import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import type { AppEnv, SessionUser } from '../types.js';

export const SESSION_COOKIE = 'ft_session';
/** iOS home-screen apps should stay logged in; browsers cap cookies at 400 days. */
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

// OWASP recommendation for Argon2id: m=19 MiB, t=2, p=1.
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** A dummy hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing). */
let dummyHash: Promise<string> | undefined;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('not-a-real-password-' + randomBytes(8).toString('hex'));
  return dummyHash.then((h) => verifyPassword(h, password));
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(db: Db, userId: string, userAgent: string | undefined): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function resolveSession(db: Db, token: string): Promise<SessionUser | null> {
  const id = sha256(token);
  const now = new Date();
  const rows = await db
    .select({ s: sessions, u: { id: users.id, email: users.email, createdAt: users.createdAt } })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Sliding expiry, written at most once a day.
  if (now.getTime() - row.s.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, id));
  }
  return { ...row.u, sessionId: id };
}

/** Behind Nginx Proxy Manager the app sees HTTP; trust X-Forwarded-Proto for the Secure flag. */
export function isHttps(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto) return proto === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) });
}

/** Session token from cookie or `Authorization: Bearer` (scripts, tests). */
export function sessionToken(c: Context): string | undefined {
  const auth = c.req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return getCookie(c, SESSION_COOKIE);
}

export function requireUser(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = sessionToken(c);
    const user = token ? await resolveSession(db, token) : null;
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  };
}
