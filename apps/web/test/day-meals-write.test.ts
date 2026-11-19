import { dayId, eatenAtOf, uuidv7, type FoodEntry, type MealItem } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import {
  applyLogTarget,
  moveEntriesToDiaryMeal,
  prepareMealTarget,
  readDay,
  readMealChoice,
  readNextMeal,
  renameDiaryMeal,
  restoreEntryMeals,
  setDiaryMealTime,
} from '@/db/diaryMeals';
import { UserDb } from '@/db/dexie';
import { logItems, updateFoodEntry } from '@/db/entries';
import { deleteRecord, saveRecord } from '@/db/write';

const DATE = '2026-11-19';
const at = (hour: number, minute = 0) => eatenAtOf(DATE, hour, minute);
const db = () => new UserDb(`day-meals-${uuidv7()}`);

const item: MealItem = {
  foodId: null,
  source: 'quick',
  name: 'Apfel',
  brand: null,
  grams: null,
  portionLabel: null,
  portionGrams: null,
  quantity: 1,
  per100: null,
  nutrients: { ENERCC: 50 },
};

async function oldEntry(d: UserDb, meal: number, loggedAt: number, over: Partial<FoodEntry> = {}) {
  return saveRecord(d, 'foodEntries', {
    ...item,
    id: uuidv7(),
    date: DATE,
    meal,
    loggedAt,
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
}

describe('logging into meals', () => {
  it('writes a new meal together with its first entry', async () => {
    const d = db();
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(8));
    const [id] = await logItems(d, [item], target);
    const [meal] = await readDay(d, DATE);
    expect(meal).toMatchObject({ name: 'Frühstück', eatenAt: at(8), slot: 0, virtual: false });
    expect((await d.foodEntries.get(id!))!.diaryMealId).toBe(meal!.id);
    expect((await d.outbox.toArray()).map((o) => o.table).sort()).toEqual(['diaryMeals', 'foodEntries']);
  });

  it('adds further entries to the same meal without changing its time', async () => {
    const d = db();
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(8));
    await logItems(d, [item], target);
    const [meal] = await readDay(d, DATE);
    await logItems(d, [item], await prepareMealTarget(d, { date: DATE, meal: 0, dm: meal!.id }, at(9)));
    const [after] = await readDay(d, DATE);
    expect(after!.entries).toHaveLength(2);
    expect(after!.eatenAt).toBe(at(8));
  });

  it('names the next meal after the ones the day has', async () => {
    const d = db();
    await oldEntry(d, 0, at(8));
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(12));
    expect(target).toMatchObject({ meal: 1, create: { name: 'Mittagessen', eatenAt: at(12) } });
  });

  it('leaves a meal without a record without one when an entry joins it', async () => {
    const d = db();
    await oldEntry(d, 1, at(12));
    const target = await prepareMealTarget(d, { date: DATE, meal: 1, dm: dayId.diaryMeal(DATE, 1) }, at(13));
    expect(target).toEqual({ date: DATE, meal: 1, diaryMealId: null });
    await logItems(d, [item], target);
    expect(await d.diaryMeals.count()).toBe(0);
    expect((await readDay(d, DATE))[0]!.entries).toHaveLength(2);
  });

  it('logs as before when only a slot is named', async () => {
    const d = db();
    const [id] = await logItems(d, [item], { date: DATE, meal: 2 });
    expect(await d.foodEntries.get(id!)).toMatchObject({ meal: 2, diaryMealId: null });
    expect(await d.diaryMeals.count()).toBe(0);
  });

  it('writes neither the meal nor the entry when the transaction fails', async () => {
    const d = db();
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(8));
    await expect(
      d.transaction('rw', [d.foodEntries, d.diaryMeals, d.outbox], async () => {
        await applyLogTarget(d, target);
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await d.diaryMeals.count()).toBe(0);
    expect(await d.outbox.count()).toBe(0);
  });
});

describe('changing meals', () => {
  it('writes a record with the fixed id when a meal without one is renamed', async () => {
    const d = db();
    await oldEntry(d, 1, at(12));
    const [meal] = await readDay(d, DATE);
    await renameDiaryMeal(d, meal!, 'Kuchen bei Oma');
    expect(await d.diaryMeals.get(dayId.diaryMeal(DATE, 1))).toMatchObject({
      name: 'Kuchen bei Oma',
      eatenAt: at(12),
      timeEdited: false,
    });
    expect((await readDay(d, DATE))[0]).toMatchObject({ name: 'Kuchen bei Oma', virtual: false });
  });

  it('marks only a changed time, and undoing the first change lifts the mark', async () => {
    const d = db();
    await oldEntry(d, 2, at(7));
    await oldEntry(d, 0, at(21));
    const dinner = (await readDay(d, DATE)).find((m) => m.slot === 2)!;
    await setDiaryMealTime(d, dinner, at(19));
    expect((await readDay(d, DATE)).map((m) => m.slot)).toEqual([2, 0]);
    await setDiaryMealTime(d, dinner, dinner.eatenAt, dinner.timeEdited);
    expect((await readDay(d, DATE)).map((m) => m.slot)).toEqual([0, 2]);
  });

  it('never moves the time when entries come and go', async () => {
    const d = db();
    const first = await oldEntry(d, 0, at(8));
    await oldEntry(d, 0, at(9));
    await deleteRecord(d, 'foodEntries', first.id);
    expect((await readDay(d, DATE))[0]!.eatenAt).toBe(at(8));
  });

  it('keeps source and target as they were when an entry moves', async () => {
    const d = db();
    const a = await oldEntry(d, 0, at(8));
    await oldEntry(d, 0, at(8, 10));
    await oldEntry(d, 2, at(19));
    const day = await readDay(d, DATE);
    const moved = await moveEntriesToDiaryMeal(d, [a.id], day[1]!);
    expect(moved).toEqual([{ id: a.id, meal: 0, diaryMealId: null }]);
    const after = await readDay(d, DATE);
    expect(after.map((m) => [m.slot, m.eatenAt, m.entries.length])).toEqual([
      [0, at(8), 1],
      [2, at(19), 2],
    ]);
    await restoreEntryMeals(d, moved);
    expect((await d.foodEntries.get(a.id))!.meal).toBe(0);
    expect((await readDay(d, DATE))[0]!.entries).toHaveLength(2);
  });

  it('moves entries between two meals that share an index', async () => {
    const d = db();
    for (const [id, hour] of [
      ['m1', 10],
      ['m2', 16],
    ] as const) {
      await saveRecord(d, 'diaryMeals', {
        id,
        date: DATE,
        name: 'Snacks',
        eatenAt: at(hour),
        slot: 3,
        timeEdited: false,
      });
    }
    const a = await oldEntry(d, 3, at(10), { diaryMealId: 'm1' });
    await oldEntry(d, 3, at(16), { diaryMealId: 'm2' });
    const day = await readDay(d, DATE);
    await moveEntriesToDiaryMeal(d, [a.id], day[1]!);
    expect((await d.foodEntries.get(a.id))!.diaryMealId).toBe('m2');
    expect((await readDay(d, DATE)).map((m) => m.id)).toEqual(['m2']);
  });

  it('writes nothing for an entry already there, deleted or missing', async () => {
    const d = db();
    const a = await oldEntry(d, 0, at(8));
    const gone = await oldEntry(d, 0, at(9));
    await deleteRecord(d, 'foodEntries', gone.id);
    const [meal] = await readDay(d, DATE);
    await d.outbox.clear();
    expect(await moveEntriesToDiaryMeal(d, [a.id, gone.id, 'missing'], meal!)).toEqual([]);
    expect(await d.outbox.count()).toBe(0);
  });
});

describe('choosing a meal', () => {
  it('names the next meal of an empty day and a link that only has an index', async () => {
    const d = db();
    expect(await readNextMeal(d, DATE)).toEqual({ name: 'Frühstück', slot: 0 });
    const fresh = await readMealChoice(d, { date: DATE, meal: 0, dm: 'new' }, at(8));
    expect(fresh.current).toEqual({ id: 'new', name: 'Frühstück', slot: 0, eatenAt: null });
    const old = await readMealChoice(d, { date: DATE, meal: 1 }, at(8));
    expect(old.current).toEqual({
      id: dayId.diaryMeal(DATE, 1),
      name: 'Mittagessen',
      slot: 1,
      eatenAt: null,
    });
  });

  it('shows the meal an old link will write into', async () => {
    const d = db();
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new', name: 'Brunch' }, at(10));
    await logItems(d, [item], target);
    const { current } = await readMealChoice(d, { date: DATE, meal: target.meal }, at(11));
    expect(current).toMatchObject({ id: target.diaryMealId, name: 'Brunch', eatenAt: at(10) });
    const key = dayId.diaryMeal(DATE, target.meal);
    const viaKey = await readMealChoice(d, { date: DATE, meal: target.meal, dm: key }, at(11));
    expect(viaKey.current.id).toBe(target.diaryMealId);
  });

  it('offers the next free name once the day has meals', async () => {
    const d = db();
    await oldEntry(d, 0, at(8));
    const choice = await readMealChoice(d, { date: DATE, meal: 0, dm: 'new' }, at(12));
    expect(choice.meals.map((m) => m.name)).toEqual(['Frühstück']);
    expect(choice.next).toEqual({ name: 'Mittagessen', slot: 1 });
  });
});

describe('editing an entry', () => {
  const fields = { ...item, name: 'Birne' };

  it('leaves the meal alone unless another one was picked', async () => {
    const d = db();
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(8));
    const [id] = await logItems(d, [item], target);
    const entry = (await d.foodEntries.get(id!))!;
    // Moved on another device while the form was open.
    await d.foodEntries.update(id!, { meal: 2, diaryMealId: null });
    await updateFoodEntry(d, entry, fields, null);
    expect(await d.foodEntries.get(id!)).toMatchObject({ name: 'Birne', meal: 2, diaryMealId: null });
  });

  it('keeps fields the form does not know and a deletion from elsewhere', async () => {
    const d = db();
    const entry = await oldEntry(d, 1, at(12), { mealId: 'saved', note: 'bleibt' });
    await deleteRecord(d, 'foodEntries', entry.id);
    await updateFoodEntry(d, entry, fields, null);
    expect(await d.foodEntries.get(entry.id)).toMatchObject({
      name: 'Birne',
      mealId: 'saved',
      note: 'bleibt',
      deleted: true,
    });
  });

  it('moves into a picked meal and both meals keep their time', async () => {
    const d = db();
    const first = await oldEntry(d, 0, at(8));
    const second = await oldEntry(d, 0, at(8, 30));
    await oldEntry(d, 1, at(12));
    await updateFoodEntry(d, first, fields, {
      date: DATE,
      meal: 1,
      dm: dayId.diaryMeal(DATE, 1),
    });
    const day = await readDay(d, DATE);
    expect(day.map((m) => [m.id, m.eatenAt])).toEqual([
      [dayId.diaryMeal(DATE, 0), at(8)],
      [dayId.diaryMeal(DATE, 1), at(12)],
    ]);
    expect(day[0]!.entries.map((e) => e.id)).toEqual([second.id]);
    expect(day[1]!.entries).toHaveLength(2);
  });

  it('begins a new meal when one was picked', async () => {
    const d = db();
    const entry = await oldEntry(d, 0, at(8));
    await oldEntry(d, 0, at(8, 10));
    await updateFoodEntry(d, entry, fields, { date: DATE, meal: 1, dm: 'new' });
    const day = await readDay(d, DATE);
    expect(day.map((m) => m.name).sort()).toEqual(['Frühstück', 'Mittagessen']);
    expect(day.find((m) => m.name === 'Mittagessen')!.entries.map((e) => e.id)).toEqual([entry.id]);
  });
});
