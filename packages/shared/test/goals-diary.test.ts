import { describe, expect, it } from 'vitest';
import { goalForDate, microTarget, targetsForDate, uniformWeek } from '../src/goals.js';
import { microStatus, summarizeDay } from '../src/diary.js';
import { dailyRows, periodStats } from '../src/reports.js';
import type { ExerciseEntry, FoodEntry, Goal } from '../src/schemas.js';

const goal = (validFrom: string, kcal: number, weekend?: number): Goal => ({
  id: `g:${validFrom}`,
  updatedAt: 1,
  deleted: false,
  validFrom,
  days: uniformWeek({ kcal, proteinG: 150, fatG: 70, carbsG: 200 }).map((d, i) =>
    i >= 5 && weekend ? { ...d, kcal: weekend } : d,
  ),
  micros: {},
});

const entry = (date: string, meal: number, kcal: number, extra: Record<string, number> = {}): FoodEntry => ({
  id: `${date}-${meal}-${kcal}`,
  updatedAt: 1,
  deleted: false,
  date,
  meal,
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
  nutrients: { ENERCC: kcal, ...extra },
  mealId: null,
  aiAnalysisId: null,
  groupId: null,
  groupName: null,
});

const exercise = (date: string, kcal: number): ExerciseEntry => ({
  id: `ex-${date}`,
  updatedAt: 1,
  deleted: false,
  date,
  typeKey: 'running',
  name: 'Laufen',
  minutes: 30,
  intensity: 'moderate',
  met: 9.8,
  weightKg: 80,
  kcal,
  loggedAt: 1,
  note: null,
});

describe('goals', () => {
  const goals = [goal('2026-09-01', 2000), goal('2026-10-01', 1800, 2200)];

  it('picks the goal valid on a date (history)', () => {
    expect(goalForDate(goals, '2026-09-15')!.id).toBe('g:2026-09-01');
    expect(goalForDate(goals, '2026-10-07')!.id).toBe('g:2026-10-01');
    expect(goalForDate(goals, '2026-01-01')!.id).toBe('g:2026-09-01');
    expect(goalForDate([{ ...goals[1]!, deleted: true }], '2026-10-07')).toBeUndefined();
  });

  it('resolves weekday-specific targets', () => {
    expect(targetsForDate(goals, '2026-10-07').kcal).toBe(1800); // Wednesday
    expect(targetsForDate(goals, '2026-10-10').kcal).toBe(2200); // Saturday
    expect(targetsForDate([], '2026-10-10').kcal).toBe(2000); // fallback
  });

  it('derives DGE micro targets from energy', () => {
    expect(microTarget('FIBT', 2000)).toBe(30);
    expect(microTarget('NACL', 2000)).toBe(6);
    expect(microTarget('SUGAR', 2000)).toBe(50); // 10 % of 2000 kcal / 4
    expect(microTarget('FASAT', 1800)).toBe(20); // 10 % of 1800 kcal / 9
    expect(microTarget('FIBT', 2000, 40)).toBe(40);
    expect(microStatus(25, { grams: 30, kind: 'min' })).toBe('low');
    expect(microStatus(7, { grams: 6, kind: 'max' })).toBe('high');
  });
});

describe('day summary & reports', () => {
  const goals = [goal('2026-10-01', 2000)];
  const entries = [
    entry('2026-10-07', 0, 500),
    entry('2026-10-07', 2, 700),
    entry('2026-10-08', 1, 900),
    { ...entry('2026-10-07', 1, 999), deleted: true },
  ];

  it('computes goal − food + exercise', () => {
    const s = summarizeDay({
      date: '2026-10-07',
      entries,
      exercises: [exercise('2026-10-07', 300)],
      goals,
      settings: { addExerciseCalories: true },
    });
    expect(s.food.ENERCC).toBe(1200);
    expect(s.perMeal.map((m) => m.ENERCC ?? 0)).toEqual([500, 0, 700, 0]);
    expect(s.budgetKcal).toBe(2300);
    expect(s.remainingKcal).toBe(1100);
    const off = summarizeDay({
      date: '2026-10-07',
      entries,
      exercises: [exercise('2026-10-07', 300)],
      goals,
      settings: { addExerciseCalories: false },
    });
    expect(off.remainingKcal).toBe(800);
  });

  it('aggregates periods over logged days only', () => {
    const rows = dailyRows({
      from: '2026-10-06',
      to: '2026-10-08',
      entries,
      exercises: [exercise('2026-10-07', 300)],
      weights: [
        { id: 'w:2026-10-06', updatedAt: 1, deleted: false, date: '2026-10-06', kg: 80 },
        { id: 'w:2026-10-08', updatedAt: 1, deleted: false, date: '2026-10-08', kg: 79.4 },
      ],
      goals,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]!.logged).toBe(false);
    const st = periodStats(rows);
    expect(st.loggedDays).toBe(2);
    expect(st.avg.kcal).toBe(1050);
    expect(st.daysUnderGoal).toBe(2);
    expect(st.weightChange).toBe(-0.6);
    expect(st.totalExerciseMinutes).toBe(30);
  });
});
