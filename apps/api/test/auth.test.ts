import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('auth', () => {
  it('lets the first user register while registration is closed, then closes it', async () => {
    const info1 = await new TestClient(ctx.app).get('/api/info');
    expect(info1.json.registrationOpen).toBe(true);

    const a = new TestClient(ctx.app);
    const r = await a.post('/api/auth/register', { email: 'Owner@Example.com ', password: 'correct horse' });
    expect(r.status).toBe(201);
    expect(r.json.user.email).toBe('owner@example.com');
    expect(a.cookie).toMatch(/^ft_session=/);

    const r2 = await new TestClient(ctx.app).post('/api/auth/register', {
      email: 'other@example.com',
      password: 'whatever123',
    });
    expect(r2.status).toBe(403);
    expect((await new TestClient(ctx.app).get('/api/info')).json.registrationOpen).toBe(false);
  });

  it('validates credentials', async () => {
    const r = await new TestClient(ctx.app).post('/api/auth/login', { email: 'not-an-email', password: 'x' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('validation');
  });

  it('logs in, reports the session user, and logs out', async () => {
    const c = new TestClient(ctx.app);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect(
      (await c.post('/api/auth/login', { email: 'owner@example.com', password: 'wrong-password' })).status,
    ).toBe(401);
    expect(
      (await c.post('/api/auth/login', { email: 'owner@example.com', password: 'correct horse' })).status,
    ).toBe(200);
    expect((await c.get('/api/auth/me')).json.user.email).toBe('owner@example.com');
    const token = c.cookie!.split('=')[1]!;
    // Bearer works as well (scripts).
    expect(
      (await new TestClient(ctx.app, { authorization: `Bearer ${token}` }).get('/api/auth/me')).status,
    ).toBe(200);
    await c.post('/api/auth/logout');
    expect(
      (await new TestClient(ctx.app, { authorization: `Bearer ${token}` }).get('/api/auth/me')).status,
    ).toBe(401);
  });

  it('marks the cookie Secure behind an HTTPS proxy', async () => {
    const c = new TestClient(ctx.app, { 'x-forwarded-proto': 'https' });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse' }),
    });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    void c;
  });

  it('rejects cross-origin state changes', async () => {
    const r = await new TestClient(ctx.app, {
      origin: 'https://evil.example',
      host: 'fleisch-teufel.avernus.cloud',
    }).post('/api/auth/login', {
      email: 'owner@example.com',
      password: 'correct horse',
    });
    expect(r.status).toBe(403);
    const ok = await new TestClient(ctx.app, {
      origin: 'https://fleisch-teufel.avernus.cloud',
      host: 'fleisch-teufel.avernus.cloud',
    }).post('/api/auth/login', { email: 'owner@example.com', password: 'correct horse' });
    expect(ok.status).toBe(200);
  });

  it('changes the password and signs out other devices', async () => {
    const phone = new TestClient(ctx.app);
    const laptop = new TestClient(ctx.app);
    await phone.post('/api/auth/login', { email: 'owner@example.com', password: 'correct horse' });
    await laptop.post('/api/auth/login', { email: 'owner@example.com', password: 'correct horse' });
    expect(
      (await phone.post('/api/auth/password', { currentPassword: 'nope', newPassword: 'battery staple' }))
        .status,
    ).toBe(401);
    expect(
      (
        await phone.post('/api/auth/password', {
          currentPassword: 'correct horse',
          newPassword: 'battery staple',
        })
      ).status,
    ).toBe(200);
    expect((await phone.get('/api/auth/me')).status).toBe(200);
    expect((await laptop.get('/api/auth/me')).status).toBe(401);
    expect(
      (
        await new TestClient(ctx.app).post('/api/auth/login', {
          email: 'owner@example.com',
          password: 'battery staple',
        })
      ).status,
    ).toBe(200);
  });

  it('lists the devices of an account and signs one out', async () => {
    const own = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const phone = new TestClient(own.app, { 'user-agent': 'iPhone Safari' });
      expect(
        (await phone.post('/api/auth/register', { email: 'devices@example.com', password: 'correct horse' }))
          .status,
      ).toBe(201);
      const laptop = new TestClient(own.app, { 'user-agent': 'Firefox' });
      await laptop.post('/api/auth/login', { email: 'devices@example.com', password: 'correct horse' });
      const list = (await phone.get('/api/auth/sessions')).json.sessions as {
        id: string;
        current: boolean;
        userAgent: string;
      }[];
      expect(list).toHaveLength(2);
      expect(list.find((s) => s.current)?.userAgent).toBe('iPhone Safari');
      const other = list.find((s) => !s.current)!;
      expect((await phone.req('DELETE', `/api/auth/sessions/${other.id}`)).status).toBe(200);
      expect((await laptop.get('/api/auth/me')).status).toBe(401);
      expect((await phone.get('/api/auth/me')).status).toBe(200);
      expect((await phone.req('DELETE', `/api/auth/sessions/${other.id}`)).status).toBe(404);
    } finally {
      await own.close();
    }
  });

  it('deletes an account with its data after the password is typed again', async () => {
    const own = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const c = new TestClient(own.app);
      await c.post('/api/auth/register', { email: 'bye@example.com', password: 'correct horse' });
      await c.post('/api/sync/push', {
        records: [
          {
            table: 'weightEntries',
            data: { id: 'w:2026-10-07', updatedAt: 1, deleted: false, date: '2026-10-07', kg: 80 },
          },
        ],
      });
      expect((await c.req('DELETE', '/api/auth/account', { password: 'wrong' })).status).toBe(401);
      expect((await c.req('DELETE', '/api/auth/account', { password: 'correct horse' })).status).toBe(200);
      expect((await c.get('/api/auth/me')).status).toBe(401);
      expect(
        (
          await new TestClient(own.app).post('/api/auth/login', {
            email: 'bye@example.com',
            password: 'correct horse',
          })
        ).status,
      ).toBe(401);
      const rows = await own.db.$client`select count(*)::int as n from weight_entries`;
      expect(rows[0]!.n).toBe(0);
    } finally {
      await own.close();
    }
  });

  it('ends a session two years after it was created, however active it is', async () => {
    const c = new TestClient(ctx.app);
    expect(
      (await c.post('/api/auth/login', { email: 'owner@example.com', password: 'battery staple' })).status,
    ).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    await ctx.db.execute(
      sql`update sessions set created_at = now() - interval '3 years', last_seen_at = now() - interval '2 days' where user_id in (select id from users where email = 'owner@example.com')`,
    );
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('rate-limits repeated failed logins', async () => {
    const c = new TestClient(ctx.app, { 'x-forwarded-for': '203.0.113.9' });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push(
        (await c.post('/api/auth/login', { email: 'brute@example.com', password: 'guess-' + i })).status,
      );
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.at(-1)).toBe(429);
  });

  it('refuses the right password too while the account is locked', async () => {
    const own = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const c = new TestClient(own.app, { 'x-forwarded-for': '203.0.113.10' });
      expect(
        (await c.post('/api/auth/register', { email: 'locked@example.com', password: 'correct horse' }))
          .status,
      ).toBe(201);
      const other = new TestClient(own.app, { 'x-forwarded-for': '203.0.113.11' });
      for (let i = 0; i < 10; i++)
        await other.post('/api/auth/login', { email: 'locked@example.com', password: 'guess-' + i });
      // A third IP with the right password: the account lock holds (brute force from many IPs).
      const third = new TestClient(own.app, { 'x-forwarded-for': '203.0.113.12' });
      const res = await third.post('/api/auth/login', {
        email: 'locked@example.com',
        password: 'correct horse',
      });
      expect(res.status).toBe(429);
      expect(res.json.retryAfterMs).toBeGreaterThan(0);
      // Another account from the same IP is not affected by the account lock.
      expect(
        (await third.post('/api/auth/login', { email: 'nobody@example.com', password: 'x'.repeat(10) }))
          .status,
      ).toBe(401);
    } finally {
      await own.close();
    }
  });
});

describe('registration', () => {
  it('answers a duplicate email with 409 and a simultaneous first user with 403', async () => {
    const own = await createTestContext();
    try {
      const results = await Promise.all(
        ['a@example.com', 'b@example.com', 'c@example.com'].map((email) =>
          new TestClient(own.app).post('/api/auth/register', { email, password: 'correct horse' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403]);
      const winner = results.find((r) => r.status === 201)!.json.user.email as string;
      expect(
        (
          await new TestClient(own.app).post('/api/auth/register', {
            email: winner,
            password: 'correct horse',
          })
        ).status,
      ).toBe(403);
    } finally {
      await own.close();
    }
    const open = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      const reg = (email: string) =>
        new TestClient(open.app).post('/api/auth/register', { email, password: 'correct horse' });
      expect((await reg('dup@example.com')).status).toBe(201);
      const dup = await reg('dup@example.com');
      expect(dup.status).toBe(409);
      expect(dup.json.error).toBe('email_taken');
    } finally {
      await open.close();
    }
  });
});

describe('registration flag', () => {
  it('allows further users when ALLOW_REGISTRATION=true', async () => {
    const open = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
    try {
      expect(
        (await new TestClient(open.app).post('/api/auth/register', { email: 'a@x.de', password: '12345678' }))
          .status,
      ).toBe(201);
      expect(
        (await new TestClient(open.app).post('/api/auth/register', { email: 'b@x.de', password: '12345678' }))
          .status,
      ).toBe(201);
      expect(
        (await new TestClient(open.app).post('/api/auth/register', { email: 'b@x.de', password: '12345678' }))
          .status,
      ).toBe(409);
    } finally {
      await open.close();
    }
  });
});
