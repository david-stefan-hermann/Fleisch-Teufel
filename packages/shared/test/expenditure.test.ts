import { describe, expect, it } from 'vitest';
import { addDays, dateRange } from '../src/dates.js';
import { estimateExpenditure, targetFromExpenditure, weekSummary } from '../src/expenditure.js';
import { N } from '../src/nutrients.js';
import { dailyRows, isCompleteDay, periodStats, type DailyRow } from '../src/reports.js';
import type { ExerciseEntry, FoodEntry, Goal, WeightEntry } from '../src/schemas.js';

const row = (date: string, kcal: number | null, over: Partial<DailyRow> = {}): DailyRow => ({
  date,
  logged: kcal !== null,
  mealsLogged: kcal === null ? 0 : 3,
  completed: false,
  nutrients: kcal === null ? {} : { [N.kcal]: kcal, [N.protein]: 100 },
  targetKcal: 2000,
  targetProteinG: 120,
  targetFatG: 70,
  targetCarbsG: 200,
  exerciseKcal: 0,
  stepsKcal: 0,
  exerciseMinutes: 0,
  steps: null,
  distanceM: null,
  weightKg: null,
  ...over,
});

const END = '2026-10-24';
const days = (n: number) => dateRange(addDays(END, -(n - 1)), END);

describe('complete days', () => {
  it('counts a day as complete with two meals or when it was closed', () => {
    expect(isCompleteDay(row('2026-10-01', 1800, { mealsLogged: 1 }))).toBe(false);
    expect(isCompleteDay(row('2026-10-01', 1800, { mealsLogged: 2 }))).toBe(true);
    expect(isCompleteDay(row('2026-10-01', 500, { mealsLogged: 1, completed: true }))).toBe(true);
    expect(isCompleteDay(row('2026-10-01', null, { completed: true }))).toBe(false);
  });

  it('averages over complete days only, falling back to logged days', () => {
    const rows = [
      row('2026-10-20', 2000),
      row('2026-10-21', 2200),
      row('2026-10-22', 400, { mealsLogged: 1 }), // half a day: not in the average
      row('2026-10-23', null),
    ];
    const st = periodStats(rows);
    expect(st).toMatchObject({ loggedDays: 3, completeDays: 2, basis: 'complete' });
    expect(st.avg.kcal).toBe(2100);
    expect(st.daysUnderGoal).toBe(1);
    const half = periodStats([row('2026-10-22', 400, { mealsLogged: 1 })]);
    expect(half).toMatchObject({ loggedDays: 1, completeDays: 0, basis: 'logged' });
    expect(half.avg.kcal).toBe(400);
  });
});

describe('expenditure from own data', () => {
  it('derives the maintenance from intake and the weight trend', () => {
    // 21 complete days at 2 000 kcal, weight falling 0,5 kg a week: expenditure ≈ 2 000 + 550.
    const rows = days(21).map((d) => row(d, 2000));
    const weights = days(21).map((d, i) => ({ date: d, kg: 80 - (0.5 / 7) * i }));
    const est = estimateExpenditure({ rows, weights }).value!;
    expect(est).not.toBeNull();
    expect(est.kcal).toBe(2550);
    expect(est).toMatchObject({
      days: 21,
      weighIns: 21,
      intakeAvg: 2000,
      exerciseAvg: 0,
      confidence: 'high',
    });
    expect(est.weeklyTrendKg).toBeCloseTo(-0.5, 1);
  });

  it('leaves logged training out of the base expenditure', () => {
    const rows = days(21).map((d) => row(d, 2300, { exerciseKcal: 300 }));
    const weights = days(21).map((d) => ({ date: d, kg: 80 }));
    expect(estimateExpenditure({ rows, weights }).value!.kcal).toBe(2000);
  });

  it('ignores incomplete days and needs enough complete ones and weigh-ins', () => {
    const weights = days(21).map((d) => ({ date: d, kg: 80 }));
    // 14 complete days plus 7 half days (lunch only, 600 kcal): the half days do not pull it down.
    const rows = days(21).map((d, i) => (i < 7 ? row(d, 600, { mealsLogged: 1 }) : row(d, 2000)));
    expect(estimateExpenditure({ rows, weights }).value!.kcal).toBe(2000);
    expect(estimateExpenditure({ rows, weights }).value!.confidence).toBe('medium');
    // One complete day fewer: nothing.
    expect(
      estimateExpenditure({ rows: rows.map((r, i) => (i === 7 ? row(r.date, null) : r)), weights }),
    ).toEqual({ value: null, reason: 'tooFew' });
    // Weigh-ins only on three days, or all within one week: nothing.
    expect(estimateExpenditure({ rows, weights: weights.slice(0, 3) }).reason).toBe('tooFew');
    expect(estimateExpenditure({ rows, weights: weights.slice(10, 16) }).reason).toBe('tooFew');
  });

  it('refuses implausible results (a wrong weight, a week of missing dinners)', () => {
    const rows = days(21).map((d) => row(d, 2000));
    const weights = days(21).map((d, i) => ({ date: d, kg: 80 - 0.5 * i })); // 3,5 kg a week
    expect(estimateExpenditure({ rows, weights })).toEqual({ value: null, reason: 'implausible' });
    // Dinners never logged: 700 kcal a day at a stable weight.
    const low = days(21).map((d) => row(d, 700));
    const flat = days(21).map((d) => ({ date: d, kg: 80 }));
    expect(estimateExpenditure({ rows: low, weights: flat }).reason).toBe('implausible');
  });

  it('turns an expenditure into a target with the weekly rate, never below the minimum', () => {
    expect(targetFromExpenditure(2550, -0.5, 'male')).toBe(2000);
    expect(targetFromExpenditure(2550, 0, null)).toBe(2550);
    expect(targetFromExpenditure(1600, -1, 'female')).toBe(1200);
    expect(targetFromExpenditure(1600, -1, null)).toBe(1350);
  });
});

describe('week summary', () => {
  it('sums up a Monday-to-Sunday week', () => {
    const week = dateRange('2026-10-12', '2026-10-18');
    const rows = week.map((d, i) =>
      i === 6
        ? row(d, null)
        : i === 5
          ? row(d, 700, { mealsLogged: 1 })
          : row(d, 1900 + i * 20, { exerciseKcal: 100 }),
    );
    const s = weekSummary(rows, [
      { date: '2026-10-12', kg: 80 },
      { date: '2026-10-19', kg: 79.5 }, // next week: not counted
      { date: '2026-10-16', kg: 79.6 },
    ]);
    expect(s).toMatchObject({
      from: '2026-10-12',
      to: '2026-10-18',
      completeDays: 5,
      loggedDays: 6,
      weighIns: 2,
    });
    expect(s.avgKcal).toBe(1940);
    expect(s.avgBudgetKcal).toBe(2100);
    expect(weekSummary(rows, [], { creditExercise: false }).avgBudgetKcal).toBe(2000);
    expect(s.avgProteinG).toBe(100);
    expect(s.weightDeltaKg).toBeCloseTo(-0.4, 5);
    expect(weekSummary(rows, [{ date: '2026-10-12', kg: 80 }]).weightDeltaKg).toBeNull();
    expect(
      weekSummary(
        week.map((d) => row(d, null)),
        [],
      ).avgKcal,
    ).toBeNull();
  });
});

// The worked cases of docs/plans/2026-11-bestandsaufnahme.md (Z1 to Z3), on real daily rows.
describe('numbers from the inventory of November 2026', () => {
  let n = 0;
  const food = (date: string, meal: number, kcal: number) =>
    ({
      id: `f${n++}`,
      updatedAt: 1,
      deleted: false,
      date,
      meal,
      loggedAt: n,
      nutrients: { [N.kcal]: kcal },
    }) as unknown as FoodEntry;
  const training = (date: string, kcal: number) =>
    ({
      id: `x${n++}`,
      updatedAt: 1,
      deleted: false,
      date,
      typeKey: 'running',
      minutes: 45,
      kcal,
    }) as unknown as ExerciseEntry;
  const weight = (date: string, kg: number) =>
    ({ id: `w:${date}`, updatedAt: 1, deleted: false, date, kg }) as WeightEntry;
  const goal = {
    id: 'g:2026-01-01',
    validFrom: '2026-01-01',
    deleted: false,
    updatedAt: 1,
    days: Array.from({ length: 7 }, () => ({ kcal: 2000, proteinG: 150, fatG: 60, carbsG: 200 })),
  } as unknown as Goal;

  it('Z1: training that is not credited stays in the expenditure', () => {
    // 21 days at 2 800 kcal with 400 kcal training each, weight flat.
    const to = '2026-11-10';
    const span = dateRange(addDays(to, -20), to);
    const rows = dailyRows({
      from: span[0]!,
      to,
      entries: span.flatMap((d) => [food(d, 0, 1300), food(d, 2, 1500)]),
      exercises: span.map((d) => training(d, 400)),
      weights: [],
      goals: [goal],
    });
    const weights = span.filter((_, i) => i % 3 === 0).map((d) => ({ date: d, kg: 80 }));
    const plain = estimateExpenditure({ rows, weights, creditExercise: false }).value!;
    expect(plain.kcal).toBe(2800);
    expect(plain.exerciseAvg).toBe(0);
    expect(targetFromExpenditure(plain.kcal, -0.5, 'male')).toBe(2250);
    // Credited, the training goes onto the budget and comes off the base.
    const credited = estimateExpenditure({ rows, weights, creditExercise: true }).value!;
    expect(credited.kcal).toBe(2400);
    expect(targetFromExpenditure(credited.kcal, -0.5, 'male')).toBe(1850);
  });

  it('Z2: the running day counts only once it is closed', () => {
    // 20 days at 2 500 kcal, today breakfast and lunch with 1 200 kcal at 12:30.
    const today = '2026-11-10';
    const span = dateRange(addDays(today, -20), today);
    const entries = span.flatMap((d) =>
      d === today ? [food(d, 0, 500), food(d, 1, 700)] : [food(d, 0, 1000), food(d, 2, 1500)],
    );
    const rows = dailyRows({ from: span[0]!, to: today, entries, exercises: [], weights: [], goals: [goal] });
    const week = periodStats(rows.slice(-7), { today });
    expect(week.avg.kcal).toBe(2500);
    expect(week.completeDays).toBe(6);
    expect(week.loggedDays).toBe(7);
    expect(isCompleteDay(rows.at(-1)!, { today })).toBe(false);
    expect(isCompleteDay(rows.at(-1)!)).toBe(true);
    expect(isCompleteDay({ ...rows.at(-1)!, completed: true }, { today })).toBe(true);
    const weights = span.filter((_, i) => i % 3 === 0).map((d) => ({ date: d, kg: 80 }));
    const est = estimateExpenditure({ rows, weights, today }).value!;
    expect(est.kcal).toBe(2500);
    expect(est.days).toBe(20);
    expect(est.to).toBe(today);
    // Without `today` the half day pulls it down (the old behaviour).
    expect(estimateExpenditure({ rows, weights }).value!.kcal).toBeLessThan(2500);
  });

  it('Z3: week card and report show the same budget and trend', () => {
    const from = '2026-11-02';
    const to = '2026-11-08';
    const weights = [
      weight('2026-11-02', 81),
      weight('2026-11-03', 80),
      weight('2026-11-07', 80.6),
      weight('2026-11-08', 80.5),
    ];
    const rows = dailyRows({
      from,
      to,
      entries: dateRange(from, to).flatMap((d) => [food(d, 0, 1000), food(d, 2, 1200)]),
      exercises: [training('2026-11-03', 500), training('2026-11-05', 500)],
      weights,
      goals: [goal],
    });
    const card = weekSummary(rows, weights);
    const report = periodStats(rows);
    expect(card.avgBudgetKcal).toBe(2143);
    expect(report.avgBudgetKcal).toBe(2143);
    expect(card.weightDeltaKg).toBe(-0.07);
    expect(report.weightTrendKg).toBe(-0.07);
    // Without credited training the budget is the target.
    expect(periodStats(rows, { creditExercise: false }).avgBudgetKcal).toBe(2000);
    expect(weekSummary(rows, weights, { creditExercise: false }).avgBudgetKcal).toBe(2000);
  });
});
