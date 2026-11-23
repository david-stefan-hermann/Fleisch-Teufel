import { describe, expect, it } from 'vitest';
import { addDays, dateRange } from '../src/dates.js';
import { estimateExpenditure } from '../src/expenditure.js';
import {
  curveSpread,
  expectedRange,
  forecastAt,
  forecastHistory,
  forecastSpread,
  type DayForecast,
} from '../src/forecastHistory.js';
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

const fc = (date: string, over: Partial<DayForecast> = {}): DayForecast => ({
  date,
  startKg: 80,
  slopePerDay: -0.1,
  maintenanceKcal: 2500,
  netKcal: 1730,
  basis: 'data',
  noiseSdKg: 0.1,
  slopeSeKg: 0.01,
  ...over,
});

describe('forecast band', () => {
  it('measures how far the smoothed curve strays from its trend', () => {
    const straight = days(20).map((d, i) => ({ date: d, kg: 80 - 0.05 * i }));
    expect(curveSpread(straight)).toBe(0);
    const wave = days(28).map((d, i) => ({ date: d, kg: 80 - 0.05 * i + 0.2 * Math.sin(i / 3) }));
    expect(curveSpread(wave)).toBeGreaterThan(0.08);
    expect(curveSpread(wave)).toBeLessThan(0.2);
    expect(curveSpread(wave.slice(0, 3))).toBe(0);
  });

  it('takes the noise of the 7-day mean, not of the single weigh-ins', () => {
    const ds = days(40);
    const rows = ds.map((d) => row(d, 2000));
    // Weigh-ins jump ±0,5 kg every other day: the 7-day mean stays calm.
    const weights = ds.map((d, i) => ({ date: d, kg: 80 - 0.05 * i + (i % 2 ? 0.5 : -0.5) }));
    const [f] = forecastHistory({ rows, weights, from: ds[39]!, to: ds[39]!, settings });
    expect(f!.noiseSdKg).toBeLessThan(0.1);
    expect(f!.slopeSeKg).toBeGreaterThan(0);
  });

  it('widens the band with the days ahead', () => {
    const f = fc('2026-11-01');
    expect(forecastSpread(f, 0)).toBeCloseTo(0.128, 6);
    expect(forecastSpread(f, 14)).toBeGreaterThan(forecastSpread(f, 7));
  });

  it('expects for a day what the 14 days before it forecast', () => {
    const byDate = new Map([
      ['2026-11-01', fc('2026-11-01')], // 9 days before: 79,1
      ['2026-11-05', fc('2026-11-05', { startKg: 79.8, slopePerDay: 0 })], // 79,8
      ['2026-10-20', fc('2026-10-20')], // 21 days before: too old
      ['2026-11-10', fc('2026-11-10', { startKg: 70 })], // the day itself does not count
    ]);
    const r = expectedRange(byDate, '2026-11-10')!;
    expect(r.lo).toBeCloseTo(79.1, 9);
    expect(r.hi).toBeCloseTo(79.8, 9);
    expect(expectedRange(byDate, '2026-10-20')).toBeNull();
  });
});
