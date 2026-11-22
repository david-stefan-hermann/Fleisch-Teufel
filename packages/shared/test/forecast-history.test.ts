import { describe, expect, it } from 'vitest';
import { addDays, dateRange } from '../src/dates.js';
import { estimateExpenditure } from '../src/expenditure.js';
import { forecastAt, forecastHistory } from '../src/forecastHistory.js';
import { linearTrend, movingAverage } from '../src/forecast.js';
import { N } from '../src/nutrients.js';
import type { DailyRow } from '../src/reports.js';
import { bodyProfile, KCAL_PER_KG_BODY_WEIGHT, tdee } from '../src/tdee.js';

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

const START = '2026-09-01';
const days = (n: number) => dateRange(START, addDays(START, n - 1));
const settings = {
  sex: 'male' as const,
  birthDate: '1990-01-01',
  heightCm: 180,
  activityLevel: 'light' as const,
};

describe('forecast history', () => {
  it('starts at the 7-day mean and follows the weight trend with enough own data', () => {
    const ds = days(40);
    const rows = ds.map((d) => row(d, 2000));
    const weights = ds.map((d, i) => ({ date: d, kg: 80 - (0.5 / 7) * i }));
    const day = ds[34]!;
    const [f] = forecastHistory({ rows, weights, from: day, to: day, settings });
    expect(f).toMatchObject({ date: day, basis: 'data' });
    const mean = movingAverage(weights.slice(0, 35), 7).at(-1)!.kg;
    expect(f!.startKg).toBeCloseTo(mean, 6);
    const trend = linearTrend(weights.slice(35 - 28, 35))!;
    // The maintenance is rounded to 10 kcal: the slope matches the trend to that precision.
    expect(f!.slopePerDay).toBeCloseTo(trend.slopePerDay, 3);
    expect(forecastAt(f!, 14).kg).toBeCloseTo(f!.startKg + 14 * f!.slopePerDay, 6);
  });

  it('uses nothing after the day (longer data, same forecast)', () => {
    const ds = days(60);
    const rows = ds.map((d, i) => row(d, i < 35 ? 2000 : 3500));
    const weights = ds.map((d, i) => ({ date: d, kg: i < 35 ? 80 - 0.05 * i : 90 + 0.3 * i }));
    const day = ds[34]!;
    const short = forecastHistory({
      rows: rows.slice(0, 35),
      weights: weights.slice(0, 35),
      from: day,
      to: day,
      settings,
    });
    const long = forecastHistory({ rows, weights, from: day, to: day, settings });
    expect(long).toEqual(short);
    expect(long).toHaveLength(1);
  });

  it('falls back to the formula with seven complete days and a profile', () => {
    const ds = days(10);
    const rows = ds.map((d) => row(d, 2200));
    const weights = [
      { date: ds[0]!, kg: 82 },
      { date: ds[9]!, kg: 81 },
    ];
    const day = ds[9]!;
    const [f] = forecastHistory({ rows, weights, from: day, to: day, settings });
    expect(estimateExpenditure({ rows, weights, today: day }).value).toBeNull();
    const maintenance = Math.round(tdee(bodyProfile(settings, 81, day)!, 'light'));
    expect(f).toMatchObject({ basis: 'formula', maintenanceKcal: maintenance, netKcal: 2200 });
    expect(f!.slopePerDay).toBeCloseTo((2200 - maintenance) / KCAL_PER_KG_BODY_WEIGHT, 9);
  });

  it('leaves out days with too few complete days, no profile or an old weigh-in', () => {
    const ds = days(30);
    const rows = ds.map((d) => row(d, 2200));
    const weights = [{ date: ds[0]!, kg: 82 }];
    const run = (over: Partial<Parameters<typeof forecastHistory>[0]>) =>
      forecastHistory({ rows, weights, from: ds[0]!, to: ds[29]!, settings, ...over }).map((f) => f.date);
    // Seven complete days from the 8th on; the weigh-in of day 1 is too old after day 15.
    expect(run({})).toEqual(ds.slice(7, 15));
    expect(run({ settings: undefined })).toEqual([]);
    expect(run({ settings: { ...settings, heightCm: null } })).toEqual([]);
  });

  it('counts the day itself only once closed, two meals count from the next day', () => {
    const ds = days(8);
    const rows = ds.map((d, i) => row(d, i === 6 ? 4000 : 2000));
    const weights = [{ date: ds[0]!, kg: 80 }];
    const out = forecastHistory({ rows, weights, from: ds[6]!, to: ds[7]!, settings });
    // Day 7 itself is not closed: no forecast (six complete days), day 8 counts it.
    expect(out.map((f) => f.date)).toEqual([ds[7]]);
    expect(out[0]!.netKcal).toBeCloseTo((6 * 2000 + 4000) / 7, 6);
    const closed = rows.map((r, i) => (i === 6 ? { ...r, completed: true } : r));
    const [c7] = forecastHistory({ rows: closed, weights, from: ds[6]!, to: ds[6]!, settings });
    expect(c7!.netKcal).toBeCloseTo((6 * 2000 + 4000) / 7, 6);
  });

  it('subtracts training only while it is credited', () => {
    const ds = days(10);
    const rows = ds.map((d) => row(d, 2500, { exerciseKcal: 300, stepsKcal: 100 }));
    const weights = [{ date: ds[0]!, kg: 80 }];
    const day = ds[9]!;
    const at = (o: { creditExercise?: boolean; creditSteps?: boolean }) =>
      forecastHistory({ rows, weights, from: day, to: day, settings, ...o })[0]!.netKcal;
    expect(at({})).toBe(2200); // exerciseKcal includes the steps
    expect(at({ creditExercise: false })).toBe(2400);
    expect(at({ creditSteps: false })).toBe(2300);
  });

  it('averages only the last intake days when asked', () => {
    const ds = days(14);
    const rows = ds.map((d, i) => row(d, i < 7 ? 2000 : 3000, { completed: i === 13 }));
    const weights = [{ date: ds[13]!, kg: 80 }];
    const day = ds[13]!;
    const at = (intakeDays?: number) =>
      forecastHistory({ rows, weights, from: day, to: day, settings, intakeDays })[0]!.netKcal;
    expect(at()).toBe(2500);
    expect(at(7)).toBe(3000);
  });
});
