import { uuidv7, type Food } from '@ft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import { saveRecord } from '@/db/write';
import { getFood, lookupBarcode, recentAndFrequent, searchLocal } from '@/foods/foodService';

const compact = {
  version: 't1',
  keys: ['ENERCC', 'ENERCJ', 'PROT625', 'FAT', 'CHO', 'FIBT', 'SUGAR', 'FASAT', 'NACL', 'NA', 'ALC'],
  rows: [
    ['C133000', 'Hafer Flocken', 'Oat flakes', 348, 1465, 13.2, 6.7, 53.3, 11, 0.7, 1.3, 0, 2, 0],
    ['F503100', 'Apfel roh', 'Apple raw', 54, 228, 0.3, 0.2, 12, 2, 10, 0, 0, 1, 0],
  ],
};
const offFood: Food = {
  id: 'off:4000417025005',
  source: 'off',
  sourceId: '4000417025005',
  name: 'Nugat',
  nameEn: null,
  brand: 'Ritter Sport',
  group: null,
  unit: 'g',
  nutrients: { ENERCC: 496 },
  portions: [],
};

let db: UserDb;
beforeEach(() => {
  db = new UserDb(`f-${uuidv7()}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/data/bls-compact.json')
        return new Response(JSON.stringify(compact), { headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/foods/barcode/4000417025005'))
        return new Response(JSON.stringify({ food: offFood }), {
          headers: { 'content-type': 'application/json' },
        });
      if (url.startsWith('/api/foods/barcode/'))
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      if (url.startsWith('/api/foods/bls:')) throw new TypeError('offline');
      throw new TypeError('offline');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('food service', () => {
  it('searches offline BLS and own foods together; own foods win equal matches', async () => {
    await saveRecord(db, 'customFoods', {
      id: uuidv7(),
      name: 'Hafer Flocken Bio',
      brand: null,
      barcode: null,
      unit: 'g',
      nutrients: { ENERCC: 370 },
      portions: [],
    });
    await saveRecord(db, 'customFoods', {
      id: uuidv7(),
      name: 'Haferkekse von Oma',
      brand: null,
      barcode: null,
      unit: 'g',
      nutrients: { ENERCC: 450 },
      portions: [],
    });
    const hits = (await searchLocal(db, 'hafer flocken')).map((h) => h.food.name);
    expect(hits[0]).toBe('Hafer Flocken Bio');
    expect(hits).toContain('Hafer Flocken');
    expect((await searchLocal(db, 'haferkekse')).map((h) => h.food.name)).toEqual(['Haferkekse von Oma']);
  });

  it('falls back to the compact BLS entry when the server is unreachable', async () => {
    const f = await getFood(db, 'bls:C133000');
    expect(f).toMatchObject({ name: 'Hafer Flocken', group: 'Getreide & Getreideprodukte' });
    expect(f!.nutrients.NACL).toBe(0);
  });

  it('looks up barcodes: own foods, then cache, then server', async () => {
    await saveRecord(db, 'customFoods', {
      id: 'mine',
      name: 'Hausmarke',
      brand: null,
      barcode: '96385074',
      unit: 'g',
      nutrients: { ENERCC: 1 },
      portions: [],
    });
    expect(await lookupBarcode(db, '96385074')).toMatchObject({ status: 'found', food: { id: 'mine' } });
    expect(await lookupBarcode(db, '4000417025005')).toMatchObject({
      status: 'found',
      food: { name: 'Nugat' },
    });
    // Cached now — works without the server.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    expect(await lookupBarcode(db, '4000417025005')).toMatchObject({ status: 'found' });
    expect(await lookupBarcode(db, '1111111111116')).toEqual({ status: 'offline' });
  });

  it('reports unknown barcodes', async () => {
    expect(await lookupBarcode(db, '1111111111116')).toEqual({ status: 'not_found' });
  });

  it('derives recent and frequent foods from the diary', async () => {
    const base = {
      meal: 0,
      source: 'bls' as const,
      brand: null,
      grams: 50,
      portionLabel: '100 g',
      portionGrams: 100,
      quantity: 0.5,
      per100: null,
      nutrients: { ENERCC: 1 },
      mealId: null,
      aiAnalysisId: null,
    };
    await saveRecord(db, 'foodEntries', {
      ...base,
      id: uuidv7(),
      date: '2026-10-05',
      loggedAt: 1,
      foodId: 'bls:A',
      name: 'A',
    });
    await saveRecord(db, 'foodEntries', {
      ...base,
      id: uuidv7(),
      date: '2026-10-06',
      loggedAt: 2,
      foodId: 'bls:A',
      name: 'A',
    });
    await saveRecord(db, 'foodEntries', {
      ...base,
      id: uuidv7(),
      date: '2026-10-07',
      loggedAt: 3,
      foodId: 'bls:B',
      name: 'B',
    });
    await saveRecord(db, 'foodEntries', {
      ...base,
      id: uuidv7(),
      date: '2026-01-01',
      loggedAt: 0,
      foodId: 'bls:OLD',
      name: 'Old',
    });
    const r = await recentAndFrequent(db, '2026-10-07');
    expect(r.recent.map((x) => x.name)).toEqual(['B', 'A']);
    expect(r.frequent.map((x) => [x.name, x.count])).toEqual([['A', 2]]);
  });
});
