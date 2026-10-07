import { describe, expect, it } from 'vitest';
import { exponentialTrend, fiveWeekForecast, linearTrend, movingAverage, weightOn } from '../src/forecast.js';

describe('forecast', () => {
  it('projects 35 days of the current balance', () => {
    const f = fiveWeekForecast({ currentWeightKg: 80, netKcal: 1700, maintenanceKcal: 2250 });
    expect(f.deltaKg).toBeCloseTo(-2.5);
    expect(f.kg).toBeCloseTo(77.5);
  });

  it('smooths with an exponential trend and bridges gaps', () => {
    const t = exponentialTrend([
      { date: '2026-10-01', kg: 80 },
      { date: '2026-10-02', kg: 81 },
      { date: '2026-10-12', kg: 81 },
    ]);
    expect(t[0]!.kg).toBe(80);
    expect(t[1]!.kg).toBeCloseTo(80.1);
    // 10 days gap → stronger pull towards the new value
    expect(t[2]!.kg).toBeGreaterThan(80.5);
  });

  it('computes a calendar-window moving average', () => {
    const ma = movingAverage(
      [
        { date: '2026-10-01', kg: 80 },
        { date: '2026-10-05', kg: 82 },
        { date: '2026-10-09', kg: 84 },
      ],
      7,
    );
    expect(ma.map((p) => p.kg)).toEqual([80, 81, 83]);
  });

  it('fits a linear trend', () => {
    const lt = linearTrend([
      { date: '2026-10-01', kg: 80 },
      { date: '2026-10-11', kg: 79 },
    ])!;
    expect(lt.slopePerDay).toBeCloseTo(-0.1);
    expect(linearTrend([{ date: '2026-10-01', kg: 80 }])).toBeNull();
  });

  it('finds the latest weight on or before a date', () => {
    const pts = [
      { date: '2026-10-01', kg: 80 },
      { date: '2026-10-05', kg: 79 },
    ];
    expect(weightOn(pts, '2026-10-04')).toBe(80);
    expect(weightOn(pts, '2026-10-09')).toBe(79);
    expect(weightOn(pts, '2026-09-01')).toBeUndefined();
  });
});
