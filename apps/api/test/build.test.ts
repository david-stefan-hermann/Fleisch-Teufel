/** The production build bundles the server and the password reset script that runs inside the image. */
import { execFile } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

const run = promisify(execFile);
const apiDir = join(import.meta.dirname, '..');
// Inside apps/api, so the bundles find the external @node-rs/argon2 in its node_modules like /app does in the image.
const out = join(apiDir, 'node_modules', '.cache', 'ft-build-test');

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestContext();
  await run('node', ['build.mjs'], { cwd: apiDir, env: { ...process.env, BUILD_OUT: out } });
}, 120_000);
afterAll(async () => {
  await ctx.close();
  rmSync(out, { recursive: true, force: true });
});

describe('build', () => {
  it('writes the server, the reset script, migrations and data', () => {
    for (const file of ['server.js', 'reset-password.js', 'drizzle/meta/_journal.json', 'data']) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
  });

  it('the bundled reset script sets a new password and ends all sessions', async () => {
    const old = await registeredClient(ctx, 'reset@example.com', 'old-password');
    const env = { ...process.env, DATABASE_URL: ctx.deps.env.DATABASE_URL };
    const { stdout } = await run(
      'node',
      [join(out, 'reset-password.js'), 'Reset@example.com', 'new-password'],
      {
        env,
      },
    );
    expect(stdout).toContain('password of reset@example.com set');

    expect((await old.get('/api/auth/me')).status).toBe(401);
    const c = new TestClient(ctx.app);
    expect(
      (await c.post('/api/auth/login', { email: 'reset@example.com', password: 'old-password' })).status,
    ).toBe(401);
    expect(
      (await c.post('/api/auth/login', { email: 'reset@example.com', password: 'new-password' })).status,
    ).toBe(200);
  });

  it('the bundled reset script prints its usage without an e-mail', async () => {
    await expect(run('node', [join(out, 'reset-password.js')])).rejects.toMatchObject({ code: 2 });
  });
});
