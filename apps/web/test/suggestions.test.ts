import { addDays, groupDiaryEntries, uuidv7, type MealItem } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import {
  diaryParts,
  firstPhotoId,
  logFoodEntry,
  logItems,
  logParts,
  partsItems,
  saveMealFromEntries,
} from '@/db/entries';
import { copyMealFromDay, logSuggestion, mealSuggestions } from '@/db/suggestions';

const db = () => new UserDb(`t-${uuidv7()}`);
const TODAY = '2026-10-24'; // a Saturday

const item = (name: string, kcal: number, grams = 100): MealItem => ({
  foodId: `bls:${name}`,
  source: 'bls',
  name,
  brand: null,
  grams,
  portionLabel: '1 g',
  portionGrams: 1,
  quantity: grams,
  per100: { ENERCC: kcal },
  nutrients: { ENERCC: (kcal * grams) / 100 },
});

const entry = (name: string, kcal: number, grams = 100) => ({
  ...item(name, kcal, grams),
  meal: 0,
  mealId: null,
  aiAnalysisId: null,
});

describe('meal suggestions ("Zuletzt hier")', () => {
  it('ranks by frequency and recency, per meal, without today', async () => {
    const d = db();
    // Oats on 5 of the last 7 days (breakfast), eggs once yesterday, bread 40 days ago, today's entry excluded.
    for (let i = 1; i <= 5; i++) await logFoodEntry(d, entry('Hafer', 370, 50), addDays(TODAY, -i));
    await logFoodEntry(d, entry('Ei', 150, 60), addDays(TODAY, -1));
    await logFoodEntry(d, entry('Brot', 250), addDays(TODAY, -40));
    await logFoodEntry(d, { ...entry('Milch', 64, 200), meal: 1 }, addDays(TODAY, -1));
    await logFoodEntry(d, entry('Heute', 100), TODAY);
    const list = await mealSuggestions(d, TODAY, 0);
    expect(list.map((s) => s.name)).toEqual(['Hafer', 'Ei', 'Brot']);
    expect(list[0]).toMatchObject({ kind: 'food', count: 5, items: [{ grams: 50 }] });
    // Lunch knows only the milk.
    expect((await mealSuggestions(d, TODAY, 1)).map((s) => s.name)).toEqual(['Milch']);
  });

  it('keeps the latest amount and prefers the same weekday', async () => {
    const d = db();
    await logFoodEntry(d, entry('Hafer', 370, 40), addDays(TODAY, -3));
    await logFoodEntry(d, entry('Hafer', 370, 60), addDays(TODAY, -1));
    // Pancakes only on Saturdays (7 and 14 days ago) beat a weekday food logged as often.
    await logFoodEntry(d, entry('Pfannkuchen', 230), addDays(TODAY, -7));
    await logFoodEntry(d, entry('Pfannkuchen', 230), addDays(TODAY, -14));
    await logFoodEntry(d, entry('Toast', 260), addDays(TODAY, -8));
    await logFoodEntry(d, entry('Toast', 260), addDays(TODAY, -15));
    const list = await mealSuggestions(d, TODAY, 0);
    expect(list[0]).toMatchObject({ name: 'Hafer', items: [{ grams: 60 }] });
    expect(list.map((s) => s.name).indexOf('Pfannkuchen')).toBeLessThan(
      list.map((s) => s.name).indexOf('Toast'),
    );
  });

  it('offers a logged saved meal as one suggestion and logs it as a group again', async () => {
    const d = db();
    await d.meals.put({
      id: 'm1',
      name: 'Müsli',
      items: [],
      photoId: 'p1',
      cookedGrams: null,
      updatedAt: 1,
      deleted: false,
    });
    await logItems(
      d,
      [item('Hafer', 370, 50), item('Milch', 64, 200)],
      { date: addDays(TODAY, -1), meal: 0 },
      {
        mealId: 'm1',
        photoIds: ['p1'],
      },
    );
    await logFoodEntry(d, entry('Kaffee', 2, 200), addDays(TODAY, -1));
    const list = await mealSuggestions(d, TODAY, 0);
    expect(list.map((s) => s.name).sort()).toEqual(['Kaffee', 'Müsli']);
    const meal = list.find((s) => s.kind === 'group')!;
    expect(meal).toMatchObject({ key: 'meal:m1', mealId: 'm1', photoIds: ['p1'], items: [{}, {}] });
    const ids = await logSuggestion(d, meal, { date: TODAY, meal: 2 });
    const logged = await d.foodEntries.where('[date+meal]').equals([TODAY, 2]).sortBy('loggedAt');
    expect(logged.map((e) => e.id)).toEqual(ids);
    const rows = groupDiaryEntries(logged);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'group', mealId: 'm1' });
    expect(logged[0]).toMatchObject({ photoId: 'p1', photoIds: ['p1'] });
  });

  it('leaves out quick adds and estimated foods', async () => {
    const d = db();
    await logFoodEntry(
      d,
      {
        ...entry('Schnell', 300),
        foodId: null,
        source: 'quick',
        per100: null,
        grams: null,
        portionLabel: null,
        portionGrams: null,
        quantity: 1,
      },
      addDays(TODAY, -1),
    );
    await logFoodEntry(d, { ...entry('Schaetzung', 300), foodId: null, source: 'ai' }, addDays(TODAY, -1));
    expect(await mealSuggestions(d, TODAY, 0)).toEqual([]);
  });
});

describe('copyMealFromDay ("Wie gestern")', () => {
  it('copies single entries and groups of a meal, groups stay groups', async () => {
    const d = db();
    const y = addDays(TODAY, -1);
    await logFoodEntry(d, entry('Kaffee', 2, 200), y);
    await logItems(
      d,
      [item('Doener', 215, 350), item('Cola', 42, 330)],
      { date: y, meal: 0 },
      {
        groupName: 'Döner-Teller',
        aiAnalysisId: 'a1',
        photoIds: ['p1', 'p2'],
      },
    );
    await logFoodEntry(d, { ...entry('Abend', 500), meal: 2 }, y);
    const ids = await copyMealFromDay(d, { date: y, meal: 0 }, { date: TODAY, meal: 0 });
    expect(ids).toHaveLength(3);
    const copied = await d.foodEntries.where('[date+meal]').equals([TODAY, 0]).sortBy('loggedAt');
    expect(copied.map((e) => e.name)).toEqual(['Kaffee', 'Doener', 'Cola']);
    const rows = groupDiaryEntries(copied);
    expect(rows.map((r) => r.kind)).toEqual(['entry', 'group']);
    const group = rows[1] as Extract<(typeof rows)[number], { kind: 'group' }>;
    expect(group.groupName).toBe('Döner-Teller');
    expect(group.entries[0]).toMatchObject({ aiAnalysisId: 'a1', photoIds: ['p1', 'p2'], photoId: 'p1' });
    // New ids and a new group id: the original stays untouched.
    const original = await d.foodEntries.where('[date+meal]').equals([y, 0]).toArray();
    expect(new Set(copied.map((e) => e.groupId)).has(original.find((e) => e.groupId)!.groupId)).toBe(false);
    expect(await d.foodEntries.where('[date+meal]').equals([y, 2]).count()).toBe(1);
  });
});

describe('diary parts (shared by "Wie gestern", clipboard and suggestions)', () => {
  it('splits a meal into plain entries and groups and logs them again with the same structure', async () => {
    const d = db();
    const y = addDays(TODAY, -1);
    await logFoodEntry(d, entry('Brot', 250), y);
    await logItems(
      d,
      [item('Hafer', 370, 50), item('Milch', 64, 200)],
      { date: y, meal: 0 },
      { mealId: 'm1' },
    );
    await logItems(
      d,
      [item('Curry', 200)],
      { date: y, meal: 0 },
      { aiAnalysisId: 'a1', groupName: 'Curry', photoIds: ['p1'] },
    );
    const source = await d.foodEntries.where('[date+meal]').equals([y, 0]).sortBy('loggedAt');
    const parts = diaryParts(source);
    expect(
      parts.map((p) => [p.kind, p.items.length, p.mealId, p.groupName, p.aiAnalysisId, p.photoIds]),
    ).toEqual([
      ['entry', 1, null, null, null, []],
      ['group', 2, 'm1', null, null, []],
      ['group', 1, null, 'Curry', 'a1', ['p1']],
    ]);
    expect(partsItems(parts).map((i) => i.name)).toEqual(['Brot', 'Hafer', 'Milch', 'Curry']);
    expect(firstPhotoId(source)).toBe('p1');

    const ids = await logParts(d, parts, { date: TODAY, meal: 2 });
    const logged = await d.foodEntries.where('[date+meal]').equals([TODAY, 2]).sortBy('loggedAt');
    expect(logged.map((e) => e.id)).toEqual(ids);
    expect(groupDiaryEntries(logged).map((r) => r.kind)).toEqual(['entry', 'group', 'group']);
    expect(new Set(logged.map((e) => e.groupId)).size).toBe(3);
    expect(logged.some((e) => source.some((s) => s.groupId && s.groupId === e.groupId))).toBe(false);
  });

  it('saves a diary meal as a meal with the photo of a later group', async () => {
    const d = db();
    await logFoodEntry(d, entry('Brot', 250), TODAY);
    await logItems(
      d,
      [item('Curry', 200)],
      { date: TODAY, meal: 0 },
      { aiAnalysisId: 'a1', groupName: 'Curry', photoIds: ['p2'] },
    );
    const entries = await d.foodEntries.where('[date+meal]').equals([TODAY, 0]).sortBy('loggedAt');
    const id = await saveMealFromEntries(d, 'Frühstück', entries);
    const meal = (await d.meals.get(id))!;
    expect(meal.photoId).toBe('p2');
    expect(meal.items.map((i) => i.name)).toEqual(['Brot', 'Curry']);
  });
});
