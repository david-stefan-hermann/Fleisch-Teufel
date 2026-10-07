import { dayId, uuidv7 } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { logFoodEntry, saveAiItems, saveExercise } from '@/db/entries';
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

  it('stores AI items as gram-based entries linked to the analysis', async () => {
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
    await saveAiItems(d, [{ food, grams: 150 }], { date: '2026-10-07', meal: 2 }, { analysisId: 'a1' });
    const [e] = await d.foodEntries.toArray();
    expect(e).toMatchObject({
      source: 'ai',
      grams: 150,
      quantity: 150,
      portionGrams: 1,
      aiAnalysisId: 'a1',
      meal: 2,
      nutrients: { ENERCC: 360, FAT: 18 },
    });
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
    };
    await saveExercise(d, data, null);
    const [x] = await d.exerciseEntries.toArray();
    await saveExercise(d, { ...data, minutes: 45 }, x!);
    expect(await d.exerciseEntries.count()).toBe(1);
    expect((await d.exerciseEntries.get(x!.id))!.minutes).toBe(45);
  });
});
