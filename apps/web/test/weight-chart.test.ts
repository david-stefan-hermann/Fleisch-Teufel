import type { DayForecast } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { weightChart } from '@/features/progress/weightChart';
import { xOf } from '@/lib/time';

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
  { date: '2026-11-02', kg: 81 },
  { date: '2026-11-05', kg: 80.5 },
];
const base = { visible, avg, target: 75, from: '2026-11-01', today: '2026-11-06' };
const forecasts = [
  fc('2026-10-30', 81.5),
  fc('2026-11-02', 81, -0.2),
  fc('2026-11-05'),
  fc('2026-11-06', 80.2, 0),
];

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
    expect(c.overlay).toBeUndefined();
    expect(c.legendIndex).toBeUndefined();
    expect(c.xRange).toEqual(['2026-11-01', '2026-11-06']);
    // Forecasts only from before the period (too little data inside it) change nothing.
    expect(weightChart({ ...base, forecasts: [fc('2026-10-30')] })).toEqual(c);
  });

  it('with forecasts: every day, today chosen, its course 14 days ahead', () => {
    const c = weightChart({ ...base, forecasts });
    expect(c.dates).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(c.series.map((s) => s.label)).toEqual([
      'Gewicht',
      '7-Tage-Mittel',
      'Ziel',
      'Gewicht danach',
      '7-Tage-Mittel danach',
      'Erwartet',
      'Prognose',
    ]);
    expect(c.legendIndex).toBe(5);
    expect(c.data[1]).toEqual([null, 81, null, null, 80, null]);
    expect(c.data[4]).toEqual([null, null, null, null, null, null]);
    expect(c.xRange).toEqual(['2026-11-01', '2026-11-20']);
    // Today's course: 15 days from today, flat (no slope, no fluctuation), in its band.
    const line = c.overlay!.lines![0]!;
    expect(line.points).toHaveLength(15);
    expect(line.points.at(-1)).toEqual({ x: '2026-11-20', y: 80.2 });
    expect(c.overlay!.marker).toEqual({ x: '2026-11-06', y: 80.2, color: '--primary' });
    const prognose = c.series.at(-1)!;
    expect(prognose.format!(80.2, 5)).toBe('80,2 kg für 20. Nov.');
    expect(prognose.format!(79.9, 4)).toBe('79,9 kg für heute');
  });

  it('a chosen day fades what came after it and forecasts up to today', () => {
    const c = weightChart({ ...base, forecasts, selected: '2026-11-02' });
    expect(c.legendIndex).toBe(1);
    expect(c.data[1]).toEqual([null, 81, null, null, null, null]);
    expect(c.data[4]).toEqual([null, null, null, null, 80, null]);
    // The faded mean begins at the chosen day's mean, so the line goes on without a gap.
    expect(c.data[5]).toEqual([null, 81, null, null, 80.5, null]);
    const line = c.overlay!.lines![0]!;
    expect(line.points[0]).toEqual({ x: '2026-11-02', y: 81 });
    expect(line.points.at(-1)!.x).toBe('2026-11-06');
    expect(line.points.at(-1)!.y).toBeCloseTo(80.2, 9);
    // Prognose of the chosen day: for today.
    expect(c.data[7]![1]).toBe(80.2);
  });

  it('expects for a day what the 14 days before it forecast', () => {
    const c = weightChart({ ...base, forecasts });
    // 4 Nov: from 30 Oct (81,5 − 0,5) and 2 Nov (81 − 0,4).
    const erwartet = c.series.find((s) => s.label === 'Erwartet')!;
    expect(c.data[6]![3]).toBe(80.6);
    expect(erwartet.format!(80.6, 3)).toBe('80,6 bis 81 kg');
    // 1 Nov has only the forecast of 30 Oct: 81,5 − 0,2.
    expect(erwartet.format!(81.3, 0)).toBe('81,3 bis 81,3 kg');
    expect(c.overlay!.bands![0]!.points[0]!.x).toBe('2026-11-01');
  });
});
