import { describe, expect, it } from 'vitest';
import { addDays, dateRange } from '../src/dates.js';
import { estimateExpenditure, targetFromExpenditure, weekSummary } from '../src/expenditure.js';
import { N } from '../src/nutrients.js';
import { isCompleteDay, periodStats, type DailyRow } from '../src/reports.js';

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
  exerciseMinutes: 0,
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
    const est = estimateExpenditure({ rows, weights })!;
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
    expect(estimateExpenditure({ rows, weights })!.kcal).toBe(2000);
  });

  it('ignores incomplete days and needs enough complete ones and weigh-ins', () => {
    const weights = days(21).map((d) => ({ date: d, kg: 80 }));
    // 14 complete days plus 7 half days (lunch only, 600 kcal): the half days do not pull it down.
    const rows = days(21).map((d, i) => (i < 7 ? row(d, 600, { mealsLogged: 1 }) : row(d, 2000)));
    expect(estimateExpenditure({ rows, weights })!.kcal).toBe(2000);
    expect(estimateExpenditure({ rows, weights })!.confidence).toBe('medium');
    // One complete day fewer: nothing.
    expect(
      estimateExpenditure({ rows: rows.map((r, i) => (i === 7 ? row(r.date, null) : r)), weights }),
    ).toBeNull();
    // Weigh-ins only on three days, or all within one week: nothing.
    expect(estimateExpenditure({ rows, weights: weights.slice(0, 3) })).toBeNull();
    expect(estimateExpenditure({ rows, weights: weights.slice(10, 16) })).toBeNull();
  });

  it('refuses implausible results (a wrong weight, a week of missing dinners)', () => {
    const rows = days(21).map((d) => row(d, 2000));
    const weights = days(21).map((d, i) => ({ date: d, kg: 80 - 0.5 * i })); // 3,5 kg a week
    expect(estimateExpenditure({ rows, weights })).toBeNull();
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
