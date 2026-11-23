import {
  addDays,
  dateRange,
  diffDays,
  expectedRange,
  forecastSpread,
  simulateForecast,
  type DayForecast,
  type ISODate,
  type WeightPoint,
} from '@ft/shared';

/** The expectation band is drawn this much wider on both sides (else calm weeks make a hairline). */
export const EXPECTED_MARGIN_KG = 0.1;

/** Days today's forecast reaches ahead: a week for the 7-day view, else two weeks. */
export function aheadDaysFor(periodDays: number): number {
  return periodDays <= 7 ? 7 : 14;
}

/** A value on the day axis: `i` counts days from the first day of the period. */
export interface DayValue {
  i: number;
  kg: number;
}

export interface ForecastChartModel {
  /** Every day from the first weigh-in of the period (or its first day) to today. */
  dates: ISODate[];
  aheadDays: number;
  weights: DayValue[];
  means: DayValue[];
  target: number | null;
  /** What the 14 days before each day forecast for it, per day of `dates`. */
  expected: ({ lo: number; hi: number } | null)[];
  /** Per day: the 7-day mean of the last weigh-in up to it. */
  meanOn: (number | null)[];
  /** Stable for the period (does not move while another day is chosen). */
  yRange: [number, number];
  byDate: ReadonlyMap<ISODate, DayForecast>;
}

export interface DayView {
  index: number;
  date: ISODate;
  forecast: DayForecast | null;
  /** The simulated course and its 80 % band, from the day to today (today: `aheadDays` ahead). */
  course: DayValue[];
  band: { i: number; lo: number; hi: number }[];
  /** The trend value at the end of the course, and that day. */
  prognosis: { kg: number; date: ISODate } | null;
}

/**
 * Everything the forecast chart draws that does not depend on the chosen day. Null while no day of
 * the period has a forecast (the page then shows the plain chart).
 */
export function forecastChartModel(params: {
  /** Weigh-ins of the period, ascending. */
  visible: readonly WeightPoint[];
  /** 7-day mean at every weigh-in (any dates). */
  avg: readonly WeightPoint[];
  target: number | null;
  from: ISODate;
  today: ISODate;
  /** Forecasts of the single days, also of the 14 days before `from`. */
  forecasts: readonly DayForecast[];
  aheadDays: number;
}): ForecastChartModel | null {
  const { today, target, aheadDays } = params;
  // The axis begins at the first weigh-in of the period: no empty stretch before the data.
  const first = params.visible[0]?.date;
  const from = first && first > params.from ? first : params.from;
  if (!params.forecasts.some((f) => f.date >= from && f.date <= today)) return null;
  const byDate = new Map(params.forecasts.map((f) => [f.date, f]));
  const dates = dateRange(from, today);
  const index = (d: ISODate) => diffDays(from, d);
  const avgByDate = new Map(params.avg.map((p) => [p.date, p.kg]));
  const weights = params.visible.map((w) => ({ i: index(w.date), kg: w.kg }));
  const means = params.visible.map((w) => ({ i: index(w.date), kg: avgByDate.get(w.date) ?? w.kg }));
  // The mean the line shows on a day: that of the last weigh-in up to it (also before the period).
  const meanOn: (number | null)[] = [];
  let last: number | null = null;
  const before = params.avg.filter((p) => p.date < from);
  if (before.length) last = before[before.length - 1]!.kg;
  const meanByIndex = new Map(means.map((m) => [m.i, m.kg]));
  dates.forEach((_, i) => {
    last = meanByIndex.get(i) ?? last;
    meanOn.push(last);
  });
  const expected = dates.map((d) => expectedRange(byDate, d));

  const values: number[] = [...weights.map((w) => w.kg), ...means.map((m) => m.kg)];
  if (target !== null) values.push(target);
  for (const e of expected) if (e) values.push(e.lo - EXPECTED_MARGIN_KG, e.hi + EXPECTED_MARGIN_KG);
  const now = byDate.get(today);
  if (now) {
    const spread = forecastSpread(now, aheadDays);
    const end = now.startKg + now.slopePerDay * aheadDays;
    values.push(end - spread, end + spread);
  }
  return {
    dates,
    aheadDays,
    weights,
    means,
    target,
    expected,
    meanOn,
    yRange: niceRange(values),
    byDate,
  };
}

/** The chosen day's forecast: course, band and the value at its end. */
export function dayView(model: ForecastChartModel, index: number): DayView {
  const i0 = Math.max(0, Math.min(model.dates.length - 1, index));
  const date = model.dates[i0]!;
  const f = model.byDate.get(date) ?? null;
  if (!f) return { index: i0, date, forecast: null, course: [], band: [], prognosis: null };
  const isToday = i0 === model.dates.length - 1;
  const days = isToday ? model.aheadDays : model.dates.length - 1 - i0;
  const course = simulateForecast(f, days).map((kg, h) => ({ i: i0 + h, kg }));
  const band = course.map((_, h) => {
    const mid = f.startKg + f.slopePerDay * h;
    const spread = forecastSpread(f, h);
    return { i: i0 + h, lo: mid - spread, hi: mid + spread };
  });
  return {
    index: i0,
    date,
    forecast: f,
    course,
    band,
    prognosis: { kg: f.startKg + f.slopePerDay * days, date: addDays(date, days) },
  };
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
