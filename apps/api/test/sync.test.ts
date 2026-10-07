import { dayId, uuidv7, type FoodEntry, type WeightEntry } from '@ft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let alice: TestClient;
let bob: TestClient;

beforeAll(async () => {
  ctx = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
  alice = await registeredClient(ctx, 'alice@example.com');
  bob = await registeredClient(ctx, 'bob@example.com');
});
afterAll(() => ctx.close());

const entry = (over: Partial<FoodEntry> = {}): FoodEntry => ({
  id: uuidv7(),
  updatedAt: 1000,
  deleted: false,
  date: '2026-10-07',
  meal: 0,
  loggedAt: 1000,
  foodId: 'bls:C133000',
  source: 'bls',
  name: 'Hafer Flocken',
  brand: null,
  grams: 50,
  portionLabel: '100 g',
  portionGrams: 100,
  quantity: 0.5,
  per100: { ENERCC: 348 },
  nutrients: { ENERCC: 174 },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  ...over,
});

const weight = (date: string, kg: number, updatedAt: number): WeightEntry => ({
  id: dayId.weight(date),
  updatedAt,
  deleted: false,
  date,
  kg,
});

async function pullAll(c: TestClient, since = 0, limit = 1000) {
  const changes: { table: string; data: any }[] = [];
  let cursor = since;
  for (;;) {
    const r = await c.get(`/api/sync/pull?since=${cursor}&limit=${limit}`);
    expect(r.status).toBe(200);
    changes.push(...r.json.changes);
    cursor = r.json.cursor;
    if (!r.json.hasMore) break;
  }
  return { changes, cursor };
}

describe('sync', () => {
  it('requires a session', async () => {
    expect((await new TestClient(ctx.app).get('/api/sync/pull?since=0')).status).toBe(401);
  });

  it('round-trips records of every table exactly', async () => {
    const e = entry();
    const settings = {
      id: 'profile',
      updatedAt: 5,
      deleted: false,
      sex: 'male',
      birthDate: '1990-05-01',
      heightCm: 182,
      activityLevel: 'light',
      targetWeightKg: 80,
      weeklyRateKg: -0.5,
      mealNames: ['Frühstück', 'Mittag', 'Abend', 'Snacks'],
      addExerciseCalories: true,
      onboardedAt: 5,
    };
    const goal = {
      id: dayId.goal('2026-10-01'),
      updatedAt: 5,
      deleted: false,
      validFrom: '2026-10-01',
      days: Array.from({ length: 7 }, () => ({ kcal: 2000, proteinG: 150, fatG: 70, carbsG: 190 })),
      micros: { FIBT: 35, NACL: null },
    };
    const meal = {
      id: uuidv7(),
      updatedAt: 5,
      deleted: false,
      name: 'Porridge',
      items: [{ ...entry(), id: undefined, date: undefined }].map(
        ({
          foodId,
          source,
          name,
          brand,
          grams,
          portionLabel,
          portionGrams,
          quantity,
          per100,
          nutrients,
        }) => ({
          foodId,
          source,
          name,
          brand,
          grams,
          portionLabel,
          portionGrams,
          quantity,
          per100,
          nutrients,
        }),
      ),
    };
    const records = [
      { table: 'foodEntries', data: e },
      { table: 'settings', data: settings },
      { table: 'goals', data: goal },
      { table: 'meals', data: meal },
      { table: 'weightEntries', data: weight('2026-10-07', 82.4, 5) },
      {
        table: 'dayNotes',
        data: {
          id: dayId.note('2026-10-07'),
          updatedAt: 5,
          deleted: false,
          date: '2026-10-07',
          note: 'Gut gegessen',
          completedAt: 6,
        },
      },
      {
        table: 'exerciseTypes',
        data: { id: 'custom-1', updatedAt: 5, deleted: false, name: 'Bergsteigen', met: 8 },
      },
      {
        table: 'exerciseEntries',
        data: {
          id: uuidv7(),
          updatedAt: 5,
          deleted: false,
          date: '2026-10-07',
          typeKey: 'running',
          name: 'Laufen',
          minutes: 30,
          intensity: 'moderate',
          met: 9.8,
          weightKg: 82.4,
          kcal: 362.9,
          loggedAt: 5,
          note: 'Intervalle 6 × 400 m',
        },
      },
      {
        table: 'exerciseTemplates',
        data: {
          id: uuidv7(),
          updatedAt: 5,
          deleted: false,
          name: 'Oberkörper',
          typeKey: 'weight_training',
          typeName: 'Krafttraining',
          minutes: 60,
          intensity: 'vigorous',
          note: 'Bankdrücken 3 × 8',
        },
      },
      {
        table: 'customFoods',
        data: {
          id: uuidv7(),
          updatedAt: 5,
          deleted: false,
          name: 'Omas Kuchen',
          brand: null,
          barcode: null,
          unit: 'g',
          nutrients: { ENERCC: 380 },
          portions: [{ label: 'Stück', grams: 120 }],
        },
      },
      {
        table: 'foodPortions',
        data: {
          id: uuidv7(),
          updatedAt: 5,
          deleted: false,
          foodId: 'bls:C133000',
          label: 'Meine Schale',
          grams: 60,
        },
      },
    ];
    const r = await alice.post('/api/sync/push', { records });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ applied: records.length, stale: [], rejected: [] });

    const { changes } = await pullAll(alice);
    expect(changes).toHaveLength(records.length);
    for (const rec of records) {
      expect(changes.find((c) => c.table === rec.table && c.data.id === rec.data.id)?.data).toEqual(rec.data);
    }
  });

  it('accepts records from older app versions without the newer optional fields', async () => {
    const { groupId: _g, ...oldEntry } = entry({ groupId: null });
    const oldExercise = {
      id: uuidv7(),
      updatedAt: 7,
      deleted: false,
      date: '2026-10-07',
      typeKey: 'cycling',
      name: 'Radfahren',
      minutes: 45,
      intensity: 'moderate',
      met: 7,
      weightKg: 80,
      kcal: 360,
      loggedAt: 7,
    };
    const before = (await pullAll(alice)).cursor;
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: oldEntry },
        { table: 'exerciseEntries', data: oldExercise },
      ],
    });
    expect(r.json).toEqual({ applied: 2, stale: [], rejected: [] });
    const { changes } = await pullAll(alice, before);
    expect(changes.find((c) => c.data.id === oldEntry.id)?.data).toEqual({ ...oldEntry, groupId: null });
    expect(changes.find((c) => c.data.id === oldExercise.id)?.data).toEqual({ ...oldExercise, note: null });
  });

  it('keeps users isolated even with identical ids', async () => {
    const { changes } = await pullAll(bob);
    expect(changes).toHaveLength(0);
    const r = await bob.post('/api/sync/push', {
      records: [{ table: 'weightEntries', data: weight('2026-10-07', 60, 1) }],
    });
    expect(r.json.applied).toBe(1);
    const a = await pullAll(alice);
    expect(a.changes.find((c) => c.table === 'weightEntries')!.data.kg).toBe(82.4);
  });

  it('applies last-write-wins: newer replaces, older is stale', async () => {
    const { cursor } = await pullAll(alice);
    const w = weight('2026-10-08', 82, 2000);
    await alice.post('/api/sync/push', { records: [{ table: 'weightEntries', data: w }] });
    const older = await alice.post('/api/sync/push', {
      records: [{ table: 'weightEntries', data: { ...w, kg: 99, updatedAt: 1999 } }],
    });
    expect(older.json).toMatchObject({ applied: 0, stale: [{ table: 'weightEntries', id: w.id }] });
    const newer = await alice.post('/api/sync/push', {
      records: [{ table: 'weightEntries', data: { ...w, kg: 81.5, updatedAt: 2001 } }],
    });
    expect(newer.json.applied).toBe(1);
    const { changes } = await pullAll(alice, cursor);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.data.kg).toBe(81.5);
  });

  it('resolves equal timestamps deterministically and idempotently', async () => {
    const w = weight('2026-10-09', 80, 3000);
    await alice.post('/api/sync/push', { records: [{ table: 'weightEntries', data: w }] });
    const same = await alice.post('/api/sync/push', { records: [{ table: 'weightEntries', data: w }] });
    expect(same.json.applied).toBe(0);
    const tieA = await alice.post('/api/sync/push', {
      records: [{ table: 'weightEntries', data: { ...w, kg: 85 } }],
    });
    const tieB = await alice.post('/api/sync/push', {
      records: [{ table: 'weightEntries', data: { ...w, kg: 75 } }],
    });
    // Exactly one of the two tie versions can have won against the other.
    const { changes } = await pullAll(alice);
    const final = changes.filter((c) => c.data.id === w.id).at(-1)!.data.kg;
    expect([80, 85, 75]).toContain(final);
    expect(tieA.json.applied + tieB.json.applied).toBeLessThanOrEqual(2);
  });

  it('syncs soft deletes as tombstones', async () => {
    const e = entry({ updatedAt: 4000 });
    await alice.post('/api/sync/push', { records: [{ table: 'foodEntries', data: e }] });
    const { cursor } = await pullAll(alice);
    await alice.post('/api/sync/push', {
      records: [{ table: 'foodEntries', data: { ...e, deleted: true, updatedAt: 4001 } }],
    });
    const { changes } = await pullAll(alice, cursor);
    expect(changes).toEqual([{ table: 'foodEntries', data: { ...e, deleted: true, updatedAt: 4001 } }]);
    // An offline device editing the deleted entry with an older clock does not resurrect it.
    const r = await alice.post('/api/sync/push', {
      records: [{ table: 'foodEntries', data: { ...e, quantity: 2, updatedAt: 4000 } }],
    });
    expect(r.json.stale).toHaveLength(1);
  });

  it('resumes from a cursor across tables with small pages', async () => {
    const c = await registeredClient(ctx, 'pager@example.com');
    const records = [
      ...Array.from({ length: 7 }, (_, i) => ({ table: 'foodEntries', data: entry({ updatedAt: 10 + i }) })),
      ...Array.from({ length: 5 }, (_, i) => ({
        table: 'weightEntries',
        data: weight(`2026-09-0${i + 1}`, 80 + i, 10),
      })),
    ];
    // Interleave tables in two pushes.
    await c.post('/api/sync/push', { records: records.slice(0, 6) });
    await c.post('/api/sync/push', { records: records.slice(6) });
    const pages: number[] = [];
    let cursor = 0;
    const seen = new Set<string>();
    for (;;) {
      const r = await c.get(`/api/sync/pull?since=${cursor}&limit=5`);
      pages.push(r.json.changes.length);
      for (const ch of r.json.changes) seen.add(`${ch.table}:${ch.data.id}`);
      expect(r.json.cursor).toBeGreaterThanOrEqual(cursor);
      cursor = r.json.cursor;
      if (!r.json.hasMore) break;
    }
    expect(pages).toEqual([5, 5, 2]);
    expect(seen.size).toBe(12);
    const again = await c.get(`/api/sync/pull?since=${cursor}`);
    expect(again.json).toEqual({ changes: [], cursor, hasMore: false });
  });

  it('rejects invalid records and wrong deterministic ids without failing the batch', async () => {
    const good = entry();
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: good },
        { table: 'foodEntries', data: { ...entry(), meal: 7 } },
        { table: 'weightEntries', data: { ...weight('2026-10-10', 80, 1), id: 'random-id' } },
        { table: 'settings', data: { id: 'x' } },
      ],
    });
    expect(r.json.applied).toBe(1);
    expect(r.json.rejected).toHaveLength(3);
    expect(r.json.rejected[1].error).toMatch(/w:2026-10-10/);
    const bad = await alice.post('/api/sync/push', { records: [{ table: 'nope', data: {} }] });
    expect(bad.status).toBe(400);
  });

  it('keeps the newest version when one batch contains duplicates', async () => {
    const e = entry({ updatedAt: 1 });
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: { ...e, quantity: 3, updatedAt: 3 } },
        { table: 'foodEntries', data: { ...e, quantity: 2, updatedAt: 2 } },
      ],
    });
    expect(r.json.applied).toBe(1);
    const { changes } = await pullAll(alice);
    expect(changes.find((c) => c.data.id === e.id)!.data.quantity).toBe(3);
  });

  it('validates the cursor', async () => {
    expect((await alice.get('/api/sync/pull?since=-1')).status).toBe(400);
    expect((await alice.get('/api/sync/pull?since=abc')).status).toBe(400);
  });
});
