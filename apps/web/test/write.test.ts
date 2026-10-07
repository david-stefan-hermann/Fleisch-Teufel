import { dayId, uuidv7 } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { logFoodEntry, logItems, saveAiMeal, saveExercise, saveExerciseTemplate } from '@/db/entries';
import { deleteRecord, patchRecord, restoreRecord, saveRecord } from '@/db/write';

const db = () => new UserDb(`t-${uuidv7()}`);

describe('local writes', () => {
  it('versions records and queues them in the outbox atomically', async () => {
    const d = db();
    const w = await saveRecord(d, 'weightEntries', {
      id: dayId.weight('2026-10-07'),
      date: '2026-10-07',
      kg: 80,
    });
    expect(w.deleted).toBe(false);
    expect(await d.outbox.get('weightEntries:w:2026-10-07')).toMatchObject({ updatedAt: w.updatedAt });
    const w2 = await patchRecord(d, 'weightEntries', w.id, { kg: 79.5 });
    expect(w2!.updatedAt).toBeGreaterThan(w.updatedAt);
    expect(await d.outbox.count()).toBe(1);
  });

  it('soft-deletes and restores', async () => {
    const d = db();
    const w = await saveRecord(d, 'weightEntries', {
      id: dayId.weight('2026-10-08'),
      date: '2026-10-08',
      kg: 80,
    });
    await deleteRecord(d, 'weightEntries', w.id);
    expect((await d.weightEntries.get(w.id))!.deleted).toBe(true);
    await restoreRecord(d, 'weightEntries', w.id);
    expect((await d.weightEntries.get(w.id))!.deleted).toBe(false);
  });

  it('rejects invalid records without touching the outbox', async () => {
    const d = db();
    await expect(
      saveRecord(d, 'weightEntries', { id: 'w:2026-10-09', date: '2026-10-09', kg: 5 }),
    ).rejects.toThrow();
    expect(await d.outbox.count()).toBe(0);
  });

  it('logs one item on several days with ordered timestamps', async () => {
    const d = db();
    await logFoodEntry(
      d,
      {
        meal: 0,
        foodId: 'bls:C133000',
        source: 'bls',
        name: 'Hafer',
        brand: null,
        grams: 50,
        portionLabel: '100 g',
        portionGrams: 100,
        quantity: 0.5,
        per100: { ENERCC: 348 },
        nutrients: { ENERCC: 174 },
        mealId: null,
        aiAnalysisId: null,
      },
      ['2026-10-07', '2026-10-08', '2026-10-09'],
    );
    const all = await d.foodEntries.orderBy('loggedAt').toArray();
    expect(all.map((e) => e.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(new Set(all.map((e) => e.id)).size).toBe(3);
  });

  it('stores an AI analysis as saved meal and logs it as one group linked to the analysis', async () => {
    const d = db();
    const food = {
      id: 'bls:X',
      source: 'bls' as const,
      sourceId: 'X',
      name: 'Pommes',
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g' as const,
      nutrients: { ENERCC: 240, FAT: 12 },
      portions: [],
    };
    const ketchup = { ...food, id: 'bls:K', sourceId: 'K', name: 'Ketchup', nutrients: { ENERCC: 100 } };
    const mealId = await saveAiMeal(
      d,
      '  Pommes mit Ketchup ',
      [
        { food, grams: 150 },
        { food: ketchup, grams: 20 },
      ],
      { date: '2026-10-07', meal: 2 },
      { analysisId: 'a1' },
    );
    const meal = await d.meals.get(mealId);
    expect(meal).toMatchObject({ name: 'Pommes mit Ketchup', deleted: false });
    expect(meal!.items.map((i) => i.name)).toEqual(['Pommes', 'Ketchup']);
    const entries = await d.foodEntries.orderBy('loggedAt').toArray();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      source: 'ai',
      grams: 150,
      quantity: 150,
      portionGrams: 1,
      aiAnalysisId: 'a1',
      mealId,
      meal: 2,
      nutrients: { ENERCC: 360, FAT: 18 },
    });
    expect(entries[0]!.groupId).toBeTruthy();
    expect(entries[1]!.groupId).toBe(entries[0]!.groupId);
    expect(await d.outbox.count()).toBe(3);
  });

  it('gives every logging of a saved meal its own group, but none to copied entries', async () => {
    const d = db();
    const item = {
      foodId: null,
      source: 'quick' as const,
      name: 'Kaffee',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 5 },
    };
    const target = { date: '2026-10-07', meal: 0 };
    await logItems(d, [item, item], target, { mealId: 'm1' });
    await logItems(d, [item, item], target, { mealId: 'm1', factor: 2 });
    await logItems(d, [item], target);
    const groups = (await d.foodEntries.toArray()).map((e) => e.groupId);
    expect(new Set(groups.filter(Boolean)).size).toBe(2);
    expect(groups.filter((g) => g === null)).toHaveLength(1);
    expect(await d.foodEntries.filter((e) => e.quantity === 2).count()).toBe(2);
  });

  it('saves training templates', async () => {
    const d = db();
    const id = await saveExerciseTemplate(d, {
      name: 'Oberkörper',
      typeKey: 'strength',
      typeName: 'Krafttraining',
      minutes: 60,
      intensity: 'vigorous',
      note: 'Bankdrücken 3 × 8',
    });
    expect(await d.exerciseTemplates.get(id)).toMatchObject({
      name: 'Oberkörper',
      note: 'Bankdrücken 3 × 8',
    });
    expect(await d.outbox.get(`exerciseTemplates:${id}`)).toBeTruthy();
  });

  it('creates and updates exercises', async () => {
    const d = db();
    const data = {
      date: '2026-10-07',
      typeKey: 'running',
      name: 'Laufen',
      minutes: 30,
      intensity: 'moderate' as const,
      met: 9.8,
      weightKg: 80,
      kcal: 352,
      note: null,
    };
    await saveExercise(d, data, null);
    const [x] = await d.exerciseEntries.toArray();
    await saveExercise(d, { ...data, minutes: 45, note: 'Intervalle' }, x!);
    expect(await d.exerciseEntries.count()).toBe(1);
    expect(await d.exerciseEntries.get(x!.id)).toMatchObject({ minutes: 45, note: 'Intervalle' });
  });
});
