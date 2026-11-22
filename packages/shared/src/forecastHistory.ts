/**
 * What the app would have forecast on each day of a period, computed only from the days and
 * weigh-ins up to that day: a straight line from the 7-day mean with the slope of the energy balance
 * (net intake against maintenance), the same reasoning as the "Tag abschließen" forecast but with
 * the average instead of a single day. Retrospective from today's records: nothing is stored.
 */
import { addDays, dateRange, diffDays, type ISODate } from './dates.js';
import { EXPENDITURE_WINDOW_DAYS, estimateExpenditure, netIntake } from './expenditure.js';
import { movingAverage, type WeightPoint } from './forecast.js';
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
    out.push({ date: day, startKg, slopePerDay, maintenanceKcal, netKcal, basis });
  }
  return out;
}

/** The forecast weight `days` after the forecast's own day. */
export function forecastAt(f: DayForecast, days: number): { date: ISODate; kg: number } {
  return { date: addDays(f.date, days), kg: f.startKg + f.slopePerDay * days };
}
