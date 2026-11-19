import { describe, expect, it } from 'vitest';
import {
  buildDayMeals,
  canBeNight,
  closestMeal,
  dayId,
  eatenAtOf,
  entryMealKey,
  EXTRA_MEAL_NAME,
  isNightOf,
  newMealEatenAt,
  nextMealName,
  slotForNewMeal,
  typicalEatenAt,
  type DiaryMeal,
  type FoodEntry,
} from '../src/index.js';

const DATE = '2026-11-19';
const NAMES = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'];
const at = (hour: number, minute = 0) => eatenAtOf(DATE, hour, minute);

const entry = (id: string, meal: number, loggedAt: number, over: Partial<FoodEntry> = {}): FoodEntry => ({
  id,
  updatedAt: 1,
  deleted: false,
  date: DATE,
  meal,
  loggedAt,
  foodId: null,
  source: 'quick',
  name: id,
  brand: null,
  grams: null,
  portionLabel: null,
  portionGrams: null,
  quantity: 1,
  per100: null,
  nutrients: { ENERCC: 100 },
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

const record = (id: string, slot: number, eatenAt: number, over: Partial<DiaryMeal> = {}): DiaryMeal => ({
  id,
  updatedAt: 1,
  deleted: false,
  date: DATE,
  name: `Mahlzeit ${id}`,
  eatenAt,
  slot,
  timeEdited: false,
  ...over,
});

const build = (entries: FoodEntry[], records: DiaryMeal[] = []) =>
  buildDayMeals({ date: DATE, entries, records, names: NAMES });

describe('buildDayMeals', () => {
  it('forms one meal per index from entries without a meal, named like the index', () => {
    const meals = build([entry('a', 0, at(8)), entry('b', 0, at(8, 5)), entry('c', 2, at(19))]);
    expect(meals.map((m) => [m.id, m.name, m.virtual])).toEqual([
      [dayId.diaryMeal(DATE, 0), 'Frühstück', true],
      [dayId.diaryMeal(DATE, 2), 'Abendessen', true],
    ]);
    expect(meals[0]!.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(meals[0]!.eatenAt).toBe(at(8));
  });

  it('keeps the time of a meal when its first entry is deleted', () => {
    const meals = build([entry('a', 0, at(8), { deleted: true }), entry('b', 0, at(9))]);
    expect(meals[0]!.eatenAt).toBe(at(8));
    expect(meals[0]!.entries.map((e) => e.id)).toEqual(['b']);
  });

  it('gives a meal without a fitting entry time the typical time of its index', () => {
    const logged = eatenAtOf('2026-11-25', 20, 0);
    expect(build([entry('a', 1, logged)])[0]!.eatenAt).toBe(typicalEatenAt(DATE, 1));
  });

  it('counts an entry shortly after midnight as the night of the day', () => {
    const meal = build([entry('a', 2, eatenAtOf(DATE, 0, 30, true))])[0]!;
    expect(meal.night).toBe(true);
    expect(meal.eatenAt).toBe(eatenAtOf(DATE, 0, 30, true));
  });

  it('shows only meals with a live entry or something waiting', () => {
    const r = record('m1', 0, at(8));
    expect(build([], [r])).toEqual([]);
    expect(build([entry('a', 0, at(8), { diaryMealId: 'm1', deleted: true })], [r])).toEqual([]);
    const waiting = buildDayMeals({
      date: DATE,
      entries: [],
      records: [r],
      names: NAMES,
      pending: [{ value: 'foto', meal: 0, diaryMealId: 'm1', at: at(8) }],
    });
    expect(waiting.map((m) => [m.id, m.pending])).toEqual([['m1', ['foto']]]);
  });

  it('keeps an entry in a deleted record visible', () => {
    const meals = build(
      [entry('a', 0, at(8), { diaryMealId: 'm1' })],
      [record('m1', 0, at(8), { deleted: true })],
    );
    expect(meals.map((m) => m.id)).toEqual(['m1']);
  });

  it('shows a placeholder while the record of an entry has not arrived', () => {
    const meal = build([entry('a', 1, at(12), { diaryMealId: 'later' })])[0]!;
    expect(meal).toMatchObject({ id: 'later', name: 'Mittagessen', eatenAt: at(12), virtual: true });
    const beside = build([entry('old', 1, at(7)), entry('a', 1, at(12), { diaryMealId: 'later' })]);
    expect(beside.find((m) => m.id === 'later')?.eatenAt).toBe(at(12));
  });

  it('finds the meal of an index for an entry written by an older app', () => {
    const meals = build(
      [entry('old', 3, at(16))],
      [record('early', 3, at(10)), record('late', 3, at(15)), record('next', 3, at(20))],
    );
    expect(meals.map((m) => m.id)).toEqual(['late']);
    expect(build([entry('old', 3, at(9))], [record('early', 3, at(10))])[0]!.id).toBe('early');
  });

  it('follows the index when an older app moved an entry to another one', () => {
    const meals = build([entry('a', 2, at(8), { diaryMealId: 'm1' })], [record('m1', 0, at(8))]);
    expect(meals.map((m) => m.id)).toEqual([dayId.diaryMeal(DATE, 2)]);
  });

  it('keeps two meals of the same name apart', () => {
    const meals = build(
      [entry('a', 3, at(10), { diaryMealId: 'm1' }), entry('b', 3, at(16), { diaryMealId: 'm2' })],
      [record('m1', 3, at(10), { name: 'Snacks' }), record('m2', 3, at(16), { name: 'Snacks' })],
    );
    expect(meals.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('order of a day', () => {
  const dinnerFirst = [entry('a', 2, at(7)), entry('b', 0, at(21))];

  it('keeps a day from before meals had times in the order of its slots', () => {
    expect(build(dinnerFirst).map((m) => m.slot)).toEqual([0, 2]);
  });

  it('keeps that order after a rename or a move wrote a record', () => {
    const renamed = record(dayId.diaryMeal(DATE, 2), 2, at(7), { name: 'Brunch' });
    expect(build(dinnerFirst, [renamed]).map((m) => m.slot)).toEqual([0, 2]);
  });

  it('follows the clock once a time was set there', () => {
    const timed = record(dayId.diaryMeal(DATE, 2), 2, at(7), { timeEdited: true });
    expect(build(dinnerFirst, [timed]).map((m) => m.slot)).toEqual([2, 0]);
  });

  it('follows the clock once a new meal joined the day', () => {
    const meals = build(
      [...dinnerFirst, entry('c', 3, at(12), { diaryMealId: 'new' })],
      [record('new', 3, at(12))],
    );
    expect(meals.map((m) => m.slot)).toEqual([2, 3, 0]);
  });

  it('puts the night behind the evening', () => {
    const meals = build(
      [
        entry('n', 3, eatenAtOf(DATE, 0, 30, true), { diaryMealId: 'n' }),
        entry('e', 2, at(23), { diaryMealId: 'e' }),
      ],
      [record('n', 3, eatenAtOf(DATE, 0, 30, true)), record('e', 2, at(23))],
    );
    expect(meals.map((m) => m.id)).toEqual(['e', 'n']);
  });
});

describe('new meals', () => {
  it('names meals in order and skips names the day has', () => {
    expect(nextMealName(NAMES, [])).toBe('Frühstück');
    expect(nextMealName(NAMES, [{ name: 'frühstück' }, { name: 'Snacks' }])).toBe('Mittagessen');
    expect(
      nextMealName(
        NAMES,
        NAMES.map((name) => ({ name })),
      ),
    ).toBe(EXTRA_MEAL_NAME);
  });

  it('writes the index of the name, else the first free one, else the last', () => {
    expect(slotForNewMeal('Abendessen', NAMES, [])).toBe(2);
    expect(slotForNewMeal('Abendessen', NAMES, [{ slot: 2 }])).toBe(0);
    expect(slotForNewMeal('Kuchen', NAMES, [{ slot: 0 }])).toBe(1);
    expect(
      slotForNewMeal(
        'Kuchen',
        NAMES,
        [0, 1, 2, 3].map((slot) => ({ slot })),
      ),
    ).toBe(3);
  });

  it('uses the moment of logging on that day, else the typical time', () => {
    expect(newMealEatenAt(DATE, 'Snacks', NAMES, at(14))).toBe(at(14));
    const later = eatenAtOf('2026-11-22', 9, 0);
    expect(newMealEatenAt(DATE, 'Mittagessen', NAMES, later)).toBe(at(12, 30));
    expect(newMealEatenAt(DATE, EXTRA_MEAL_NAME, NAMES, later)).toBe(at(21));
  });
});

describe('times', () => {
  it('knows the night only up to five in the morning', () => {
    expect(canBeNight(4)).toBe(true);
    expect(canBeNight(5)).toBe(false);
    expect(isNightOf(DATE, eatenAtOf(DATE, 4, 59, true))).toBe(true);
    expect(isNightOf(DATE, eatenAtOf(DATE, 5, 0, true))).toBe(false);
    expect(isNightOf(DATE, at(4))).toBe(false);
  });

  it('keeps the wall clock across a change to summer and winter time', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      const d = new Date(eatenAtOf(date, 8, 15));
      expect([d.getHours(), d.getMinutes()]).toEqual([8, 15]);
    }
  });

  it('finds the same name first, else the nearest time, with the night behind midnight', () => {
    const meal = (name: string, hour: number, night = false) => ({
      name,
      eatenAt: eatenAtOf(DATE, hour, 0, night),
      night,
    });
    const day = [meal('Frühstück', 8), meal('Snacks', 10), meal('Snacks', 16), meal('Spät', 1, true)];
    expect(closestMeal(meal('Snacks', 15), day)).toBe(day[2]);
    expect(closestMeal(meal('Brunch', 9), day)).toBe(day[0]);
    expect(closestMeal(meal('Absacker', 23), day)).toBe(day[3]);
    expect(closestMeal(meal('Snacks', 15), [])).toBeUndefined();
  });

  it('names the meal of an entry', () => {
    expect(entryMealKey({ date: DATE, meal: 1, diaryMealId: null })).toBe(dayId.diaryMeal(DATE, 1));
    expect(entryMealKey({ date: DATE, meal: 1, diaryMealId: 'm1' })).toBe('m1');
  });
});
