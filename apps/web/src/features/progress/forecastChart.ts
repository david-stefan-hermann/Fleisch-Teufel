import {
  addDays,
  BAND_Z,
  dateRange,
  diffDays,
  type Calibration,
  type ForecastPoint,
  type ISODate,
  type ModelDay,
  type WeightModel,
} from '@ft/shared';

/** Days today's forecast reaches ahead: a week for the 7-day view, else two weeks. */
export function aheadDaysFor(periodDays: number): number {
  return periodDays <= 7 ? 7 : 14;
}

/** A value on the day axis: `i` counts days from the first day of the chart. */
export interface DayValue {
  i: number;
  kg: number;
}

export interface ForecastChartModel {
  /** Every day from the first day of the period the model covers to today. */
  dates: ISODate[];
  aheadDays: number;
  weights: DayValue[];
  /** The filtered level per day of `dates`. */
  level: DayValue[];
  /** Logged net kcal of complete days. */
  kcal: { i: number; kcal: number }[];
  /** Learned maintenance per day of `dates`. */
  maintenance: { i: number; kcal: number }[];
  /** First index that can be chosen (the first day with a forecast). */
  firstChoice: number;
  /** Stable for the period (does not move while another day is chosen). */
  yRange: [number, number];
  kcalRange: [number, number];
  calibration: Calibration;
  trendCalibration: Calibration | null;
  models: { kcal: WeightModel; trend: WeightModel | null };
}

export interface CurvePoint extends ForecastPoint {
  i: number;
}

export interface DayView {
  index: number;
  date: ISODate;
  /** Forecast of the chosen day up to the right edge; empty when the day has none. */
  curve: CurvePoint[];
  /** The same without calories. */
  trend: CurvePoint[];
  weighed: number | null;
  level: number | null;
  maintenance: number | null;
  eating: { mean: number; sd: number } | null;
  /** At the right edge: the level, its 80 % band and the 80 % band of a weigh-in. */
  end: { date: ISODate; level: number; curve: [number, number]; weighIn: [number, number] } | null;
  trendEnd: number | null;
}

/**
 * Everything the forecast chart draws that does not depend on the chosen day. Null while no day of the
 * period has a forecast (the page then says so).
 */
export function forecastChartModel(params: {
  models: { kcal: WeightModel; trend: WeightModel | null } | null;
  days: readonly ModelDay[];
  from: ISODate;
  today: ISODate;
  aheadDays: number;
}): ForecastChartModel | null {
  const { models, today, aheadDays } = params;
  if (!models) return null;
  const m = models.kcal;
  const from = m.dates[0]! > params.from ? m.dates[0]! : params.from;
  if (from > today) return null;
  const dates = dateRange(from, today);
  let firstChoice = -1;
  for (let i = 0; i < dates.length && firstChoice < 0; i++) if (m.forecast(dates[i]!, 0)) firstChoice = i;
  if (firstChoice < 0) return null;
  const index = (d: ISODate) => diffDays(from, d);
  const at = (d: ISODate) => diffDays(m.dates[0]!, d);
  const days = params.days.filter((d) => d.date >= from && d.date <= today);
  const weights = days.flatMap((d) => (d.kg === null ? [] : [{ i: index(d.date), kg: d.kg }]));
  const level = dates.map((d, i) => ({ i, kg: m.level[at(d)]! }));
  const maintenance = dates.map((d, i) => ({ i, kcal: m.b[at(d)]! }));
  const kcal = days.flatMap((d) => (d.kcal === null ? [] : [{ i: index(d.date), kcal: d.kcal }]));

  const values = [...weights.map((w) => w.kg), ...level.map((l) => l.kg)];
  const now = m.forecast(today, aheadDays);
  const factor = m.calibration.factor;
  for (const p of now ?? []) values.push(p.level - weighInHalf(p, factor), p.level + weighInHalf(p, factor));
  const kv = [...kcal.map((k) => k.kcal), ...maintenance.map((k) => k.kcal)];
  const eat = m.eatingAt(today);
  if (eat) kv.push(eat.mean);
  return {
    dates,
    aheadDays,
    weights,
    level,
    kcal,
    maintenance,
    firstChoice,
    yRange: niceRange(values),
    kcalRange: [
      Math.floor((Math.min(...kv) - 100) / 500) * 500,
      Math.ceil((Math.max(...kv) + 100) / 500) * 500,
    ],
    calibration: m.calibration,
    trendCalibration: models.trend?.calibration ?? null,
    models,
  };
}

/** The chosen day: its forecast up to the right edge (today plus `aheadDays`) and the legend values. */
export function dayView(model: ForecastChartModel, index: number): DayView {
  const last = model.dates.length - 1;
  const i0 = Math.max(model.firstChoice, Math.min(last, index));
  const date = model.dates[i0]!;
  const days = last + model.aheadDays - i0;
  const withI = (pts: ForecastPoint[] | null) => (pts ?? []).map((p, k) => ({ ...p, i: i0 + k }));
  const curve = withI(model.models.kcal.forecast(date, days));
  const trend = withI(model.models.trend?.forecast(date, days) ?? null);
  const e = curve.at(-1);
  const f = model.calibration.factor;
  return {
    index: i0,
    date,
    curve,
    trend,
    weighed: model.weights.find((w) => w.i === i0)?.kg ?? null,
    level: model.level[i0]?.kg ?? null,
    maintenance: curve.length ? model.maintenance[i0]!.kcal : null,
    eating: model.models.kcal.eatingAt(date),
    end: e
      ? {
          date: addDays(date, days),
          level: e.level,
          curve: [e.level - BAND_Z * e.levelSd, e.level + BAND_Z * e.levelSd],
          weighIn: [e.level - weighInHalf(e, f), e.level + weighInHalf(e, f)],
        }
      : null,
    trendEnd: trend.at(-1)?.level ?? null,
  };
}

/**
 * Half width of the 80 % band of a weigh-in: the calibrated factor on its spread, never narrower than the band
 * of the level (a single weigh-in is never surer than the level it scatters around).
 */
export function weighInHalf(p: Pick<ForecastPoint, 'levelSd' | 'obsSd'>, factor: number): number {
  return Math.max(factor * p.obsSd, BAND_Z * p.levelSd);
}

/** Rounded outward with a little air, at least 1 kg high. */
export function niceRange(values: readonly number[]): [number, number] {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (!Number.isFinite(lo)) return [0, 1];
  const pad = Math.max((hi - lo) * 0.08, 0.2);
  lo -= pad;
  hi += pad;
  if (hi - lo < 1) {
    const mid = (lo + hi) / 2;
    lo = mid - 0.5;
    hi = mid + 0.5;
  }
  const step = tickStep(hi - lo);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** Grid step for a kg span: about four lines. */
export function tickStep(span: number): number {
  return span > 8 ? 2 : span > 3 ? 1 : 0.5;
}

/** A smooth curve through the points (Catmull-Rom as cubic Bézier segments), not connected dots. */
export function curvePath(points: readonly (readonly [number, number])[]): string {
  const P = points;
  if (P.length === 0) return '';
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(P[0]![0])},${f(P[0]![1])}`;
  if (P.length < 3)
    return (
      d +
      P.slice(1)
        .map((p) => `L${f(p[0])},${f(p[1])}`)
        .join('')
    );
  for (let k = 0; k < P.length - 1; k++) {
    const p0 = P[k - 1] ?? P[k]!;
    const p1 = P[k]!;
    const p2 = P[k + 1]!;
    const p3 = P[k + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6] as const;
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6] as const;
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}
