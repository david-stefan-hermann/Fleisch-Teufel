import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { blsToFood, loadBls } from '../src/foods/catalog.js';
import { createTestContext, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe('app', () => {
  it('reports health and server info', async () => {
    const h = await ctx.app.request('/health');
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: true, blsFoods: 6 });
    const info = await (await ctx.app.request('/api/info')).json();
    expect(info).toMatchObject({ name: 'Fleisch-Teufel', aiEnabled: false, blsVersion: 'test-1' });
  });

  it('sets security headers', async () => {
    const r = await ctx.app.request('/health');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects oversized JSON bodies', async () => {
    const r = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'x'.repeat(5 * 1024 * 1024) }),
    });
    expect(r.status).toBe(413);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const r = await ctx.app.request('/api/nope');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'not_found' });
  });

  it('serves the SPA with correct caching', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'ft-web-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>FT</title>');
    writeFileSync(join(dist, 'assets', 'index-AbCdEf12.js'), 'console.log(1)');
    writeFileSync(join(dist, 'sw.js'), 'self');
    const app = createApp(ctx.deps, { webDist: dist });
    const asset = await app.request('/assets/index-AbCdEf12.js');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const sw = await app.request('/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
    const deep = await app.request('/tagebuch/2026-10-07');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<title>FT</title>');
    expect((await app.request('/missing.png')).status).toBe(404);
  });
});

describe('env', () => {
  it('enables AI only with a key', () => {
    expect(loadEnv({ DATABASE_URL: 'x' }).aiEnabled).toBe(false);
    expect(loadEnv({ DATABASE_URL: 'x', ANTHROPIC_API_KEY: 'k' }).aiEnabled).toBe(true);
    expect(loadEnv({ DATABASE_URL: 'x', ANTHROPIC_API_KEY: 'k', AI_ENABLED: 'false' }).aiEnabled).toBe(false);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe('real BLS data file', () => {
  it('contains 7140 foods with Hafer at 343 kcal', () => {
    const bls = loadBls();
    expect(bls.foods).toHaveLength(7140);
    const oat = bls.foods.find((f) => f.code === 'C131000')!;
    expect(oat.nutrients.ENERCC).toBe(343);
    const food = blsToFood(oat);
    expect(food.nutrients.NACL).toBeDefined();
    expect(new Set(bls.foods.flatMap((f) => Object.keys(f.nutrients))).size).toBe(138);
  });
});
