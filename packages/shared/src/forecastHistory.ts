/**
 * What the app would have forecast on each day of a period, computed only from the days and
 * weigh-ins up to that day: a straight line from the 7-day mean with the slope of the energy balance
 * (net intake against maintenance), the same reasoning as the "Tag abschließen" forecast but with
 * the average instead of a single day. Retrospective from today's records: nothing is stored.
 */
import { addDays, dateRange, diffDays, type ISODate } from './dates.js';
import { EXPENDITURE_WINDOW_DAYS, estimateExpenditure, netIntake } from './expenditure.js';
import { linearTrend, movingAverage, type WeightPoint } from './forecast.js';
import type { DailyRow } from './reports.js';
import type { Settings } from './schemas.js';
import { bodyProfile, KCAL_PER_KG_BODY_WEIGHT, tdee } from './tdee.js';

/** Complete days the formula basis needs in the intake window. */
export const FORECAST_MIN_DAYS = 7;
/** A day whose last weigh-in is older than this has no forecast. */
export const FORECAST_MAX_WEIGHT_AGE_DAYS = 14;

export interface DayForecast {
  /** The day the forecast was made on. */
  date: ISODate;
  /** 7-day mean on that day. */
  startKg: number;
  /** kg per day. */
  slopePerDay: number;
  maintenanceKcal: number;
  netKcal: number;
  basis: 'data' | 'formula';
  /**
   * Fluctuation of the smoothed real curve (the 7-day mean of the window minus its trend line): its
   * standard deviation (kg) and lag-1 autocorrelation. The simulated course follows them.
   */
  noiseSdKg: number;
  noisePhi: number;
  /** Standard error of the window's weight trend (kg per day): the band widens with it. */
  slopeSeKg: number;
}

/** Days before a day whose forecasts make up what was expected for it. */
export const EXPECTED_LOOKBACK_DAYS = 14;
/** z of the 80 % band around a forecast. */
const BAND_Z = 1.28;
const MAX_PHI = 0.95;

/** Spread and day-to-day likeness of the 7-day means around their own trend line. */
export function curveNoise(means: readonly WeightPoint[]): { sd: number; phi: number } {
  const trend = means.length >= 4 ? linearTrend(means) : null;
  if (!trend) return { sd: 0, phi: 0 };
  const res = means.map((p) => p.kg - (trend.intercept + trend.slopePerDay * diffDays(trend.origin, p.date)));
  const ss = res.reduce((s, r) => s + r * r, 0);
  if (ss === 0) return { sd: 0, phi: 0 };
  let lag = 0;
  for (let k = 1; k < res.length; k++) lag += res[k]! * res[k - 1]!;
  return { sd: Math.sqrt(ss / res.length), phi: Math.min(MAX_PHI, Math.max(0, lag / ss)) };
}

/** One forecast per day of [from, to] that has one, ascending; days without one are left out. */
export function forecastHistory(params: {
  /** Daily rows (contiguous) from at least `EXPENDITURE_WINDOW_DAYS - 1` days before `from` up to `to`. */
  rows: readonly DailyRow[];
  /** All live weigh-ins (any dates). */
  weights: readonly WeightPoint[];
  from: ISODate;
  to: ISODate;
  settings: Pick<Settings, 'sex' | 'birthDate' | 'heightCm' | 'activityLevel'> | undefined;
  creditExercise?: boolean;
  creditSteps?: boolean;
  /** Days of intake averaged for the slope (default `EXPENDITURE_WINDOW_DAYS`). */
  intakeDays?: number;
}): DayForecast[] {
  const intakeDays = params.intakeDays ?? EXPENDITURE_WINDOW_DAYS;
  const credit = { creditExercise: params.creditExercise, creditSteps: params.creditSteps };
  const weights = [...params.weights].sort((a, b) => a.date.localeCompare(b.date));
  // The trailing mean only looks back, so its value at a weigh-in never knows a later one.
  const means = movingAverage(weights, 7);
  const rowIndex = new Map(params.rows.map((r, i) => [r.date, i]));
  const out: DayForecast[] = [];
  let w = -1; // index of the last weigh-in on or before the day
  let w0 = 0; // index of the first weigh-in inside the day's window
  for (const day of dateRange(params.from, params.to)) {
    while (w + 1 < weights.length && weights[w + 1]!.date <= day) w++;
    const i = rowIndex.get(day);
    if (w < 0 || i === undefined) continue;
    const last = weights[w]!;
    if (diffDays(last.date, day) > FORECAST_MAX_WEIGHT_AGE_DAYS) continue;
    const window = params.rows.slice(Math.max(0, i + 1 - EXPENDITURE_WINDOW_DAYS), i + 1);
    while (w0 <= w && weights[w0]!.date < window[0]!.date) w0++;
    const intake = netIntake(window.slice(-intakeDays), { ...credit, today: day });
    if (intake.days === 0) continue;
    const netKcal = intake.intakeAvg - intake.exerciseAvg;
    // Only the weigh-ins of the window: none after `day` (and no filtering of all of them per day).
    const inWindow = weights.slice(w0, w + 1);
    const estimate = estimateExpenditure({ rows: window, weights: inWindow, ...credit, today: day }).value;
    let maintenanceKcal: number;
    let basis: DayForecast['basis'];
    if (estimate) {
      maintenanceKcal = estimate.kcal;
      basis = 'data';
    } else {
      const profile = params.settings ? bodyProfile(params.settings, last.kg, day) : null;
      if (!profile || intake.days < FORECAST_MIN_DAYS) continue;
      maintenanceKcal = Math.round(tdee(profile, params.settings!.activityLevel));
      basis = 'formula';
    }
    const slopePerDay = (netKcal - maintenanceKcal) / KCAL_PER_KG_BODY_WEIGHT;
    const startKg = means[w]!.kg;
    if (!Number.isFinite(slopePerDay) || !Number.isFinite(startKg)) continue;
    const noise = curveNoise(means.slice(w0, w + 1));
    const slopeSeKg = (inWindow.length > 2 ? linearTrend(inWindow)?.slopeSePerDay : 0) ?? 0;
    out.push({
      date: day,
      startKg,
      slopePerDay,
      maintenanceKcal,
      netKcal,
      basis,
      noiseSdKg: noise.sd,
      noisePhi: noise.phi,
      slopeSeKg,
    });
  }
  return out;
}

/** The forecast weight `days` after the forecast's own day. */
export function forecastAt(f: DayForecast, days: number): { date: ISODate; kg: number } {
  return { date: addDays(f.date, days), kg: f.startKg + f.slopePerDay * days };
}

/** Half the width of the 80 % band `days` after the forecast's day: fluctuation plus slope error. */
export function forecastSpread(f: DayForecast, days: number): number {
  return BAND_Z * Math.sqrt(f.noiseSdKg ** 2 + (f.slopeSeKg * days) ** 2);
}

/**
 * A plausible course of the 7-day mean for the days 0..`days` after the forecast's day: the trend
 * plus a random walk (AR(1)) with the fluctuation of the real curve. The date is the seed, so a
 * forecast always looks the same.
 */
export function simulateForecast(f: DayForecast, days: number): number[] {
  const rand = seeded(f.date);
  const sd = f.noiseSdKg * Math.sqrt(1 - f.noisePhi ** 2);
  const out = [f.startKg];
  let x = 0;
  for (let h = 1; h <= days; h++) {
    x = f.noisePhi * x + gauss(rand) * sd;
    out.push(f.startKg + f.slopePerDay * h + x);
  }
  return out;
}

/**
 * What was expected for a day: the range of what the forecasts of the `EXPECTED_LOOKBACK_DAYS` before it
 * forecast for it (trend values). `byDate` maps the forecasts by their day. Null without any.
 */
export function expectedRange(
  byDate: ReadonlyMap<ISODate, DayForecast>,
  date: ISODate,
): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 1; k <= EXPECTED_LOOKBACK_DAYS; k++) {
    const f = byDate.get(addDays(date, -k));
    if (!f) continue;
    const kg = f.startKg + f.slopePerDay * k;
    lo = Math.min(lo, kg);
    hi = Math.max(hi, kg);
  }
  return lo <= hi ? { lo, hi } : null;
}

/** xorshift32 seeded from a string. */
function seeded(key: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < key.length; i++) s = Math.imul(s ^ key.charCodeAt(i), 16777619);
  s = s >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Standard normal draw (Box-Muller). */
function gauss(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}
