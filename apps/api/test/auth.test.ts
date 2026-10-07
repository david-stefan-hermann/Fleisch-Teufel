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
