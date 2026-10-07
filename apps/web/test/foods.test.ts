import { uuidv7, type CustomFood, type Food, type Meal } from '@ft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import { saveRecord } from '@/db/write';
import {
  filterOwn,
  getFood,
  lookupBarcode,
  recentAndFrequent,
  searchLocal,
  usageBoost,
} from '@/foods/foodService';

const compact = {
  version: 't1',
  keys: ['ENERCC', 'ENERCJ', 'PROT625', 'FAT', 'CHO', 'FIBT', 'SUGAR', 'FASAT', 'NACL', 'NA', 'ALC'],
  rows: [
    ['C133000', 'Hafer Flocken', 'Oat flakes', 348, 1465, 13.2, 6.7, 53.3, 11, 0.7, 1.3, 0, 2, 0],
    ['F503100', 'Apfel roh', 'Apple raw', 54, 228, 0.3, 0.2, 12, 2, 10, 0, 0, 1, 0],
    ['B101000', 'Brötchen', 'Bread roll', 270, 1130, 9, 1.5, 54, 3, 2, 0.3, 1.2, 480, 0],
    ['B102000', 'Brötchen Weizen hell', 'Wheat roll', 260, 1090, 8.5, 1.2, 53, 3, 2, 0.3, 1.2, 470, 0],
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
    // Cached now, works without the server.
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
      groupId: null,
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
    // Usage covers every food of the last 90 days, also those logged once.
    expect(Object.fromEntries(r.usage)).toEqual({
      'bls:A': { count: 2, lastLoggedAt: 2 },
      'bls:B': { count: 1, lastLoggedAt: 3 },
    });
  });

  it('ranks previously logged foods first', async () => {
    const plain = (await searchLocal(db, 'brötchen')).map((h) => h.food.name);
    expect(plain).toEqual(['Brötchen', 'Brötchen Weizen hell']);

    await saveRecord(db, 'foodEntries', {
      id: uuidv7(),
      date: '2026-10-06',
      meal: 0,
      loggedAt: 1,
      foodId: 'bls:B102000',
      source: 'bls',
      name: 'Brötchen Weizen hell',
      brand: null,
      grams: 60,
      portionLabel: '1 g',
      portionGrams: 1,
      quantity: 60,
      per100: null,
      nutrients: { ENERCC: 156 },
      mealId: null,
      aiAnalysisId: null,
      groupId: null,
    });
    const { usage } = await recentAndFrequent(db, '2026-10-07');
    const ranked = await searchLocal(db, 'brötchen', 40, usage);
    expect(ranked.map((h) => h.food.name)).toEqual(['Brötchen Weizen hell', 'Brötchen']);
    // Usage only reorders matches, it never adds unrelated foods.
    expect((await searchLocal(db, 'apfel', 40, usage)).map((h) => h.food.name)).toEqual(['Apfel roh']);
  });

  it('boosts by usage count, capped', () => {
    const usage = new Map([
      ['a', { count: 1, lastLoggedAt: 0 }],
      ['b', { count: 50, lastLoggedAt: 0 }],
    ]);
    expect(usageBoost(usage, 'a')).toBe(66);
    expect(usageBoost(usage, 'b')).toBe(90);
    expect(usageBoost(usage, 'c')).toBe(0);
    expect(usageBoost(undefined, 'a')).toBe(0);
  });
});

describe('filterOwn', () => {
  const base = { updatedAt: 1, deleted: false };
  const custom = [
    {
      ...base,
      id: 'c1',
      name: 'Käsekuchen Oma',
      brand: null,
      barcode: null,
      unit: 'g',
      nutrients: {},
      portions: [],
    },
    {
      ...base,
      id: 'c2',
      name: 'Protein Riegel',
      brand: 'Müller',
      barcode: null,
      unit: 'g',
      nutrients: {},
      portions: [],
    },
  ] satisfies CustomFood[];
  const item = (name: string) => ({
    foodId: null,
    source: 'bls' as const,
    name,
    brand: null,
    grams: 100,
    portionLabel: null,
    portionGrams: null,
    quantity: 100,
    per100: null,
    nutrients: {},
  });
  const meals = [
    {
      ...base,
      id: 'm1',
      name: 'Frühstück Klassiker',
      items: [item('Haferflocken'), item('Apfel roh')],
      photoId: null,
    },
    { ...base, id: 'm2', name: 'Bowl', items: [item('Reis'), item('Hähnchen')], photoId: null },
  ] satisfies Meal[];

  it('keeps everything for an empty query', () => {
    const r = filterOwn('  ', custom, meals);
    expect(r.custom).toHaveLength(2);
    expect(r.meals).toHaveLength(2);
  });

  it('folds umlauts and matches names, brands and meal ingredients', () => {
    for (const q of ['kase', 'kaese', 'Käse'])
      expect(filterOwn(q, custom, meals).custom.map((c) => c.id)).toEqual(['c1']);
    expect(filterOwn('MULLER', custom, meals).custom.map((c) => c.id)).toEqual(['c2']);
    expect(filterOwn('hahnchen', custom, meals).meals.map((m) => m.id)).toEqual(['m2']);
    expect(filterOwn('klassiker', custom, meals).meals.map((m) => m.id)).toEqual(['m1']);
    const none = filterOwn('pizza', custom, meals);
    expect(none.custom).toEqual([]);
    expect(none.meals).toEqual([]);
  });
});
