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
  groupName: null,
  photoId: null,
  photoIds: null,
  note: null,
  diaryMealId: null,
  ...over,
});

const weight = (date: string, kg: number, updatedAt: number): WeightEntry => ({
  id: dayId.weight(date),
  updatedAt,
  deleted: false,
  date,
  kg,
  purgedAt: null,
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
      goalKind: 'gain_advanced',
      mealNames: ['Frühstück', 'Mittag', 'Abend', 'Snacks'],
      addExerciseCalories: true,
      onboardedAt: 5,
      macroPlan: { preset: 'gain', proteinPerKg: 2.0, fatPct: 25, carbsPct: null },
      weightStepKg: 0.01,
      weightRangeKg: 2,
      stepsMinimum: 2500,
      addStepsCalories: false,
      customMealNames: ['Kuchen bei Oma'],
      legacyMealNames: ['Frühstück', 'Mittag', 'Abend', 'Snacks'],
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
      photoId: 'photo-abc123',
      cookedGrams: 420.5,
      purgedAt: null,
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
      // A named group without a saved meal ("Nur eintragen" of an AI analysis).
      {
        table: 'foodEntries',
        data: entry({
          source: 'ai',
          groupId: uuidv7(),
          groupName: 'Mittag vom Foto',
          aiAnalysisId: uuidv7(),
          // The analysed photos, kept on every entry of the group; photoId is the first.
          ...((ids) => ({ photoId: ids[0]!, photoIds: ids }))([uuidv7(), uuidv7()]),
        }),
      },
      // A quick entry: values without a food, the full text in `note`, its beginning as the name.
      {
        table: 'foodEntries',
        data: entry({
          source: 'quick',
          foodId: null,
          name: 'Beim Italiener gegessen. Pizza Salami, dazu ein kleiner…',
          note: 'Beim Italiener gegessen. Pizza Salami, dazu ein kleiner gemischter Salat.\nDanach Espresso.',
        }),
      },
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
          // Logged from a saved training: the diary shows that training's name.
          templateId: uuidv7(),
          // One activity of a saved training with several, logged together.
          groupId: uuidv7(),
          steps: null,
          distanceM: null,
          purgedAt: null,
        },
      },
      // The day's steps from Apple Health: one per day with a deterministic id.
      {
        table: 'exerciseEntries',
        data: {
          id: dayId.steps('2026-10-07'),
          updatedAt: 5,
          deleted: false,
          date: '2026-10-07',
          typeKey: 'steps',
          name: 'Schritte',
          minutes: 76,
          intensity: 'moderate',
          met: 3.5,
          weightKg: 82.4,
          kcal: 261,
          loggedAt: 5,
          note: null,
          templateId: null,
          groupId: null,
          steps: 8432,
          distanceM: 6100,
          purgedAt: null,
        },
      },
      {
        table: 'exerciseTemplates',
        data: {
          id: uuidv7(),
          updatedAt: 5,
          // Deleted and removed from the trash for good: the tombstone still syncs.
          deleted: true,
          name: 'Oberkörper',
          typeKey: 'weight_training',
          typeName: 'Krafttraining',
          minutes: 60,
          intensity: 'vigorous',
          note: 'Bankdrücken 3 × 8',
          extraItems: [
            { typeKey: 'stretching', typeName: 'Dehnen', minutes: 15, intensity: 'light', note: null },
          ],
          pinned: true,
          purgedAt: 6,
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
    expect(r.json).toMatchObject({ applied: records.length, stale: [], rejected: [] });

    const { changes } = await pullAll(alice);
    expect(changes).toHaveLength(records.length);
    for (const rec of records) {
      expect(changes.find((c) => c.table === rec.table && c.data.id === rec.data.id)?.data).toEqual(rec.data);
    }
  });

  it('accepts records from older app versions without the newer optional fields', async () => {
    const {
      groupId: _g,
      groupName: _n,
      photoId: _p,
      photoIds: _ps,
      note: _note,
      ...oldEntry
    } = entry({ groupId: null });
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
    const oldTemplate = {
      id: uuidv7(),
      updatedAt: 7,
      deleted: false,
      name: 'Feierabendrunde',
      typeKey: 'cycling',
      typeName: 'Radfahren',
      minutes: 45,
      intensity: 'moderate',
      note: null,
    };
    // Settings of an app version before the goals (no goalKind).
    const oldSettings = {
      id: 'profile',
      updatedAt: 8,
      deleted: false,
      sex: 'female',
      birthDate: '1992-03-01',
      heightCm: 168,
      activityLevel: 'light',
      targetWeightKg: null,
      weeklyRateKg: -0.25,
      mealNames: ['Frühstück', 'Mittag', 'Abend', 'Snacks'],
      addExerciseCalories: true,
      onboardedAt: 5,
      macroPlan: null,
      weightStepKg: null,
      weightRangeKg: null,
      stepsMinimum: null,
      addStepsCalories: null,
    };
    const before = (await pullAll(alice)).cursor;
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: oldEntry },
        { table: 'exerciseEntries', data: oldExercise },
        { table: 'exerciseTemplates', data: oldTemplate },
        { table: 'settings', data: oldSettings },
      ],
    });
    expect(r.json).toMatchObject({ applied: 4, stale: [], rejected: [] });
    const { changes } = await pullAll(alice, before);
    expect(changes.find((c) => c.data.id === oldEntry.id)?.data).toEqual({
      ...oldEntry,
      groupId: null,
      groupName: null,
      photoId: null,
      photoIds: null,
      note: null,
      diaryMealId: null,
    });
    expect(changes.find((c) => c.data.id === oldExercise.id)?.data).toEqual({
      ...oldExercise,
      note: null,
      templateId: null,
      groupId: null,
      steps: null,
      distanceM: null,
      purgedAt: null,
    });
    expect(changes.find((c) => c.data.id === oldTemplate.id)?.data).toEqual({
      ...oldTemplate,
      extraItems: null,
      pinned: null,
      purgedAt: null,
    });
    expect(changes.find((c) => c.table === 'settings')?.data).toEqual({
      ...oldSettings,
      goalKind: null,
      customMealNames: null,
      legacyMealNames: null,
    });
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

  it('syncs a purge like an edit', async () => {
    const w = { ...weight('2026-09-15', 81, 5000), deleted: true };
    await alice.post('/api/sync/push', { records: [{ table: 'weightEntries', data: w }] });
    const { cursor } = await pullAll(alice);
    const purged = { ...w, purgedAt: 5001, updatedAt: 5001 };
    const r = await alice.post('/api/sync/push', { records: [{ table: 'weightEntries', data: purged }] });
    expect(r.json).toMatchObject({ applied: 1, stale: [], rejected: [] });
    const { changes } = await pullAll(alice, cursor);
    expect(changes).toEqual([{ table: 'weightEntries', data: purged }]);
    // A restore on another device that is newer brings it back (purgedAt cleared, alive again).
    const restored = { ...w, deleted: false, purgedAt: null, updatedAt: 5002 };
    await alice.post('/api/sync/push', { records: [{ table: 'weightEntries', data: restored }] });
    const after = await pullAll(alice, cursor);
    expect(after.changes.at(-1)).toEqual({ table: 'weightEntries', data: restored });
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
    expect(again.json).toMatchObject({ changes: [], cursor, hasMore: false });
  });

  it('rejects invalid records and wrong deterministic ids without failing the batch', async () => {
    const good = entry();
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: good },
        { table: 'foodEntries', data: { ...entry(), meal: 7 } },
        { table: 'weightEntries', data: { ...weight('2026-10-10', 80, 1), id: 'random-id' } },
        { table: 'settings', data: { id: 'x' } },
        // Steps are one entry per day: any other id is refused (other trainings take any id).
        {
          table: 'exerciseEntries',
          data: {
            id: uuidv7(),
            updatedAt: 1,
            deleted: false,
            date: '2026-10-10',
            typeKey: 'steps',
            name: 'Schritte',
            minutes: 50,
            intensity: 'moderate',
            met: 3.5,
            weightKg: 80,
            kcal: 167,
            loggedAt: 1,
            steps: 5000,
            distanceM: 4000,
          },
        },
      ],
    });
    expect(r.json.applied).toBe(1);
    expect(r.json.rejected).toHaveLength(4);
    expect(r.json.rejected[1].error).toMatch(/w:2026-10-10/);
    expect(r.json.rejected[3].error).toMatch(/s:2026-10-10/);
    const bad = await alice.post('/api/sync/push', { records: [{ table: 'nope', data: {} }] });
    expect(bad.status).toBe(400);
  });

  it('refuses versions from the future (device clock ahead) and tells the device the time', async () => {
    const ahead = entry({ updatedAt: Date.now() + 10 * 60_000 });
    const fine = entry({ updatedAt: Date.now() + 60_000 });
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: ahead },
        { table: 'foodEntries', data: fine },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(1);
    expect(r.json.rejected).toEqual([{ table: 'foodEntries', id: ahead.id, error: 'clock_ahead' }]);
    expect(Math.abs(r.json.serverTime - Date.now())).toBeLessThan(5_000);
    const pulled = await alice.get('/api/sync/pull?since=0');
    expect(typeof pulled.json.serverTime).toBe('number');
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

  it('names the database epoch in every pull, the same for every account', async () => {
    const a = await alice.get('/api/sync/pull?since=0');
    const b = await bob.get('/api/sync/pull?since=0');
    expect(typeof a.json.epoch).toBe('string');
    expect(a.json.epoch.length).toBeGreaterThan(10);
    expect(b.json.epoch).toBe(a.json.epoch);
    expect(a.json.reset).toBeUndefined();
    // Stable while nothing is restored.
    expect((await alice.get(`/api/sync/pull?since=${a.json.cursor}`)).json.epoch).toBe(a.json.epoch);
  });

  it('answers reset with a new epoch to a cursor above the sequence (restored database)', async () => {
    await alice.post('/api/sync/push', { records: [{ table: 'foodEntries', data: entry() }] });
    const before = await pullAll(alice);
    const e1 = (await alice.get('/api/sync/pull?since=0')).json.epoch as string;

    const r = await alice.get(`/api/sync/pull?since=${before.cursor + 1_000_000}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ changes: [], cursor: 0, hasMore: false, reset: true });
    expect(r.json.epoch).not.toBe(e1);

    const again = await alice.get('/api/sync/pull?since=0');
    expect(again.json.epoch).toBe(r.json.epoch);
    expect(again.json.reset).toBeUndefined();
    expect(again.json.changes.length).toBeGreaterThan(0);
    // Every account sees the new epoch.
    expect((await bob.get('/api/sync/pull?since=0')).json.epoch).toBe(r.json.epoch);
  });

  it('syncs the meals of a day with their fixed or free ids', async () => {
    const fixed = {
      id: dayId.diaryMeal('2026-11-19', 1),
      updatedAt: 5,
      deleted: false,
      date: '2026-11-19',
      name: 'Kuchen bei Oma',
      eatenAt: 1_763_553_600_000,
      slot: 1,
      timeEdited: true,
    };
    const free = { ...fixed, id: uuidv7(), slot: 3, timeEdited: false };
    const linked = entry({ date: '2026-11-19', meal: 1, diaryMealId: fixed.id });
    const settings = {
      id: 'profile',
      updatedAt: Date.now(),
      deleted: false,
      sex: null,
      birthDate: null,
      heightCm: null,
      activityLevel: 'light',
      targetWeightKg: null,
      weeklyRateKg: 0,
      mealNames: ['A', 'B', 'C', 'D'],
      addExerciseCalories: true,
      onboardedAt: null,
      customMealNames: ['Kuchen bei Oma'],
      legacyMealNames: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'],
    };
    const pushed = await alice.post('/api/sync/push', {
      records: [
        { table: 'diaryMeals', data: fixed },
        { table: 'diaryMeals', data: free },
        { table: 'foodEntries', data: linked },
        { table: 'settings', data: settings },
      ],
    });
    expect(pushed.json.rejected).toEqual([]);

    const { changes } = await pullAll(alice);
    const of = (id: string) => changes.find((x) => x.data.id === id)?.data;
    expect(of(fixed.id)).toEqual(fixed);
    expect(of(free.id)).toEqual(free);
    expect(of(linked.id).diaryMealId).toBe(fixed.id);
    expect(of('profile')).toMatchObject({
      customMealNames: settings.customMealNames,
      legacyMealNames: settings.legacyMealNames,
    });
    // Another account sees none of it.
    expect((await pullAll(bob)).changes.some((x) => x.data.id === free.id)).toBe(false);
  });

  it('reads entries and meals of older shapes with the defaults', async () => {
    const { diaryMealId: _, ...old } = entry();
    const meal = {
      id: uuidv7(),
      updatedAt: 5,
      deleted: false,
      date: '2026-11-19',
      name: 'Alt',
      eatenAt: 1,
      slot: 0,
    };
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'foodEntries', data: old },
        { table: 'diaryMeals', data: meal },
      ],
    });
    expect(r.json.rejected).toEqual([]);
    const { changes } = await pullAll(alice);
    expect(changes.find((x) => x.data.id === old.id)?.data.diaryMealId).toBeNull();
    expect(changes.find((x) => x.data.id === meal.id)?.data.timeEdited).toBe(false);
  });

  it('refuses a fixed meal id that does not fit its day and index', async () => {
    const data = {
      updatedAt: 5,
      deleted: false,
      date: '2026-11-19',
      name: 'Falsch',
      eatenAt: 1,
      slot: 2,
    };
    const r = await alice.post('/api/sync/push', {
      records: [
        { table: 'diaryMeals', data: { ...data, id: dayId.diaryMeal('2026-11-18', 2) } },
        { table: 'diaryMeals', data: { ...data, id: dayId.diaryMeal('2026-11-19', 1) } },
      ],
    });
    expect(r.json.rejected.map((x: { error: string }) => x.error)).toEqual([
      `id must be ${dayId.diaryMeal('2026-11-19', 2)}`,
      `id must be ${dayId.diaryMeal('2026-11-19', 2)}`,
    ]);
  });

  it('validates the cursor', async () => {
    expect((await alice.get('/api/sync/pull?since=-1')).status).toBe(400);
    expect((await alice.get('/api/sync/pull?since=abc')).status).toBe(400);
  });
});
