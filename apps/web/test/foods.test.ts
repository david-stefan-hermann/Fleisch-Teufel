import { N, uuidv7, type AiLabelResult, type CustomFood, type Food, type Meal } from '@ft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import {
  applyLabel,
  initFromFood,
  kcalSource,
  nutrientError,
  resetKcal,
  setField,
  toNutrients,
  type NutrientFormState,
} from '@/features/foods/customFoodForm';
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
      groupName: null,
      photoId: null,
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
      groupName: null,
      photoId: null,
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

describe('custom food form', () => {
  const type = (
    s: NutrientFormState,
    fields: Partial<Record<Parameters<typeof setField>[1], number | null>>,
  ) =>
    Object.entries(fields).reduce((acc, [k, v]) => setField(acc, k as Parameters<typeof setField>[1], v), s);

  it('starts empty with automatic kcal and asks for kcal or macros', () => {
    const s = initFromFood(null);
    expect(s.kcalAuto).toBe(true);
    expect(s.values.kcal).toBeNull();
    expect(nutrientError(s)).toBe('Kalorien oder Makros angeben.');
    expect(toNutrients(s, 1)).toEqual({});
  });

  it('computes kcal from the macros (EU formula) and kJ from the kcal', () => {
    const s = type(initFromFood(null), { protein: 4, carbs: 38, fat: 13, fiber: 1.8 });
    expect(s.values.kcal).toBeCloseTo(288.6, 6);
    expect(Math.round(s.values.kcal!)).toBe(289);
    expect(s.values.kj).toBeCloseTo(288.6 * 4.184, 6);
    expect(kcalSource(s)).toBe('macros');
    expect(nutrientError(s)).toBeNull();
    // Sugar and saturated fat do not change the energy.
    expect(type(s, { sugar: 22, satFat: 6 }).values.kcal).toBeCloseTo(288.6, 6);
    // Removing every macro empties the kcal again.
    const none = type(s, { protein: null, carbs: null, fat: null, fiber: null });
    expect(none.values.kcal).toBeNull();
    expect(none.values.kj).toBeNull();
  });

  it('typed kcal win until reset or emptied', () => {
    let s = type(initFromFood(null), { protein: 15, carbs: 16, fat: 6.2, fiber: 4.5 });
    expect(s.values.kcal).toBeCloseTo(188.8, 6);
    s = setField(s, 'kcal', 175);
    expect(kcalSource(s)).toBe('kcal');
    expect(s.values.kj).toBeCloseTo(175 * 4.184, 6);
    s = setField(s, 'protein', 20);
    expect(s.values.kcal).toBe(175);
    expect(kcalSource(resetKcal(s))).toBe('macros');
    expect(resetKcal(s).values.kcal).toBeCloseTo(208.8, 6);
    s = setField(s, 'kcal', null);
    expect(kcalSource(s)).toBe('macros');
    expect(s.values.kcal).toBeCloseTo(208.8, 6);
  });

  it('typed kJ set the kcal; emptying them hands the energy back to the macros', () => {
    let s = type(initFromFood(null), { protein: 10 });
    s = setField(s, 'kj', 1000);
    expect(kcalSource(s)).toBe('kj');
    expect(s.values.kcal).toBeCloseTo(1000 / 4.184, 6);
    expect(s.values.kj).toBe(1000);
    // Typing kcal afterwards makes them the source again; kJ follow.
    const k = setField(s, 'kcal', 200);
    expect(kcalSource(k)).toBe('kcal');
    expect(k.values.kj).toBeCloseTo(836.8, 6);
    s = setField(s, 'kj', null);
    expect(kcalSource(s)).toBe('macros');
    expect(s.values.kcal).toBe(40);
  });

  it('couples salt and sodium both ways', () => {
    let s = setField(initFromFood(null), 'salt', 0.2);
    expect(s.values.sodium).toBeCloseTo(80, 6);
    expect(s.sodiumAuto).toBe(true);
    s = setField(s, 'sodium', 400);
    expect(s.values.salt).toBeCloseTo(1, 6);
    expect(s.sodiumAuto).toBe(false);
    s = setField(s, 'salt', 0.5);
    expect(s.values.sodium).toBeCloseTo(200, 6);
    expect(s.sodiumAuto).toBe(true);
    s = setField(s, 'sodium', null);
    expect(s.values.salt).toBeNull();
  });

  it('recognizes the modes of a stored food', () => {
    const auto = initFromFood({
      [N.kcal]: 288.6,
      [N.kj]: 1207.5,
      [N.protein]: 4,
      [N.carbs]: 38,
      [N.fat]: 13,
      [N.fiber]: 1.8,
      [N.salt]: 0.2,
      [N.sodium]: 80,
    });
    expect(auto).toMatchObject({ kcalAuto: true, kjAuto: true, sodiumAuto: true });
    // The old 4/4/9 kcal (285) are an own input now; a label kJ value is kept.
    const own = initFromFood({ [N.kcal]: 285, [N.protein]: 4, [N.carbs]: 38, [N.fat]: 13, [N.fiber]: 1.8 });
    expect(own.kcalAuto).toBe(false);
    expect(own.values.kcal).toBe(285);
    expect(own.values.kj).toBeCloseTo(285 * 4.184, 6);
    const label = initFromFood({ [N.kcal]: 389, [N.kj]: 1650, [N.salt]: 0.4, [N.sodium]: 300 });
    expect(label).toMatchObject({ kcalAuto: false, kjAuto: false, sodiumAuto: false });
    expect(label.values).toMatchObject({ kcal: 389, kj: 1650, salt: 0.4, sodium: 300 });
    expect(kcalSource(label)).toBe('kcal');
    // Only kJ or only sodium: they are the sources.
    const kj = initFromFood({ [N.kj]: 836.8 });
    expect(kj.values.kcal).toBeCloseTo(200, 6);
    expect(kcalSource(kj)).toBe('kj');
    const na = initFromFood({ [N.kcal]: 100, [N.sodium]: 400 });
    expect(na.values.salt).toBeCloseTo(1, 6);
    expect(na.sodiumAuto).toBe(false);
  });

  it('scales every set value to 100 g and keeps the automatic kcal recognizable', () => {
    const portion = type(initFromFood(null), { protein: 15, carbs: 16, fat: 6.2, fiber: 4.5, salt: 0.18 });
    const per100 = toNutrients(portion, 100 / 45);
    expect(Object.keys(per100).sort()).toEqual(
      [N.kcal, N.kj, N.protein, N.carbs, N.fat, N.fiber, N.salt, N.sodium].sort(),
    );
    expect(per100[N.protein]).toBe(33.333);
    expect(initFromFood(per100).kcalAuto).toBe(true);
  });
});

describe('label reading fills the custom food form', () => {
  const label = (over: Partial<AiLabelResult> = {}): AiLabelResult => ({
    analysisId: 'a',
    name: 'Proteinriegel Schoko',
    brand: 'Bergkorn',
    barcode: '4006040123453',
    unit: 'g',
    basis: 'per100',
    servingGrams: 45,
    servingLabel: '1 Riegel',
    nutrients: {
      kcal: 389,
      kj: 1628,
      protein: 33,
      carbs: 36,
      sugar: 4.7,
      fat: 13.8,
      satFat: 7.6,
      fiber: null,
      salt: 0.4,
      sodium: null,
    },
    notes: 'Ballaststoffe nicht angegeben.',
    model: 'claude-opus-5-5',
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    ...over,
  });
  const filled = {
    name: 'Alt',
    brand: 'Alte Marke',
    barcode: '96385074',
    unit: 'ml' as const,
    mode: 'per100' as const,
    servingGrams: null,
    portions: [],
    nutrients: setField(initFromFood(null), 'fiber', 9),
  };

  it('overwrites the form with the values per 100 g and marks what changed', () => {
    const { next, changed } = applyLabel(filled, label(), null);
    expect(next).toMatchObject({
      name: 'Proteinriegel Schoko',
      brand: 'Bergkorn',
      barcode: '4006040123453',
      unit: 'g',
    });
    // All ten values are replaced: fiber was not on the label, so it is empty now.
    expect(next.nutrients.values).toMatchObject({ kcal: 389, kj: 1628, protein: 33, fiber: null, salt: 0.4 });
    expect(next.nutrients.values.sodium).toBeCloseTo(160, 6);
    // Label kcal differ from the formula (400): an own input, kJ stay as printed.
    expect(kcalSource(next.nutrients)).toBe('kcal');
    expect(next.nutrients.kjAuto).toBe(true);
    // The printed serving becomes a portion.
    expect(next.portions).toEqual([{ label: '1 Riegel', grams: 45 }]);
    expect(changed).toEqual(
      expect.arrayContaining(['name', 'brand', 'barcode', 'unit', 'portions', 'kcal', 'kj', 'salt']),
    );
    expect(changed).not.toContain('fiber');
    expect(changed).not.toContain('mode');
  });

  it('switches to values per portion with the serving size', () => {
    const { next, changed } = applyLabel(
      filled,
      label({ basis: 'perPortion', nutrients: { ...label().nutrients, kcal: 175, kj: 732 } }),
      null,
    );
    expect(next.mode).toBe('perPortion');
    expect(next.servingGrams).toBe(45);
    expect(next.portions).toEqual([]);
    expect(changed).toEqual(expect.arrayContaining(['mode', 'servingGrams']));
  });

  it('prefers the code read on the device and keeps fields the label does not show', () => {
    const local = applyLabel(filled, label(), '4006040123460');
    expect(local.next.barcode).toBe('4006040123460');
    const none = applyLabel(filled, label({ name: null, brand: null, barcode: null }), null);
    expect(none.next).toMatchObject({ name: 'Alt', brand: 'Alte Marke', barcode: '96385074' });
    expect(none.changed).not.toContain('name');
    expect(none.changed).not.toContain('barcode');
  });

  it('keeps the kcal automatic when the label matches the EU formula', () => {
    const { next } = applyLabel(
      filled,
      label({
        nutrients: {
          ...label().nutrients,
          kcal: 288.6,
          kj: null,
          protein: 4,
          carbs: 38,
          fat: 13,
          fiber: 1.8,
        },
      }),
      null,
    );
    expect(kcalSource(next.nutrients)).toBe('macros');
    expect(next.nutrients.values.kj).toBeCloseTo(288.6 * 4.184, 6);
  });
});
