import { describe, expect, it } from 'vitest';
import { uniformWeek } from '../src/goals.js';
import { dayVerdict, overLevel, stripMark, summarizeDay } from '../src/diary.js';
import type { ExerciseEntry, FoodEntry, Goal } from '../src/schemas.js';

const DATE = '2026-10-07';
const goal: Goal = {
  id: 'g',
  updatedAt: 1,
  deleted: false,
  validFrom: '2026-01-01',
  days: uniformWeek({ kcal: 2000, proteinG: 150, fatG: 70, carbsG: 200 }),
  micros: {},
};

const food = (kcal: number): FoodEntry => ({
  id: `f-${kcal}`,
  updatedAt: 1,
  deleted: false,
  date: DATE,
  meal: 0,
  loggedAt: 1,
  foodId: null,
  source: 'quick',
  name: 'x',
  brand: null,
  grams: null,
  portionLabel: null,
  portionGrams: null,
  quantity: 1,
  per100: null,
  nutrients: { ENERCC: kcal },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  groupName: null,
  photoId: null,
  photoIds: null,
  note: null,
  diaryMealId: null,
});

const training = (kcal: number): ExerciseEntry => ({
  id: `ex-${kcal}`,
  purgedAt: null,
  updatedAt: 1,
  deleted: false,
  date: DATE,
  typeKey: 'running',
  name: 'Laufen',
  minutes: 30,
  intensity: 'moderate',
  met: 9.8,
  weightKg: 80,
  kcal,
  loggedAt: 1,
  note: null,
  templateId: null,
  groupId: null,
  steps: null,
  distanceM: null,
});
const steps = (kcal: number): ExerciseEntry => ({
  ...training(kcal),
  id: `s:${DATE}`,
  typeKey: 'steps',
  name: 'Schritte',
  steps: 8000,
  distanceM: 6000,
});

const day = (
  entries: FoodEntry[],
  exercises: ExerciseEntry[] = [],
  settings = { addExerciseCalories: true, addStepsCalories: true },
  goals = [goal],
) => summarizeDay({ date: DATE, entries, exercises, goals, settings });

describe('day verdict', () => {
  it('needs a food entry and a goal', () => {
    expect(dayVerdict(day([]))).toBeNull();
    expect(dayVerdict(day([], [training(300)]))).toBeNull();
    expect(dayVerdict(day([food(2500)], [], undefined, []))).toBeNull();
  });

  it('is over from 1 kcal above the budget, exactly the budget is within', () => {
    expect(dayVerdict(day([food(2000)]))).toBe('ok');
    expect(dayVerdict(day([food(2001)]))).toBe('over');
  });

  it('counts credited training and only credited steps', () => {
    expect(dayVerdict(day([food(2200)], [training(300)]))).toBe('ok');
    expect(
      dayVerdict(day([food(2200)], [steps(300)], { addExerciseCalories: true, addStepsCalories: false })),
    ).toBe('over');
    expect(dayVerdict(day([food(2200)], [steps(300)]))).toBe('ok');
  });
});

describe('over level', () => {
  it('steps at 10 % and 25 % above the budget', () => {
    expect(overLevel(2001, 2000)).toBe(1);
    expect(overLevel(2200, 2000)).toBe(1);
    expect(overLevel(2201, 2000)).toBe(2);
    expect(overLevel(2500, 2000)).toBe(2);
    expect(overLevel(2501, 2000)).toBe(3);
    expect(overLevel(4000, 2000)).toBe(3);
  });
});

describe('strip mark', () => {
  it('training kcal without steps, level only when over', () => {
    const m = stripMark(day([food(2450)], [training(300), steps(200)]), true);
    expect(m).toMatchObject({
      food: true,
      training: true,
      verdict: 'ok',
      level: null,
      eatenKcal: 2450,
      budgetKcal: 2500,
      trainingKcal: 300,
    });
    expect(stripMark(day([food(2600)]), false)).toMatchObject({ verdict: 'over', level: 3 });
  });

  it('training not credited keeps its kcal and does not raise the budget', () => {
    const m = stripMark(
      day([food(2100)], [training(300)], { addExerciseCalories: false, addStepsCalories: true }),
      true,
    );
    expect(m).toMatchObject({ verdict: 'over', level: 1, budgetKcal: 2000, trainingKcal: 300 });
  });
});
