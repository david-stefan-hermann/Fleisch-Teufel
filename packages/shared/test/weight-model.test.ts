import { describe, expect, it } from 'vitest';
import { addDays, dateRange } from '../src/dates.js';
import { N } from '../src/nutrients.js';
import type { DailyRow } from '../src/reports.js';
import { KCAL_PER_KG_BODY_WEIGHT } from '../src/tdee.js';
import {
  BAND_Z,
  buildWeightModel,
  CHECK_DAYS,
  FIRST_FORECAST_DAYS,
  modelDays,
  type ModelDay,
  type ModelParams,
} from '../src/weightModel.js';

const START = '2026-06-01';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

/** Truth: weight follows (eaten − expenditure) / 7 700; the scale adds water. Everything logged and weighed. */
function simulate(opts: {
  days: number;
  expenditure: number;
  eat: number;
  start?: number;
  seed?: number;
  water?: number;
  logged?: (i: number) => boolean;
  weighed?: (i: number) => boolean;
}): { days: ModelDay[]; truth: number[] } {
  const r = rng(opts.seed ?? 5);
  const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
  let truth = opts.start ?? 80;
  const out: ModelDay[] = [];
  const truths: number[] = [];
  for (let i = 0; i < opts.days; i++) {
    const eat = opts.eat + g() * 250;
    out.push({
      date: addDays(START, i),
      kg: (opts.weighed?.(i) ?? true) ? Math.round((truth + g() * (opts.water ?? 0.3)) * 10) / 10 : null,
      kcal: (opts.logged?.(i) ?? true) ? eat : null,
    });
    truths.push(truth);
    truth += (eat - opts.expenditure) / KCAL_PER_KG_BODY_WEIGHT;
  }
  return { days: out, truth: truths };
}

const FIXED: ModelParams = { obs: 0.3, ql: 0.02, qb: 5, qg: 0.005 };

describe('buildWeightModel', () => {
  it('learns the maintenance from calories and weigh-ins', () => {
    const { days } = simulate({ days: 150, expenditure: 2500, eat: 2000 });
    const m = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2800 })!;
    expect(m.b.at(-1)!).toBeGreaterThan(2350);
    expect(m.b.at(-1)!).toBeLessThan(2650);
  });

  it('forecasts the level with the eating of the days before', () => {
    const { days, truth } = simulate({ days: 120, expenditure: 2400, eat: 2000, water: 0.2 });
    const m = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2400 })!;
    const d = days[90]!.date;
    const fc = m.forecast(d, 14)!;
    expect(fc).toHaveLength(15);
    expect(fc[0]!.date).toBe(d);
    expect(fc[14]!.date).toBe(addDays(d, 14));
    // About 400 kcal a day under the expenditure: 0,7 kg in two weeks.
    expect(fc[0]!.level - fc[14]!.level).toBeGreaterThan(0.4);
    expect(fc[0]!.level - fc[14]!.level).toBeLessThan(1.1);
    expect(Math.abs(fc[14]!.level - truth[104]!)).toBeLessThan(0.6);
    // The band grows with the distance.
    expect(fc[14]!.levelSd).toBeGreaterThan(fc[1]!.levelSd);
    expect(fc[14]!.obsSd).toBeGreaterThan(fc[14]!.levelSd);
  });

  it('uses only the data up to the forecast day (with fixed parameters)', () => {
    const { days } = simulate({ days: 80, expenditure: 2400, eat: 2100 });
    const changed = days.map((d, i) =>
      i > 50 ? { ...d, kg: d.kg === null ? null : d.kg + 3, kcal: 4000 } : d,
    );
    const a = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2400, params: FIXED })!;
    const b = buildWeightModel({ days: changed, mode: 'kcal', startMaintenance: 2400, params: FIXED })!;
    expect(b.forecast(days[50]!.date, 14)).toEqual(a.forecast(days[50]!.date, 14));
    expect(b.forecast(days[60]!.date, 14)![0]!.level).not.toBeCloseTo(
      a.forecast(days[60]!.date, 14)![0]!.level,
      1,
    );
  });

  it('smooths the drawn curve with the neighbouring days', () => {
    const { days } = simulate({ days: 60, expenditure: 2400, eat: 2100 });
    const m = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2400, params: FIXED })!;
    const fc = m.forecast(days[40]!.date, 10)!;
    expect(fc[5]!.show).toBeCloseTo(0.25 * fc[4]!.kg + 0.5 * fc[5]!.kg + 0.25 * fc[6]!.kg, 10);
    expect(fc[0]!.show).toBeCloseTo(0.75 * fc[0]!.kg + 0.25 * fc[1]!.kg, 10);
  });

  it('makes no forecast before three weeks of data or after two weeks without a weigh-in', () => {
    const { days } = simulate({ days: 60, expenditure: 2400, eat: 2100, weighed: (i) => i < 35 });
    const m = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2400, params: FIXED })!;
    expect(m.firstForecast).toBe(addDays(START, FIRST_FORECAST_DAYS));
    expect(m.forecast(addDays(START, FIRST_FORECAST_DAYS - 1), 7)).toBeNull();
    expect(m.forecast(addDays(START, FIRST_FORECAST_DAYS), 7)).not.toBeNull();
    expect(m.forecast(addDays(START, 34 + 14), 7)).not.toBeNull();
    expect(m.forecast(addDays(START, 34 + 15), 7)).toBeNull();
  });

  it('fills a forgotten day with the own average, but not a long gap', () => {
    // Exactly 2 000 kcal logged, maintenance pinned (no drift): a forgotten day moves the level like a logged one.
    const days: ModelDay[] = dateRange(START, addDays(START, 39)).map((date, i) => ({
      date,
      kg: i < 30 ? 80 : null,
      kcal: i === 32 || (i >= 34 && i <= 37) ? null : 2000,
    }));
    const p: ModelParams = { obs: 0.3, ql: 0.01, qb: 0, qg: 0 };
    const m = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2700, params: p })!;
    const per = (m.b[30]! - 2000) / KCAL_PER_KG_BODY_WEIGHT;
    // Day 32 forgotten: same drop as a logged day.
    expect(m.level[33]! - m.level[32]!).toBeCloseTo(-per, 4);
    // Days 34 to 37: a gap, the level stays.
    expect(m.level[36]!).toBeCloseTo(m.level[35]!, 6);
  });

  it('back-tests the band and calibrates it', () => {
    const { days } = simulate({ days: 150, expenditure: 2400, eat: 2100, water: 0.4 });
    const m = buildWeightModel({ days, mode: 'kcal', startMaintenance: 2600 })!;
    const c = m.calibration;
    expect(c.checks).toBeGreaterThan(500);
    expect(c.coverByDays).toHaveLength(CHECK_DAYS + 1);
    expect(c.coverByDays[0]).toBeNull();
    const all = c.coverByDays.slice(1) as number[];
    expect(all.reduce((a, b) => a + b, 0) / all.length).toBeGreaterThan(0.7);
    expect(c.factor).toBeGreaterThan(0.8);
    expect(c.factor).toBeLessThan(2.5);
  });

  it('uses 1.28 when there is little to check', () => {
    const { days } = simulate({ days: 25, expenditure: 2400, eat: 2100 });
    const m = buildWeightModel({ days, mode: 'kcal', params: FIXED })!;
    expect(m.calibration.factor).toBe(BAND_Z);
  });

  it('without calories follows the weight trend', () => {
    const { days } = simulate({ days: 120, expenditure: 2500, eat: 2000, water: 0.2 });
    const m = buildWeightModel({ days, mode: 'trend' })!;
    const fc = m.forecast(days[100]!.date, 14)!;
    expect(fc[0]!.level - fc[14]!.level).toBeGreaterThan(0.3);
    expect(m.b[100]!).toBeLessThan(0);
  });

  it('needs two weigh-ins', () => {
    expect(buildWeightModel({ days: [{ date: START, kg: 80, kcal: 2000 }], mode: 'kcal' })).toBeNull();
  });
});

describe('modelDays', () => {
  const row = (date: string, kcal: number, over: Partial<DailyRow> = {}): DailyRow => ({
    date,
    logged: true,
    mealsLogged: 3,
    completed: false,
    nutrients: { [N.kcal]: kcal },
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

  it('takes net kcal of complete days and the mean weigh-in of a day', () => {
    const days = modelDays({
      rows: [
        row('2026-06-01', 2200, { exerciseKcal: 300, stepsKcal: 100 }),
        row('2026-06-02', 900, { mealsLogged: 1 }),
        row('2026-06-03', 1500),
      ],
      weights: [
        { date: '2026-06-01', kg: 80 },
        { date: '2026-06-01', kg: 81 },
        { date: '2026-06-03', kg: 79 },
      ],
      from: '2026-06-01',
      to: '2026-06-03',
      credit: { exercise: true, steps: false },
    });
    expect(days).toEqual([
      { date: '2026-06-01', kg: 80.5, kcal: 2000 },
      { date: '2026-06-02', kg: null, kcal: null },
      // The running day counts only once closed.
      { date: '2026-06-03', kg: 79, kcal: null },
    ]);
  });
});
