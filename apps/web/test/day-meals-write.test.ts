import {
  dayId,
  eatenAtOf,
  MAX_CUSTOM_MEAL_NAMES,
  SETTINGS_ID,
  uuidv7,
  type FoodEntry,
  type MealItem,
} from '@ft/shared';
import { describe, expect, it } from 'vitest';
import {
  applyLogTarget,
  chooseMealName,
  moveEntriesToDiaryMeal,
  ownMealNames,
  prepareMealTarget,
  readDay,
  readMealChoice,
  readNextMeal,
  removeOwnMealName,
  renameDiaryMeal,
  restoreEntryMeals,
  saveStandardMealNames,
  setDiaryMealTime,
  waitingMealOf,
} from '@/db/diaryMeals';
import { UserDb, type AiQueueItem } from '@/db/dexie';
import { logItems, updateFoodEntry } from '@/db/entries';
import { DEFAULT_SETTINGS, saveSettings } from '@/db/settings';
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
    expect(target).toEqual({ date: DATE, meal: 1, diaryMealId: dayId.diaryMeal(DATE, 1) });
    const [id] = await logItems(d, [item], target);
    expect(await d.diaryMeals.count()).toBe(0);
    expect((await d.foodEntries.get(id!))!.diaryMealId).toBe(dayId.diaryMeal(DATE, 1));
    const [meal] = await readDay(d, DATE);
    expect(meal).toMatchObject({ id: dayId.diaryMeal(DATE, 1), virtual: true });
    expect(meal!.entries).toHaveLength(2);
  });

  it('a new meal sharing the index of a meal without a record leaves that one and its entries alone', async () => {
    const d = db();
    for (const slot of [0, 1, 2]) await oldEntry(d, slot, at(8 + slot));
    // Logged after the time the fifth meal gets: by its time alone it would join that meal.
    const snack = await oldEntry(d, 3, at(23));
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(22));
    expect(target).toMatchObject({ meal: 3, keep: { id: dayId.diaryMeal(DATE, 3), name: 'Snacks' } });
    await logItems(d, [item], target);
    const day = await readDay(d, DATE);
    expect(day.map((m) => [m.name, m.entries.map((e) => e.id)])).toEqual([
      ['Frühstück', [expect.any(String)]],
      ['Mittagessen', [expect.any(String)]],
      ['Abendessen', [expect.any(String)]],
      ['Weitere Mahlzeit', [expect.any(String)]],
      ['Snacks', [snack.id]],
    ]);
    expect(await d.foodEntries.get(snack.id)).toMatchObject({
      meal: 3,
      diaryMealId: dayId.diaryMeal(DATE, 3),
    });
    expect(await d.diaryMeals.get(dayId.diaryMeal(DATE, 3))).toMatchObject({ eatenAt: at(23), slot: 3 });
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

  it('keeps a time set by hand, also for the night, while entries come and go', async () => {
    const d = db();
    await oldEntry(d, 0, at(8));
    const target = await prepareMealTarget(d, { date: DATE, meal: 1, dm: 'new' }, at(20));
    const [first] = await logItems(d, [item], target);
    const snack = (await readDay(d, DATE)).find((m) => m.id === target.diaryMealId)!;
    const night = eatenAtOf(DATE, 0, 30, true);
    await setDiaryMealTime(d, snack, night);
    await logItems(d, [item], { date: DATE, meal: snack.slot, diaryMealId: snack.id });
    await logItems(d, [item], { date: DATE, meal: snack.slot, diaryMealId: snack.id });
    await deleteRecord(d, 'foodEntries', first!);
    const day = await readDay(d, DATE);
    expect(day.map((m) => m.id)).toEqual([dayId.diaryMeal(DATE, 0), snack.id]);
    expect(day[1]).toMatchObject({ id: snack.id, eatenAt: night, night: true, timeEdited: true });
    expect(day[1]!.entries.every((e) => e.date === DATE)).toBe(true);
  });

  it('keeps source and target as they were when an entry moves', async () => {
    const d = db();
    const a = await oldEntry(d, 0, at(8));
    await oldEntry(d, 0, at(8, 10));
    await oldEntry(d, 2, at(19));
    const day = await readDay(d, DATE);
    const moved = await moveEntriesToDiaryMeal(d, [a.id], day[1]!);
    expect(moved).toEqual([{ id: a.id, meal: 0, diaryMealId: dayId.diaryMeal(DATE, 0) }]);
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

describe('entries stay in the meal they show in', () => {
  const YESTERDAY = '2026-11-18';
  const yesterdayMeal = (d: UserDb) =>
    saveRecord(d, 'diaryMeals', {
      id: 'y',
      date: YESTERDAY,
      name: 'Kuchen bei Oma',
      eatenAt: eatenAtOf(YESTERDAY, 15, 0),
      slot: 2,
      timeEdited: false,
    });

  it('places an entry an older app moved from another day by its index', async () => {
    const d = db();
    await yesterdayMeal(d);
    await oldEntry(d, 2, at(19), { diaryMealId: 'y' });
    const day = await readDay(d, DATE);
    expect(day.map((m) => [m.id, m.name])).toEqual([[dayId.diaryMeal(DATE, 2), 'Abendessen']]);
  });

  it('takes a meal id of another day as unknown when choosing and logging', async () => {
    const d = db();
    await yesterdayMeal(d);
    const target = await prepareMealTarget(d, { date: DATE, meal: 2, dm: 'y' }, at(19));
    expect(target).toEqual({ date: DATE, meal: 2, diaryMealId: null });
    const choice = await readMealChoice(d, { date: DATE, meal: 2, dm: 'y' }, at(19));
    expect(choice.current).toMatchObject({ id: dayId.diaryMeal(DATE, 2), name: 'Abendessen' });
  });

  it('a renamed meal without a record keeps its entries when a newer meal takes its index', async () => {
    const d = db();
    for (const slot of [0, 1, 2]) await oldEntry(d, slot, at(8 + slot));
    const snack = await oldEntry(d, 3, at(23));
    const meal = (await readDay(d, DATE)).find((m) => m.slot === 3)!;
    await renameDiaryMeal(d, meal, 'Kuchen bei Oma');
    expect((await d.foodEntries.get(snack.id))!.diaryMealId).toBe(meal.id);
    await logItems(d, [item], await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(22)));
    const day = await readDay(d, DATE);
    expect(day.find((m) => m.name === 'Kuchen bei Oma')!.entries.map((e) => e.id)).toEqual([snack.id]);
    // The next standard name the day lacks, on the same index.
    expect(day.find((m) => m.name === 'Snacks')).toMatchObject({ slot: 3, virtual: false });
    expect(day.find((m) => m.name === 'Snacks')!.entries).toHaveLength(1);
  });

  it('setting the time of a meal without a record attaches its entries', async () => {
    const d = db();
    const a = await oldEntry(d, 1, at(12));
    const gone = await oldEntry(d, 1, at(11));
    await deleteRecord(d, 'foodEntries', gone.id);
    const [meal] = await readDay(d, DATE);
    await setDiaryMealTime(d, meal!, at(13));
    expect((await d.foodEntries.get(a.id))!.diaryMealId).toBe(meal!.id);
    expect((await d.foodEntries.get(gone.id))!.diaryMealId).toBeNull();
  });

  it('a recorded meal without a record id on its entries keeps them beside a new meal', async () => {
    const d = db();
    for (const slot of [0, 1, 2]) await oldEntry(d, slot, at(8 + slot));
    await saveRecord(d, 'diaryMeals', {
      id: dayId.diaryMeal(DATE, 3),
      date: DATE,
      name: 'Snacks',
      eatenAt: at(15),
      slot: 3,
      timeEdited: false,
    });
    const snack = await oldEntry(d, 3, at(23));
    const target = await prepareMealTarget(d, { date: DATE, meal: 0, dm: 'new' }, at(22));
    expect(target.keep).toMatchObject({ id: dayId.diaryMeal(DATE, 3), entryIds: [snack.id] });
    await logItems(d, [item], target);
    expect((await d.foodEntries.get(snack.id))!.diaryMealId).toBe(dayId.diaryMeal(DATE, 3));
    const day = await readDay(d, DATE);
    expect(day.find((m) => m.id === dayId.diaryMeal(DATE, 3))!.entries.map((e) => e.id)).toEqual([snack.id]);
  });

  it('moving into a meal only an analysis began keeps the meal without a record of its index', async () => {
    const d = db();
    const a = await oldEntry(d, 0, at(8));
    const snack = await oldEntry(d, 3, at(23));
    await d.aiQueue.add({
      date: DATE,
      meal: 3,
      diaryMealId: 'begun',
      newMeal: { name: 'Weitere Mahlzeit', eatenAt: at(22), slot: 3 },
      text: 'Nudeln',
      textOnly: true,
      status: 'pending',
      deferred: true,
      createdAt: at(22),
    });
    const target = (await readDay(d, DATE)).find((m) => m.id === 'begun')!;
    const moved = await moveEntriesToDiaryMeal(d, [a.id], target);
    expect(await d.diaryMeals.get('begun')).toMatchObject({ slot: 3, eatenAt: at(22) });
    expect(await d.foodEntries.get(snack.id)).toMatchObject({ diaryMealId: dayId.diaryMeal(DATE, 3) });
    const day = await readDay(d, DATE);
    expect(day.find((m) => m.id === dayId.diaryMeal(DATE, 3))!.entries.map((e) => e.id)).toEqual([snack.id]);
    expect(day.find((m) => m.id === 'begun')!.entries.map((e) => e.id)).toEqual([a.id]);
    await restoreEntryMeals(d, moved);
    const back = await readDay(d, DATE);
    expect(back.find((m) => m.slot === 0)!.entries.map((e) => e.id)).toEqual([a.id]);
  });
});

describe('waitingMealOf', () => {
  const queued = (draft?: { meal: number; diaryMealId?: string | null }) =>
    ({ date: DATE, meal: 0, diaryMealId: 'queued', draft }) as unknown as AiQueueItem;

  it('takes the meal picked in the review before the one it was queued for', () => {
    expect(waitingMealOf(queued())).toEqual({ meal: 0, diaryMealId: 'queued' });
    expect(waitingMealOf(queued({ meal: 2, diaryMealId: 'picked' }))).toEqual({
      meal: 2,
      diaryMealId: 'picked',
    });
    // "Neue Mahlzeit" in the review has no id yet: the index of the draft.
    expect(waitingMealOf(queued({ meal: 3, diaryMealId: 'new' }))).toEqual({ meal: 3, diaryMealId: null });
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

describe('meal names', () => {
  const STANDARD = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'];
  const RENAMED = ['Morgens', 'Mittags', 'Abends', 'Zwischendurch'];
  const settingsOf = async (d: UserDb) => (await d.settings.get(SETTINGS_ID))!;

  it('a renamed standard name counts for new meals only, old days keep theirs', async () => {
    const d = db();
    await saveSettings(d, {});
    await oldEntry(d, 0, at(8));
    await saveStandardMealNames(d, RENAMED);
    expect(await settingsOf(d)).toMatchObject({ mealNames: RENAMED, legacyMealNames: STANDARD });
    expect((await readDay(d, DATE)).map((m) => m.name)).toEqual(['Frühstück']);
    expect((await readNextMeal(d, '2026-11-20')).name).toBe('Morgens');
  });

  it('keeps the names from before the first rename through later ones', async () => {
    const d = db();
    await saveStandardMealNames(d, RENAMED);
    await saveStandardMealNames(d, ['A', 'B', 'C', 'D']);
    expect(await settingsOf(d)).toMatchObject({ mealNames: ['A', 'B', 'C', 'D'], legacyMealNames: STANDARD });
  });

  it('saving unchanged names sets nothing', async () => {
    const d = db();
    await saveSettings(d, {});
    const before = await settingsOf(d);
    await saveStandardMealNames(d, [' Frühstück ', ...STANDARD.slice(1)]);
    expect(await settingsOf(d)).toEqual(before);
  });

  it('builds on the names stored at saving, not on a copy of the page', async () => {
    const d = db();
    await saveSettings(d, { mealNames: RENAMED, legacyMealNames: STANDARD });
    await saveStandardMealNames(d, ['A', 'B', 'C', 'D']);
    expect((await settingsOf(d)).legacyMealNames).toEqual(STANDARD);
  });

  it('an own name goes to the meal and into the picker', async () => {
    const d = db();
    await oldEntry(d, 1, at(12));
    const [meal] = await readDay(d, DATE);
    expect(await chooseMealName(d, meal!, '  Kuchen bei Oma ')).toEqual({ listed: true });
    expect((await readDay(d, DATE))[0]).toMatchObject({
      name: 'Kuchen bei Oma',
      virtual: false,
      eatenAt: at(12),
    });
    expect((await settingsOf(d)).customMealNames).toEqual(['Kuchen bei Oma']);
    expect((await d.outbox.toArray()).map((o) => o.table).sort()).toContain('settings');
  });

  it('keeps no duplicates and neither standard names nor the automatic one', async () => {
    const d = db();
    await saveSettings(d, {});
    await oldEntry(d, 0, at(8));
    const [meal] = await readDay(d, DATE);
    for (const name of ['Kuchen', 'kuchen', 'mittagessen', 'Weitere Mahlzeit'])
      await chooseMealName(d, meal!, name);
    expect((await settingsOf(d)).customMealNames).toEqual(['Kuchen']);
  });

  it('a full list leaves the name on the meal and says so', async () => {
    const d = db();
    const full = Array.from({ length: MAX_CUSTOM_MEAL_NAMES }, (_, i) => `Name ${i}`);
    await saveSettings(d, { customMealNames: full });
    await oldEntry(d, 0, at(8));
    const [meal] = await readDay(d, DATE);
    expect(await chooseMealName(d, meal!, 'Noch einer')).toEqual({ listed: false });
    expect((await readDay(d, DATE))[0]!.name).toBe('Noch einer');
    expect((await settingsOf(d)).customMealNames).toEqual(full);
  });

  it('a name the server would refuse changes neither the meal nor the list', async () => {
    const d = db();
    await oldEntry(d, 0, at(8));
    const [meal] = await readDay(d, DATE);
    await expect(chooseMealName(d, meal!, 'x'.repeat(41))).rejects.toThrow();
    expect(await d.diaryMeals.count()).toBe(0);
    expect(await d.settings.get(SETTINGS_ID)).toBeUndefined();
  });

  it('a deleted own name leaves the picker, the meal keeps it', async () => {
    const d = db();
    await oldEntry(d, 0, at(8));
    const [meal] = await readDay(d, DATE);
    await chooseMealName(d, meal!, 'Kuchen bei Oma');
    await removeOwnMealName(d, 'Kuchen bei Oma');
    expect(ownMealNames(await settingsOf(d))).toEqual([]);
    expect((await readDay(d, DATE))[0]!.name).toBe('Kuchen bei Oma');
  });

  it('an own name equal to a renamed standard name is offered once', () => {
    const settings = { ...DEFAULT_SETTINGS, mealNames: RENAMED, customMealNames: ['Morgens', 'Kuchen'] };
    expect(ownMealNames(settings)).toEqual(['Kuchen']);
  });

  it('naming a meal keeps the order of an old day', async () => {
    const d = db();
    // Snacks in the morning: an old day stays in the order of its four meals, not by time.
    await oldEntry(d, 3, at(7));
    await oldEntry(d, 0, at(9));
    await oldEntry(d, 1, at(12));
    const order = (await readDay(d, DATE)).map((m) => m.id);
    expect(order).toEqual([0, 1, 3].map((slot) => dayId.diaryMeal(DATE, slot)));
    const lunch = (await readDay(d, DATE)).find((m) => m.slot === 1)!;
    await chooseMealName(d, lunch, 'Kuchen bei Oma');
    const day = await readDay(d, DATE);
    expect(day.map((m) => m.id)).toEqual(order);
    expect(day[1]).toMatchObject({ name: 'Kuchen bei Oma', eatenAt: at(12) });
  });
});
