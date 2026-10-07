import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OffRateLimitedError } from '../src/off/client.js';
import { createTestContext, offFood, registeredClient, TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let c: TestClient;
let offDown = false;
let rateLimited = false;

beforeAll(async () => {
  ctx = await createTestContext({
    off: {
      async product(ean) {
        if (rateLimited) throw new OffRateLimitedError(1000);
        if (offDown) throw new Error('down');
        return ean === '4000417025005' ? offFood(ean, 'Nugat') : null;
      },
      async search(q) {
        if (rateLimited) throw new OffRateLimitedError(1000);
        return q.includes('nugat')
          ? [offFood('4000417025005', 'Nugat'), offFood('4000000000002', 'Nugat Creme')]
          : [];
      },
    },
  });
  c = await registeredClient(ctx);
});
afterAll(() => ctx.close());

describe('foods API', () => {
  it('requires a session', async () => {
    expect((await new TestClient(ctx.app).get('/api/foods/bls:C133000')).status).toBe(401);
  });

  it('serves BLS foods with all components from the seeded catalog', async () => {
    const r = await c.get('/api/foods/bls:C133000');
    expect(r.status).toBe(200);
    expect(r.json.food).toMatchObject({
      name: 'Hafer Flocken',
      source: 'bls',
      group: 'Getreide & Getreideprodukte',
    });
    expect(r.json.food.nutrients.VITB12).toBe(0); // beyond the compact set
    expect((await c.get('/api/foods/bls:NOPE')).status).toBe(404);
    const [row] = await ctx.db.$client`select count(*)::int as n from foods where source = 'bls'`;
    expect(row!.n).toBe(6);
  });

  it('looks up barcodes once and caches them', async () => {
    const first = await c.get('/api/foods/barcode/4000417025005');
    expect(first.json.food.name).toBe('Nugat');
    await c.get('/api/foods/barcode/4000417025005');
    expect(ctx.off.calls.filter((x) => x === 'product:4000417025005')).toHaveLength(1);
    // Cached products are also available by id.
    expect((await c.get('/api/foods/off:4000417025005')).json.food.brand).toBe('Marke');
  });

  it('remembers unknown barcodes for a day', async () => {
    expect((await c.get('/api/foods/barcode/1111111111116')).status).toBe(404);
    expect((await c.get('/api/foods/barcode/1111111111116')).status).toBe(404);
    expect(ctx.off.calls.filter((x) => x === 'product:1111111111116')).toHaveLength(1);
    expect((await c.get('/api/foods/barcode/12')).status).toBe(404);
  });

  it('reports upstream problems distinctly', async () => {
    offDown = true;
    expect((await c.get('/api/foods/barcode/5000000000001')).status).toBe(502);
    offDown = false;
    rateLimited = true;
    const r = await c.get('/api/foods/barcode/5000000000002');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('1');
    rateLimited = false;
  });

  it('searches OFF, caches results, and falls back to the cache when limited', async () => {
    const r = await c.get('/api/foods/search?q=nugat');
    expect(r.json).toMatchObject({ limited: false });
    expect(r.json.foods.map((f: { name: string }) => f.name)).toEqual(['Nugat', 'Nugat Creme']);
    rateLimited = true;
    const limited = await c.get('/api/foods/search?q=nugat creme');
    expect(limited.json.limited).toBe(true);
    expect(limited.json.foods[0].name).toBe('Nugat Creme');
    rateLimited = false;
    expect((await c.get('/api/foods/search?q=n')).json.foods).toEqual([]);
  });

  it('offers a local search over BLS and cached OFF products', async () => {
    const r = await c.get('/api/foods/search?q=haehnchen brust&source=local');
    expect(r.json.foods[0].name).toBe('Hähnchen Brust, ohne Haut, roh');
  });
});
