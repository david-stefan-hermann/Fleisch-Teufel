import { addDays, buildWeightModel, type ModelDay, type ModelParams } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import {
  aheadDaysFor,
  curvePath,
  dayView,
  forecastChartModel,
  niceRange,
} from '@/features/progress/forecastChart';

const START = '2026-09-01';
const TODAY = '2026-11-23';
const FIXED: ModelParams = { obs: 0.3, ql: 0.02, qb: 5, qg: 0.005 };

/** 84 days losing on 2 000 kcal against 2 400: weighed on most days, every day logged but every ninth. */
const days: ModelDay[] = Array.from({ length: 84 }, (_, i) => ({
  date: addDays(START, i),
  kg: i % 4 === 3 ? null : Math.round((85 - (i * 400) / 7700 + (i % 3) * 0.2) * 10) / 10,
  kcal: i % 9 === 8 ? null : 2000,
}));
const kcal = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2400, params: FIXED })!;
const trend = buildWeightModel({ days, mode: 'trend', params: { ...FIXED, qb: 0.001 } })!;
const models = { kcal, trend };

describe('forecast chart', () => {
  it('needs a model with a forecast inside the period', () => {
    expect(forecastChartModel({ models: null, days, from: START, today: TODAY, aheadDays: 14 })).toBeNull();
    const m = forecastChartModel({ models, days, from: START, today: TODAY, aheadDays: 14 })!;
    // The first three weeks have no forecast: the chart begins with the data, the choice three weeks later.
    expect(m.dates[0]).toBe(START);
    expect(m.dates.at(-1)).toBe(TODAY);
    expect(m.firstChoice).toBe(21);
  });

  it('begins at the period when the data begins earlier', () => {
    const m = forecastChartModel({ models, days, from: '2026-10-25', today: TODAY, aheadDays: 14 })!;
    expect(m.dates).toHaveLength(30);
    expect(m.firstChoice).toBe(0);
    expect(m.weights[0]!.i).toBeGreaterThanOrEqual(0);
    expect(m.level).toHaveLength(30);
    expect(m.kcal.every((k) => k.kcal === 2000)).toBe(true);
  });

  it('draws the forecast of every chosen day up to the right edge', () => {
    const m = forecastChartModel({ models, days, from: '2026-10-25', today: TODAY, aheadDays: 14 })!;
    const today = dayView(m, 29);
    expect(today.curve[0]!.i).toBe(29);
    expect(today.curve.at(-1)!.i).toBe(29 + 14);
    expect(today.end!.date).toBe(addDays(TODAY, 14));
    const past = dayView(m, 5);
    expect(past.curve[0]!.i).toBe(5);
    expect(past.curve.at(-1)!.i).toBe(29 + 14);
    expect(past.end!.date).toBe(addDays(TODAY, 14));
    expect(past.trend.at(-1)!.i).toBe(29 + 14);
    // Losing: the forecast ends lower, the bands hold the level, the weigh-in band is wider.
    expect(past.end!.level).toBeLessThan(past.level!);
    expect(past.end!.curve[0]).toBeLessThan(past.end!.level);
    expect(past.end!.weighIn[0]).toBeLessThanOrEqual(past.end!.curve[0]);
    expect(past.eating!.mean).toBe(2000);
  });

  it('keeps the y range when another day is chosen and includes today’s outer band', () => {
    const m = forecastChartModel({ models, days, from: '2026-10-25', today: TODAY, aheadDays: 14 })!;
    const v = dayView(m, 29);
    expect(m.yRange[0]).toBeLessThanOrEqual(v.end!.weighIn[0]);
    expect(m.yRange[1]).toBeGreaterThanOrEqual(Math.max(...m.weights.map((w) => w.kg)));
    expect(m.kcalRange[0]).toBeLessThanOrEqual(2000);
    expect(m.kcalRange[1]).toBeGreaterThanOrEqual(2000);
  });

  it('clamps a choice before the first forecast', () => {
    const m = forecastChartModel({ models, days, from: START, today: TODAY, aheadDays: 14 })!;
    expect(dayView(m, 3).index).toBe(21);
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

  it('draws a curve through the points, not connected dots', () => {
    expect(curvePath([])).toBe('');
    expect(
      curvePath([
        [0, 0],
        [10, 5],
      ]),
    ).toBe('M0.0,0.0L10.0,5.0');
    const d = curvePath([
      [0, 0],
      [10, 10],
      [20, 0],
    ]);
    expect(d.startsWith('M0.0,0.0C')).toBe(true);
    expect(d.endsWith('20.0,0.0')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });
});
