import { addDays, dayId, eatenAtOf, groupDiaryEntries, uuidv7, type MealItem } from '@ft/shared';
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
import { copyToClipboard, foodClipboard, pasteClipboard, readClipboard } from '@/db/clipboard';
import { prepareMealTarget, readDay, saveStandardMealNames } from '@/db/diaryMeals';
import {
  copyMealFromDay,
  daySuggestions,
  logSuggestion,
  mealSuggestions,
  NEXT_MEAL_KEY,
} from '@/db/suggestions';

const db = () => new UserDb(`t-${uuidv7()}`);
const TODAY = '2026-10-24'; // a Saturday
const YESTERDAY = addDays(TODAY, -1);
/** The meal of an index on a day without own meals. */
const slotMeal = (date: string, slot: number) => dayId.diaryMeal(date, slot);

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
    const list = await mealSuggestions(d, TODAY, slotMeal(TODAY, 0));
    expect(list.map((s) => s.name)).toEqual(['Hafer', 'Ei', 'Brot']);
    expect(list[0]).toMatchObject({ kind: 'food', count: 5, items: [{ grams: 50 }] });
    // Lunch, the next meal of the day, knows only the milk.
    expect((await mealSuggestions(d, TODAY, NEXT_MEAL_KEY)).map((s) => s.name)).toEqual(['Milch']);
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
    const list = await mealSuggestions(d, TODAY, NEXT_MEAL_KEY);
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
      purgedAt: null,
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
    const list = await mealSuggestions(d, TODAY, NEXT_MEAL_KEY);
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
    expect(await mealSuggestions(d, TODAY, NEXT_MEAL_KEY)).toEqual([]);
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
    const ids = await copyMealFromDay(d, { date: y, id: slotMeal(y, 0) }, { date: TODAY, meal: 0 });
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

describe('suggestions under a meal with entries', () => {
  it('leaves out what the meal already has and moves the next best up', async () => {
    const d = db();
    for (const [i, name] of ['A', 'B', 'C', 'D', 'E'].entries())
      for (let k = 0; k <= 4 - i; k++) await logFoodEntry(d, entry(name, 100), addDays(TODAY, -1 - k));
    expect((await mealSuggestions(d, TODAY, NEXT_MEAL_KEY)).map((s) => s.name)).toEqual(['A', 'B', 'C', 'D']);
    await logFoodEntry(d, entry('B', 100), TODAY);
    expect((await mealSuggestions(d, TODAY, slotMeal(TODAY, 0))).map((s) => s.name)).toEqual([
      'A',
      'C',
      'D',
      'E',
    ]);
  });

  it('leaves out a saved meal logged today and gives every meal its meal of yesterday', async () => {
    const d = db();
    await d.meals.put({
      id: 'm1',
      name: 'Müsli',
      items: [],
      photoId: null,
      cookedGrams: null,
      purgedAt: null,
      updatedAt: 1,
      deleted: false,
    });
    await logItems(
      d,
      [item('Hafer', 400, 50), item('Milch', 50, 200)],
      { date: addDays(TODAY, -1), meal: 0 },
      { mealId: 'm1' },
    );
    await logFoodEntry(d, { ...entry('Suppe', 100, 300), meal: 1 }, addDays(TODAY, -1));
    const before = await daySuggestions(d, TODAY);
    expect(before.get(NEXT_MEAL_KEY)).toMatchObject({
      yesterday: { id: slotMeal(YESTERDAY, 0), date: YESTERDAY, name: 'Frühstück', kcal: 300 },
      suggestions: [{ key: 'meal:m1', name: 'Müsli' }],
    });
    await logItems(
      d,
      [item('Hafer', 400, 40), item('Milch', 50, 200)],
      { date: TODAY, meal: 0 },
      { mealId: 'm1' },
    );
    const after = await daySuggestions(d, TODAY);
    expect(after.get(slotMeal(TODAY, 0))).toMatchObject({
      suggestions: [],
      yesterday: { name: 'Frühstück' },
    });
    // The next meal is lunch now.
    expect(after.get(NEXT_MEAL_KEY)).toMatchObject({
      yesterday: { name: 'Mittagessen', kcal: 300 },
      suggestions: [{ name: 'Suppe' }],
    });
  });
});

describe('meals by name', () => {
  /** A meal of its own (with a record) and one entry in it. */
  async function meal(d: UserDb, date: string, name: string, hour: number, food: string, minute = 0) {
    const night = hour < 5;
    const at = eatenAtOf(date, hour, minute, night);
    const target = await prepareMealTarget(d, { date, meal: 0, dm: 'new', name }, at);
    await logItems(d, [item(food, 100)], target);
    return target.diaryMealId!;
  }

  it('takes the history of meals with the same name, wherever their index is', async () => {
    const d = db();
    // Both "Snacks" of yesterday count for a "Snacks" today, the lunch does not.
    await meal(d, YESTERDAY, 'Mittagessen', 12, 'Nudeln');
    await meal(d, YESTERDAY, 'Snacks', 10, 'Apfel');
    await meal(d, YESTERDAY, 'Snacks', 16, 'Riegel');
    const today = await meal(d, TODAY, 'Snacks', 10, 'Joghurt');
    const list = await mealSuggestions(d, TODAY, today);
    expect(list.map((s) => s.name).sort()).toEqual(['Apfel', 'Riegel']);
  });

  it('keeps two meals of the same name apart: each leaves out its own entries and finds its own yesterday', async () => {
    const d = db();
    const morning = await meal(d, YESTERDAY, 'Snacks', 10, 'Apfel');
    const afternoon = await meal(d, YESTERDAY, 'Snacks', 16, 'Riegel');
    const early = await meal(d, TODAY, 'Snacks', 10, 'Apfel', 30);
    const late = await meal(d, TODAY, 'Snacks', 15, 'Riegel');
    const all = await daySuggestions(d, TODAY);
    expect(all.get(early)).toMatchObject({ suggestions: [{ name: 'Riegel' }], yesterday: { id: morning } });
    expect(all.get(late)).toMatchObject({ suggestions: [{ name: 'Apfel' }], yesterday: { id: afternoon } });
  });

  it('without the same name takes the meal of yesterday nearest in time, the night behind the evening', async () => {
    const d = db();
    await meal(d, YESTERDAY, 'Frühstück', 8, 'Brot');
    const brunch = await meal(d, YESTERDAY, 'Brunch', 11, 'Ei');
    const dinner = await meal(d, YESTERDAY, 'Abendessen', 19, 'Suppe');
    const night = await meal(d, YESTERDAY, 'Nachts', 0, 'Chips', 30);
    const lunch = await meal(d, TODAY, 'Mittagessen', 12, 'Reis');
    const late = await meal(d, TODAY, 'Spaet', 23, 'Tee', 50);
    const after = await meal(d, TODAY, 'Nacht', 1, 'Keks');
    const early = await meal(d, TODAY, 'Abendbrot', 20, 'Kaese');
    const all = await daySuggestions(d, TODAY);
    expect(all.get(lunch)!.yesterday).toMatchObject({ id: brunch, name: 'Brunch', kcal: 100 });
    expect(all.get(late)!.yesterday).toMatchObject({ id: night, name: 'Nachts' });
    expect(all.get(after)!.yesterday).toMatchObject({ id: night });
    expect(all.get(early)!.yesterday).toMatchObject({ id: dinner });
  });

  it('keeps the history of a standard name through a rename', async () => {
    const d = db();
    await logFoodEntry(d, entry('Hafer', 370, 50), YESTERDAY);
    await logFoodEntry(d, entry('Hafer', 370, 50), addDays(TODAY, -2));
    await saveStandardMealNames(d, ['Morgens', 'Mittag', 'Abend', 'Zwischendurch']);
    // The card of the empty day is "Morgens" now, its history and yesterday are the old "Frühstück".
    const next = (await daySuggestions(d, TODAY)).get(NEXT_MEAL_KEY)!;
    expect(next.suggestions.map((s) => [s.name, s.count])).toEqual([['Hafer', 2]]);
    expect(next.yesterday).toMatchObject({ name: 'Frühstück', id: slotMeal(YESTERDAY, 0) });
    // A meal of the new name today has the same history.
    const today = await meal(d, TODAY, 'Morgens', 8, 'Ei');
    expect((await mealSuggestions(d, TODAY, today)).map((s) => s.name)).toEqual(['Hafer']);
  });
});

describe('logging into the meal that was tapped', () => {
  const names = async (d: UserDb, date: string) =>
    (await readDay(d, date)).map((m) => [m.name, m.entries.map((e) => e.name)]);

  it('a new meal sharing the index of an old one leaves that one and its entries alone', async () => {
    const d = db();
    for (const [slot, name] of ['Brot', 'Suppe', 'Salat', 'Apfel'].entries())
      await logFoodEntry(d, { ...entry(name, 100), meal: slot }, TODAY);
    // The fifth meal takes the last index, the one "Snacks" has.
    const fifth = await prepareMealTarget(d, { date: TODAY, meal: 0, dm: 'new' });
    expect(fifth.meal).toBe(3);
    await logItems(d, [item('Kuchen', 300)], fifth);
    expect(await names(d, TODAY)).toContainEqual(['Snacks', ['Apfel']]);
    expect(await names(d, TODAY)).toContainEqual(['Weitere Mahlzeit', ['Kuchen']]);

    // Pasting, a suggestion and "Wie gestern" go into exactly the meal tapped.
    await logFoodEntry(d, { ...entry('Nuss', 600, 30), meal: 3 }, YESTERDAY);
    const snacks = { date: TODAY, meal: 3, dm: slotMeal(TODAY, 3) };
    const [s] = await mealSuggestions(d, TODAY, snacks.dm);
    await logSuggestion(d, s!, await prepareMealTarget(d, snacks));
    await copyMealFromDay(
      d,
      { date: YESTERDAY, id: slotMeal(YESTERDAY, 3) },
      await prepareMealTarget(d, snacks),
    );
    await copyToClipboard(d, 'entry', 'Brot', (await readDay(d, TODAY))[0]!.entries);
    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, await prepareMealTarget(d, snacks));
    expect(await names(d, TODAY)).toContainEqual(['Snacks', ['Apfel', 'Nuss', 'Nuss', 'Brot']]);
    expect(await names(d, TODAY)).toContainEqual(['Weitere Mahlzeit', ['Kuchen']]);
  });

  it('after a rename the card of an empty day takes the new name, also for an old clipboard', async () => {
    const d = db();
    await saveStandardMealNames(d, ['Morgens', 'Mittag', 'Abend', 'Zwischendurch']);
    await d.kv.put({
      key: 'clipboard',
      value: {
        kind: 'group',
        name: 'Alt',
        items: [item('A', 1), item('B', 2)],
        mealId: null,
        groupName: 'Alt',
        aiAnalysisId: null,
        photoIds: [],
        copiedAt: 1,
      },
    });
    const into = await prepareMealTarget(d, { date: TODAY, meal: 0, dm: 'new' });
    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, into);
    expect(await names(d, TODAY)).toEqual([['Morgens', ['A', 'B']]]);
    expect(await d.diaryMeals.get(into.diaryMealId!)).toMatchObject({ name: 'Morgens', slot: 0 });
  });
});
