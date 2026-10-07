import { credentialsSchema, loginSchema, type PublicUser } from '@ft/shared';
import { count, eq, and, ne } from 'drizzle-orm';
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
import { RateLimiter } from '../rate-limit.js';
import type { AppEnv, Deps } from '../types.js';
import { clientIp, parseJson } from './util.js';

export function toPublicUser(u: { id: string; email: string; createdAt: Date }): PublicUser {
  return { id: u.id, email: u.email, createdAt: u.createdAt.toISOString() };
}

export async function registrationOpen(deps: Deps): Promise<boolean> {
  if (deps.env.ALLOW_REGISTRATION) return true;
  const [row] = await deps.db.select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

export function authRoutes(deps: Deps) {
  const { db } = deps;
  // 10 failed logins per 15 minutes per IP and per account.
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const registerLimiter = new RateLimiter(5, 60 * 60_000);
  const app = new Hono<AppEnv>();

  app.post('/register', async (c) => {
    if (registerLimiter.take(clientIp(c)) > 0) return c.json({ error: 'too_many_requests' }, 429);
    const body = await parseJson(c, credentialsSchema);
    if (!body.ok) return body.response;
    if (!(await registrationOpen(deps))) return c.json({ error: 'registration_closed' }, 403);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, body.data.email));
    if (existing.length) return c.json({ error: 'email_taken' }, 409);
    const [user] = await db
      .insert(users)
      .values({ email: body.data.email, passwordHash: await hashPassword(body.data.password) })
      .returning();
    const token = await createSession(db, user!.id, c.req.header('user-agent'));
    setSessionCookie(c, token);
    return c.json({ user: toPublicUser(user!) }, 201);
  });

  app.post('/login', async (c) => {
    const body = await parseJson(c, loginSchema);
    if (!body.ok) return body.response;
    const ipKey = `ip:${clientIp(c)}`;
    const userKey = `user:${body.data.email}`;
    const [user] = await db.select().from(users).where(eq(users.email, body.data.email));
    const ok = user
      ? await verifyPassword(user.passwordHash, body.data.password)
      : await dummyVerify(body.data.password);
    if (!ok || !user) {
      const wait = Math.max(loginLimiter.take(ipKey), loginLimiter.take(userKey));
      if (wait > 0) return c.json({ error: 'too_many_requests', retryAfterMs: wait }, 429);
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    loginLimiter.reset(userKey);
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
    const [user] = await db.select().from(users).where(eq(users.id, me.id));
    if (!user || !(await verifyPassword(user.passwordHash, body.data.currentPassword))) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.data.newPassword) })
      .where(eq(users.id, me.id));
    // Sign out every other device.
    await db.delete(sessions).where(and(eq(sessions.userId, me.id), ne(sessions.id, me.sessionId)));
    return c.json({ ok: true });
  });

  return app;
}
