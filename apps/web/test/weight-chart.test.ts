import type { DayForecast } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { thinForecasts, weightChart } from '@/features/progress/weightChart';
import { xOf } from '@/lib/time';

const fc = (date: string, startKg = 80, slopePerDay = -0.1): DayForecast => ({
  date,
  startKg,
  slopePerDay,
  maintenanceKcal: 2500,
  netKcal: 1730,
  basis: 'data',
});

const visible = [
  { date: '2026-11-02', kg: 81 },
  { date: '2026-11-05', kg: 80 },
];
const avg = [
  { date: '2026-11-02', kg: 81 },
  { date: '2026-11-05', kg: 80.5 },
];
const base = { visible, avg, target: 75, from: '2026-11-01', today: '2026-11-06', horizon: 14 };

describe('weight chart data', () => {
  it('shows only the weigh-in days without forecasts', () => {
    const c = weightChart(base);
    expect(c.data[0]).toEqual([xOf('2026-11-02'), xOf('2026-11-05')]);
    expect(c.data.slice(1)).toEqual([
      [81, 80],
      [81, 80.5],
      [75, 75],
    ]);
    expect(c.series.map((s) => s.label)).toEqual(['Gewicht', '7-Tage-Mittel', 'Ziel']);
    expect(c.rays).toBeUndefined();
    expect(c.xRange).toEqual(['2026-11-01', '2026-11-06']);
    // An empty forecast list (too little data) changes nothing.
    expect(weightChart({ ...base, forecasts: [] })).toEqual(c);
  });

  it('with forecasts: every day, a ray per forecast, a legend value and a longer x range', () => {
    const c = weightChart({ ...base, forecasts: [fc('2026-11-05'), fc('2026-11-06', 80.2, 0)] });
    expect(c.data[0]).toHaveLength(6);
    expect(c.data[1]).toEqual([null, 81, null, null, 80, null]);
    expect(c.data[2]).toEqual([null, 81, null, null, 80.5, null]);
    expect(c.data[3]).toEqual([75, 75, 75, 75, 75, 75]);
    expect(c.series.at(-1)).toMatchObject({ label: 'Prognose +14 T', kind: 'legend' });
    expect(c.data[4]).toEqual([null, null, null, null, 78.6, 80.2]);
    expect(c.rays).toMatchObject([
      { from: '2026-11-05', to: '2026-11-19', y0: 80 },
      { from: '2026-11-06', to: '2026-11-20', y0: 80.2, y1: 80.2 },
    ]);
    expect(c.rays![0]!.y1).toBeCloseTo(78.6, 9);
    expect(c.xRange).toEqual(['2026-11-01', '2026-11-20']);
  });

  it('thins out to at most the maximum, keeping the newest', () => {
    const list = Array.from({ length: 250 }, (_, i) => fc(`d${String(i).padStart(3, '0')}`));
    const thin = thinForecasts(list, 120);
    expect(thin.length).toBeLessThanOrEqual(120);
    expect(thin.at(-1)).toBe(list.at(-1));
    expect(thinForecasts(list.slice(0, 50), 120)).toHaveLength(50);
  });
});
