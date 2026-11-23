import type { DayForecast } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { aheadDaysFor, dayView, forecastChartModel, niceRange } from '@/features/progress/forecastChart';

const fc = (date: string, startKg = 80, slopePerDay = -0.1): DayForecast => ({
  date,
  startKg,
  slopePerDay,
  maintenanceKcal: 2500,
  netKcal: 1730,
  basis: 'data',
  noiseSdKg: 0,
  noisePhi: 0,
  slopeSeKg: 0,
});

const visible = [
  { date: '2026-11-02', kg: 81 },
  { date: '2026-11-05', kg: 80 },
];
const avg = [
  { date: '2026-10-28', kg: 81.8 },
  { date: '2026-11-02', kg: 81 },
  { date: '2026-11-05', kg: 80.5 },
];
const forecasts = [
  fc('2026-10-30', 81.5),
  fc('2026-11-02', 81, -0.2),
  fc('2026-11-05'),
  fc('2026-11-06', 80.2, 0),
];
const base = { visible, avg, target: 75, from: '2026-11-01', today: '2026-11-06', forecasts, aheadDays: 14 };

describe('forecast chart', () => {
  it('needs a forecast inside the period', () => {
    expect(forecastChartModel({ ...base, forecasts: [fc('2026-10-30')] })).toBeNull();
  });

  it('begins at the first weigh-in, every day carries the mean of the last weigh-in up to it', () => {
    const m = forecastChartModel(base)!;
    expect(m.dates[0]).toBe('2026-11-02');
    expect(m.dates).toHaveLength(5);
    expect(m.weights).toEqual([
      { i: 0, kg: 81 },
      { i: 3, kg: 80 },
    ]);
    expect(m.meanOn).toEqual([81, 81, 81, 80.5, 80.5]);
    // Without weigh-ins in the period it begins with the period and the mean from before it.
    const empty = forecastChartModel({ ...base, visible: [] })!;
    expect(empty.dates[0]).toBe('2026-11-01');
    expect(empty.meanOn[0]).toBe(81.8);
  });

  it('expects for a day what the 14 days before it forecast', () => {
    const m = forecastChartModel(base)!;
    // 4 Nov: 30 Oct (81,5 − 0,5) and 2 Nov (81 − 0,4).
    expect(m.expected[2]!.lo).toBeCloseTo(80.6, 9);
    expect(m.expected[2]!.hi).toBeCloseTo(81, 9);
    // 2 Nov: only 30 Oct before it (81,5 − 0,3).
    expect(m.expected[0]!.lo).toBeCloseTo(81.2, 9);
  });

  it('keeps the y range when another day is chosen and includes target and today’s forecast', () => {
    const m = forecastChartModel(base)!;
    expect(m.yRange[0]).toBeLessThanOrEqual(75);
    expect(m.yRange[1]).toBeGreaterThanOrEqual(81.8);
  });

  it('shows today 14 days ahead and a past day up to today', () => {
    const m = forecastChartModel(base)!;
    const today = dayView(m, 4);
    expect(today.course).toHaveLength(15);
    expect(today.prognosis).toEqual({ kg: 80.2, date: '2026-11-20' });
    const past = dayView(m, 0);
    expect(past.course.at(-1)!.i).toBe(4);
    expect(past.prognosis!.kg).toBeCloseTo(80.2, 9);
    expect(past.prognosis!.date).toBe('2026-11-06');
    expect(dayView(m, 1)).toMatchObject({ forecast: null, course: [], prognosis: null });
  });

  it('looks a week ahead in the 7-day view, else two', () => {
    expect(aheadDaysFor(7)).toBe(7);
    expect(aheadDaysFor(30)).toBe(14);
    expect(aheadDaysFor(Infinity)).toBe(14);
  });

  it('rounds the y range outward, at least a kilogram high', () => {
    expect(niceRange([80.2, 80.4])).toEqual([79.5, 81]);
    expect(niceRange([75, 84])).toEqual([74, 86]);
  });
});
