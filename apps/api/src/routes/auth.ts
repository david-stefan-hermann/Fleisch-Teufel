import { credentialsSchema, loginSchema, type PublicUser, type SessionInfo } from '@ft/shared';
import { count, eq, and, gt, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  dummyVerify,
  hashPassword,
  requireUser,
  sessionToken,
  setSessionCookie,
  verifyPassword,
} from '../auth/session.js';
import { sessions, users } from '../db/schema.js';
import { log } from '../log.js';
import { RateLimiter } from '../rate-limit.js';
import type { Db } from '../db/client.js';
import type { AppEnv, Deps } from '../types.js';
import { clientIp, parseJson } from './util.js';

export function toPublicUser(u: { id: string; email: string; createdAt: Date }): PublicUser {
  return { id: u.id, email: u.email, createdAt: u.createdAt.toISOString() };
}

export async function registrationOpen(
  deps: Pick<Deps, 'env'> & { db: Pick<Db, 'select'> },
): Promise<boolean> {
  if (deps.env.ALLOW_REGISTRATION) return true;
  const [row] = await deps.db.select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

/** Failed password checks per 15 minutes before a key is locked (IP, account with IP) or slowed. */
export const LOGIN_FAILURES = 10;
/** Wait before every login answer while an account has had too many failures from anywhere. */
export const LOGIN_SLOWDOWN_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function authRoutes(deps: Deps) {
  const { db } = deps;
  const loginLimiter = new RateLimiter(LOGIN_FAILURES, 15 * 60_000);
  const registerLimiter = new RateLimiter(deps.env.REGISTER_RATE_LIMIT, 60 * 60_000);
  const app = new Hono<AppEnv>();

  /**
   * The password check of a signed-in account (password change, account deletion), limited like a
   * login per account: a stolen session must not be able to guess the password. Null when it matches.
   */
  async function checkPassword(userId: string, password: string) {
    const key = `user:${userId}`;
    const locked = loginLimiter.blocked(key);
    if (locked > 0)
      return { body: { error: 'too_many_requests', retryAfterMs: locked }, status: 429 as const };
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user && (await verifyPassword(user.passwordHash, password))) return null;
    loginLimiter.take(key);
    log.warn('password check failed', { userId });
    return { body: { error: 'invalid_credentials' }, status: 401 as const };
  }

  app.post('/register', async (c) => {
    if (registerLimiter.take(clientIp(c)) > 0) return c.json({ error: 'too_many_requests' }, 429);
    const body = await parseJson(c, credentialsSchema);
    if (!body.ok) return body.response;
    const passwordHash = await hashPassword(body.data.password);
    // Count and insert under one lock: two first users at once must not both get in, and a
    // duplicate email is a 409 instead of a unique violation.
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('register'))`);
      if (!(await registrationOpen({ env: deps.env, db: tx })))
        return { error: 'registration_closed' as const };
      const [user] = await tx
        .insert(users)
        .values({ email: body.data.email, passwordHash })
        .onConflictDoNothing()
        .returning();
      return user ? { user } : { error: 'email_taken' as const };
    });
    if ('error' in outcome)
      return c.json({ error: outcome.error }, outcome.error === 'email_taken' ? 409 : 403);
    const token = await createSession(db, outcome.user.id, c.req.header('user-agent'));
    setSessionCookie(c, token);
    return c.json({ user: toPublicUser(outcome.user) }, 201);
  });

  app.post('/login', async (c) => {
    const body = await parseJson(c, loginSchema);
    if (!body.ok) return body.response;
    const ip = clientIp(c);
    const ipKey = `ip:${ip}`;
    const userIpKey = `user:${body.data.email}:${ip}`;
    const accountKey = `user:${body.data.email}`;
    // A locked IP, or this account from this IP, is refused before the (expensive) hash check, also
    // with the right password. Failures from anywhere only slow the account down: someone who knows
    // the email must not be able to lock its owner out.
    const locked = Math.max(loginLimiter.blocked(ipKey), loginLimiter.blocked(userIpKey));
    if (locked > 0) return c.json({ error: 'too_many_requests', retryAfterMs: locked }, 429);
    if (loginLimiter.blocked(accountKey) > 0) await sleep(LOGIN_SLOWDOWN_MS);
    const [user] = await db.select().from(users).where(eq(users.email, body.data.email));
    const ok = user
      ? await verifyPassword(user.passwordHash, body.data.password)
      : await dummyVerify(body.data.password);
    if (!ok || !user) {
      const wait = Math.max(loginLimiter.take(ipKey), loginLimiter.take(userIpKey));
      loginLimiter.take(accountKey);
      log.warn('login failed', { userId: user?.id ?? null, ip, locked: wait > 0 });
      if (wait > 0) return c.json({ error: 'too_many_requests', retryAfterMs: wait }, 429);
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    loginLimiter.reset(userIpKey);
    const token = await createSession(db, user.id, c.req.header('user-agent'));
    setSessionCookie(c, token);
    return c.json({ user: toPublicUser(user) });
  });

  app.post('/logout', async (c) => {
    const token = sessionToken(c);
    if (token) await deleteSession(db, token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/me', requireUser(db), (c) => c.json({ user: toPublicUser(c.get('user')) }));

  const changePassword = z.object({
    currentPassword: z.string(),
    newPassword: credentialsSchema.shape.password,
  });
  app.post('/password', requireUser(db), async (c) => {
    const body = await parseJson(c, changePassword);
    if (!body.ok) return body.response;
    const me = c.get('user');
    const refused = await checkPassword(me.id, body.data.currentPassword);
    if (refused) return c.json(refused.body, refused.status);
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.data.newPassword) })
      .where(eq(users.id, me.id));
    // Sign out every other device.
    await db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, me.sessionId)));
    return c.json({ ok: true });
  });

  /** The account's signed-in devices, newest activity first (ids are hashes, never tokens). */
  app.get('/sessions', requireUser(db), async (c) => {
    const me = c.get('user');
    const rows = await db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, me.id), gt(sessions.expiresAt, new Date())));
    const list: SessionInfo[] = rows
      .map((r) => ({
        id: r.id,
        createdAt: r.createdAt.getTime(),
        lastSeenAt: r.lastSeenAt.getTime(),
        userAgent: r.userAgent,
        current: r.id === me.sessionId,
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return c.json({ sessions: list });
  });

  /** Signs out one device of the account (also the current one). */
  app.delete('/sessions/:id', requireUser(db), async (c) => {
    const me = c.get('user');
    const id = c.req.param('id');
    const gone = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, me.id), eq(sessions.id, id)))
      .returning({ id: sessions.id });
    if (gone.length === 0) return c.json({ error: 'not_found' }, 404);
    if (id === me.sessionId) clearSessionCookie(c);
    return c.json({ ok: true });
  });

  /**
   * Deletes the account with everything it owns (cascade on every table) after the password was
   * typed again. The device wipes its own copy afterwards.
   */
  const deleteAccount = z.object({ password: z.string().min(1).max(256) });
  app.delete('/account', requireUser(db), async (c) => {
    const body = await parseJson(c, deleteAccount);
    if (!body.ok) return body.response;
    const me = c.get('user');
    const refused = await checkPassword(me.id, body.data.password);
    if (refused) return c.json(refused.body, refused.status);
    await db.delete(users).where(eq(users.id, me.id));
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  return app;
}
