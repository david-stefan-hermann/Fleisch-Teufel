/**
 * Energy expenditure from the person's own data instead of a population formula: what was eaten
 * (complete days only) against how the weight trend moved. The idea is MacroFactor's; the math is
 * the plain energy balance:
 *
 *   intake − (base expenditure + training) = weight change × 7 700 kcal/kg
 *
 * `base` is the expenditure without the credited training, so it compares with `tdee(profile)`
 * (whose activity level is meant without workouts) and feeds the same forecast. Training that is
 * not credited on the budget stays in `base`, like the steps. Nothing here changes a
 * goal by itself: the app shows the number and may suggest a target; the person decides.
 */
import { diffDays, type ISODate } from './dates.js';
import { linearTrend, type WeightPoint } from './forecast.js';
import { creditedTrainingKcal } from './diary.js';
import { N } from './nutrients.js';
import { get, round } from './nutrition.js';
import { budgetAverage, isCompleteDay, weightTrend, type DailyRow } from './reports.js';
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
  /**
   * Daily expenditure without the credited training, kcal (rounded to 10). Training and steps that
   * are not credited on the budget belong to the everyday expenditure and stay in it.
   */
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
 * Why there is no estimate: `tooFew` while complete days or weigh-ins are missing, `implausible`
 * when there is enough data but the trend or the result cannot be energy balance.
 */
export type ExpenditureMissing = 'tooFew' | 'implausible';

export type ExpenditureResult =
  { value: ExpenditureEstimate; reason: null } | { value: null; reason: ExpenditureMissing };

const missing = (reason: ExpenditureMissing): ExpenditureResult => ({ value: null, reason });

/**
 * The estimate, or the reason why the data does not carry one: fewer complete days than
 * `EXPENDITURE_MIN_DAYS` in the last `EXPENDITURE_WINDOW_DAYS` rows or too few weigh-ins
 * (`tooFew`), or an implausible trend or result (`implausible`). `rows` are daily rows ending at
 * the day of interest (`dailyRows` with notes).
 */
export function estimateExpenditure(params: {
  rows: readonly DailyRow[];
  weights: readonly WeightPoint[];
  windowDays?: number;
  minDays?: number;
  /** Setting "Training aufs Ziel anrechnen" (default on). */
  creditExercise?: boolean;
  /** Setting "Schritte aufs Ziel anrechnen" (default on). */
  creditSteps?: boolean;
  /** The running day: it counts only once closed (`isCompleteDay`). */
  today?: ISODate;
}): ExpenditureResult {
  const windowDays = params.windowDays ?? EXPENDITURE_WINDOW_DAYS;
  const minDays = params.minDays ?? EXPENDITURE_MIN_DAYS;
  const window = params.rows.slice(-windowDays);
  if (window.length === 0) return missing('tooFew');
  const from = window[0]!.date;
  const to = window.at(-1)!.date;
  const complete = window.filter((r) => isCompleteDay(r, { today: params.today }));
  if (complete.length < minDays) return missing('tooFew');
  const weights = params.weights.filter((w) => w.date >= from && w.date <= to);
  if (weights.length < EXPENDITURE_MIN_WEIGH_INS) return missing('tooFew');
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  if (diffDays(sorted[0]!.date, sorted.at(-1)!.date) < EXPENDITURE_MIN_WEIGH_SPAN_DAYS)
    return missing('tooFew');
  const trend = linearTrend(sorted);
  if (!trend || Math.abs(trend.slopePerDay * 7) > MAX_WEEKLY_TREND_KG) return missing('implausible');
  const intakeAvg = complete.reduce((s, r) => s + get(r.nutrients, N.kcal), 0) / complete.length;
  // Only what is credited on the budget comes off: training and steps that are not credited belong
  // to the everyday movement the expenditure contains anyway (else a target from it would be too low).
  const credit = { exercise: params.creditExercise !== false, steps: params.creditSteps !== false };
  const exerciseAvg =
    complete.reduce((s, r) => s + creditedTrainingKcal(r.exerciseKcal, r.stepsKcal, credit), 0) /
    complete.length;
  const base = intakeAvg - exerciseAvg - trend.slopePerDay * KCAL_PER_KG_BODY_WEIGHT;
  if (!Number.isFinite(base) || base < PLAUSIBLE.min || base > PLAUSIBLE.max) return missing('implausible');
  return {
    reason: null,
    value: {
      kcal: Math.round(base / 10) * 10,
      days: complete.length,
      weighIns: weights.length,
      intakeAvg: Math.round(intakeAvg),
      exerciseAvg: Math.round(exerciseAvg),
      weeklyTrendKg: round(trend.slopePerDay * 7, 2),
      from,
      to,
      confidence: complete.length >= windowDays - 2 && weights.length >= 10 ? 'high' : 'medium',
    },
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
  /** "Trend": change of the linear weight trend over the week (`weightTrend`), null with fewer than two weigh-ins. */
  weightDeltaKg: number | null;
  weighIns: number;
}

/** The numbers of the Monday week card: seven daily rows (Monday to Sunday) and the weigh-ins of that week. */
export function weekSummary(
  rows: readonly DailyRow[],
  weights: readonly WeightPoint[],
  opts: { creditExercise?: boolean; creditSteps?: boolean; today?: ISODate } = {},
): WeekSummary {
  const from = rows[0]?.date ?? '';
  const to = rows.at(-1)?.date ?? from;
  const logged = rows.filter((r) => r.logged);
  const complete = logged.filter((r) => isCompleteDay(r, opts));
  const basis = complete.length > 0 ? complete : logged;
  const n = basis.length;
  const avg = (fn: (r: DailyRow) => number) =>
    n ? Math.round(basis.reduce((s, r) => s + fn(r), 0) / n) : null;
  const weighIns = weights.filter((w) => w.date >= from && w.date <= to);
  return {
    from,
    to,
    completeDays: complete.length,
    loggedDays: logged.length,
    avgKcal: avg((r) => get(r.nutrients, N.kcal)),
    avgBudgetKcal: budgetAverage(basis, opts),
    avgProteinG: avg((r) => get(r.nutrients, N.protein)),
    avgProteinTargetG: avg((r) => r.targetProteinG),
    weightDeltaKg: weightTrend(weights, from, to),
    weighIns: weighIns.length,
  };
}
