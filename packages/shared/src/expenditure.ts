/**
 * Energy expenditure from the person's own data instead of a population formula: what was eaten
 * (complete days only) against how the weight trend moved. The idea is MacroFactor's; the math is
 * the plain energy balance:
 *
 *   intake − (base expenditure + training) = weight change × 7 700 kcal/kg
 *
 * `base` is the expenditure without logged training, so it compares with `tdee(profile)` (whose
 * activity level is meant without workouts) and feeds the same forecast. Nothing here changes a
 * goal by itself: the app shows the number and may suggest a target; the person decides.
 */
import { diffDays, type ISODate } from './dates.js';
import { linearTrend, type WeightPoint } from './forecast.js';
import { N } from './nutrients.js';
import { get, round } from './nutrition.js';
import { isCompleteDay, type DailyRow } from './reports.js';
import { dailyDeltaForWeeklyRate, KCAL_PER_KG_BODY_WEIGHT, MIN_KCAL, type Sex } from './tdee.js';

/** Days of diary considered (the last three weeks, like MacroFactor's window). */
export const EXPENDITURE_WINDOW_DAYS = 21;
/** Complete days needed before an estimate is shown at all. */
export const EXPENDITURE_MIN_DAYS = 14;
/** Weigh-ins needed inside the window, and the days the first and last must span. */
export const EXPENDITURE_MIN_WEIGH_INS = 4;
export const EXPENDITURE_MIN_WEIGH_SPAN_DAYS = 10;
/** Outside this range the inputs are not believable (a missed week of logging, a wrong weight). */
const PLAUSIBLE = { min: 800, max: 6000 };
/** A trend steeper than this is water or a wrong weigh-in, not energy balance. */
const MAX_WEEKLY_TREND_KG = 2;

export interface ExpenditureEstimate {
  /** Daily expenditure without logged training, kcal (rounded to 10). */
  kcal: number;
  /** Complete days that went in. */
  days: number;
  weighIns: number;
  /** Average intake and credited training per complete day. */
  intakeAvg: number;
  exerciseAvg: number;
  /** Weight change per week from the linear trend of the window's weigh-ins (kg, negative = losing). */
  weeklyTrendKg: number;
  from: ISODate;
  to: ISODate;
  /** `high` with the full window and daily weigh-ins, else `medium`. */
  confidence: 'medium' | 'high';
}

/**
 * The estimate, or null while the data does not carry one: fewer complete days than
 * `EXPENDITURE_MIN_DAYS` in the last `EXPENDITURE_WINDOW_DAYS` rows, too few weigh-ins, or an
 * implausible result. `rows` are daily rows ending at the day of interest (`dailyRows` with notes).
 */
export function estimateExpenditure(params: {
  rows: readonly DailyRow[];
  weights: readonly WeightPoint[];
  windowDays?: number;
  minDays?: number;
}): ExpenditureEstimate | null {
  const windowDays = params.windowDays ?? EXPENDITURE_WINDOW_DAYS;
  const minDays = params.minDays ?? EXPENDITURE_MIN_DAYS;
  const window = params.rows.slice(-windowDays);
  if (window.length === 0) return null;
  const from = window[0]!.date;
  const to = window.at(-1)!.date;
  const complete = window.filter(isCompleteDay);
  if (complete.length < minDays) return null;
  const weights = params.weights.filter((w) => w.date >= from && w.date <= to);
  if (weights.length < EXPENDITURE_MIN_WEIGH_INS) return null;
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (diffDays(sorted[0]!.date, sorted.at(-1)!.date) < EXPENDITURE_MIN_WEIGH_SPAN_DAYS) return null;
  const trend = linearTrend(sorted);
  if (!trend || Math.abs(trend.slopePerDay * 7) > MAX_WEEKLY_TREND_KG) return null;
  const intakeAvg = complete.reduce((s, r) => s + get(r.nutrients, N.kcal), 0) / complete.length;
  const exerciseAvg = complete.reduce((s, r) => s + r.exerciseKcal, 0) / complete.length;
  const base = intakeAvg - exerciseAvg - trend.slopePerDay * KCAL_PER_KG_BODY_WEIGHT;
  if (!Number.isFinite(base) || base < PLAUSIBLE.min || base > PLAUSIBLE.max) return null;
  return {
    kcal: Math.round(base / 10) * 10,
    days: complete.length,
    weighIns: weights.length,
    intakeAvg: Math.round(intakeAvg),
    exerciseAvg: Math.round(exerciseAvg),
    weeklyTrendKg: round(trend.slopePerDay * 7, 2),
    from,
    to,
    confidence: complete.length >= windowDays - 2 && weights.length >= 10 ? 'high' : 'medium',
  };
}

/**
 * A daily kcal target from an expenditure and the chosen weekly rate, never below the safety
 * minimum (like `calorieGoal`), rounded to 10.
 */
export function targetFromExpenditure(
  expenditureKcal: number,
  weeklyRateKg: number,
  sex: Sex | null,
): number {
  const raw = expenditureKcal + dailyDeltaForWeeklyRate(weeklyRateKg);
  const min = sex ? MIN_KCAL[sex] : 1350;
  return Math.round(Math.max(raw, min) / 10) * 10;
}

export interface WeekSummary {
  from: ISODate;
  to: ISODate;
  /** Complete days of the week (see `isCompleteDay`). */
  completeDays: number;
  loggedDays: number;
  /** Over complete days (or logged days when none is complete); null without any. */
  avgKcal: number | null;
  avgBudgetKcal: number | null;
  avgProteinG: number | null;
  avgProteinTargetG: number | null;
  /** Change of the linear weight trend over the week (kg), null with fewer than two weigh-ins. */
  weightDeltaKg: number | null;
  weighIns: number;
}

/** The numbers of the Monday week card: seven daily rows (Monday to Sunday) and the weigh-ins of that week. */
export function weekSummary(
  rows: readonly DailyRow[],
  weights: readonly WeightPoint[],
  opts: { creditExercise?: boolean } = {},
): WeekSummary {
  const credit = opts.creditExercise ?? true;
  const from = rows[0]?.date ?? '';
  const to = rows.at(-1)?.date ?? from;
  const logged = rows.filter((r) => r.logged);
  const complete = logged.filter(isCompleteDay);
  const basis = complete.length > 0 ? complete : logged;
  const n = basis.length;
  const avg = (fn: (r: DailyRow) => number) =>
    n ? Math.round(basis.reduce((s, r) => s + fn(r), 0) / n) : null;
  const weighIns = weights.filter((w) => w.date >= from && w.date <= to);
  const trend = linearTrend(weighIns);
  const span = weighIns.length >= 2 ? diffDays(weighIns[0]!.date, weighIns.at(-1)!.date) : 0;
  return {
    from,
    to,
    completeDays: complete.length,
    loggedDays: logged.length,
    avgKcal: avg((r) => get(r.nutrients, N.kcal)),
    avgBudgetKcal: avg((r) => r.targetKcal + (credit ? r.exerciseKcal : 0)),
    avgProteinG: avg((r) => get(r.nutrients, N.protein)),
    avgProteinTargetG: avg((r) => r.targetProteinG),
    weightDeltaKg: trend && span > 0 ? round(trend.slopePerDay * span, 2) : null,
    weighIns: weighIns.length,
  };
}
