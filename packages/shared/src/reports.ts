import { dateRange, diffDays, type ISODate } from './dates.js';
import { creditedTrainingKcal } from './diary.js';
import { isStepsEntry } from './exercise.js';
import { linearTrend, type WeightPoint } from './forecast.js';
import { targetsForDate } from './goals.js';
import { N, type NutrientMap } from './nutrients.js';
import { get, multiplyNutrients, round, sumNutrients } from './nutrition.js';
import type { DayNote, DayTarget, ExerciseEntry, FoodEntry, Goal, WeightEntry } from './schemas.js';

/**
 * A day counts as fully logged when it was closed ("Tag abschließen") or at least this many meals
 * have entries. Days with a single logged meal are most likely half days (the dinner never made it
 * in): they would pull every average down and make a data-based expenditure estimate worthless.
 */
export const MIN_MEALS_COMPLETE = 2;

export interface DailyRow {
  date: ISODate;
  logged: boolean;
  /** Distinct meals (diary meal indexes) with at least one entry. */
  mealsLogged: number;
  /** The day was closed with "Tag abschließen". */
  completed: boolean;
  nutrients: NutrientMap;
  targetKcal: number;
  targetProteinG: number;
  targetFatG: number;
  targetCarbsG: number;
  /** All trainings of the day, steps included. */
  exerciseKcal: number;
  /** The steps' part of `exerciseKcal`. */
  stepsKcal: number;
  /** Minutes of the trainings without the steps (walking all day is no "Trainingszeit"). */
  exerciseMinutes: number;
  /** Steps and walking distance (m) from Apple Health, null on days without. */
  steps: number | null;
  distanceM: number | null;
  weightKg: number | null;
}

/** One row per calendar day in [from, to] (days without entries included, `logged: false`). */
export function dailyRows(params: {
  from: ISODate;
  to: ISODate;
  entries: readonly FoodEntry[];
  exercises: readonly ExerciseEntry[];
  weights: readonly WeightEntry[];
  goals: readonly Goal[];
  /** Day notes carry "Tag abschließen" (`completedAt`); optional for callers without them. */
  notes?: readonly DayNote[];
}): DailyRow[] {
  const completed = new Set<ISODate>();
  for (const n of params.notes ?? []) if (!n.deleted && n.completedAt) completed.add(n.date);
  const byDate = new Map<ISODate, FoodEntry[]>();
  for (const e of params.entries) {
    if (e.deleted || e.date < params.from || e.date > params.to) continue;
    (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  }
  const exByDate = new Map<ISODate, ExerciseEntry[]>();
  for (const e of params.exercises) {
    if (e.deleted || e.date < params.from || e.date > params.to) continue;
    (exByDate.get(e.date) ?? exByDate.set(e.date, []).get(e.date)!).push(e);
  }
  const wByDate = new Map<ISODate, number>();
  for (const w of params.weights) if (!w.deleted) wByDate.set(w.date, w.kg);

  return dateRange(params.from, params.to).map((date) => {
    const es = byDate.get(date) ?? [];
    const xs = exByDate.get(date) ?? [];
    const t = targetsForDate(params.goals, date);
    const walk = xs.find(isStepsEntry);
    return {
      date,
      logged: es.length > 0,
      mealsLogged: new Set(es.map((e) => e.meal)).size,
      completed: completed.has(date),
      nutrients: sumNutrients(es.map((e) => e.nutrients)),
      targetKcal: t.kcal,
      targetProteinG: t.proteinG,
      targetFatG: t.fatG,
      targetCarbsG: t.carbsG,
      exerciseKcal: round(
        xs.reduce((s, x) => s + x.kcal, 0),
        0,
      ),
      stepsKcal: walk ? round(walk.kcal, 0) : 0,
      exerciseMinutes: xs.reduce((s, x) => s + (isStepsEntry(x) ? 0 : x.minutes), 0),
      steps: walk?.steps ?? null,
      distanceM: walk?.distanceM ?? null,
      weightKg: wByDate.get(date) ?? null,
    };
  });
}

/**
 * Whether a day's entries can be taken as the whole day (see `MIN_MEALS_COMPLETE`). The running day
 * (`today`) counts only once it was closed: at noon two meals are no whole day yet.
 */
export function isCompleteDay(
  r: Pick<DailyRow, 'date' | 'logged' | 'mealsLogged' | 'completed'>,
  opts: { today?: ISODate } = {},
): boolean {
  if (!r.logged) return false;
  if (r.completed) return true;
  return r.date !== opts.today && r.mealsLogged >= MIN_MEALS_COMPLETE;
}

export interface PeriodStats {
  days: number;
  /** Days with at least one entry. */
  loggedDays: number;
  /** Days taken as fully logged (`isCompleteDay`): the averages and target counts use these. */
  completeDays: number;
  /** `complete`: averages over complete days; `logged`: no complete day in the period, so over all logged days. */
  basis: 'complete' | 'logged';
  /** Averages over the days of `basis` (unlogged days would distort them towards 0). */
  avg: {
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
    sugar: number;
    satFat: number;
    salt: number;
  };
  /** Average day budget ("Budget Ø": target plus credited training, `budgetAverage`) over the days of `basis`. */
  avgBudgetKcal: number;
  /** Average per logged day of every nutrient code (input of the nutrient overview, "Ø pro Tag"). */
  avgNutrients: NutrientMap;
  /** Average daily targets over the logged days (kcal and macro grams). */
  avgTargets: DayTarget;
  /** Logged days with eaten kcal at or below the budget (target, plus training when credited). */
  daysUnderGoal: number;
  /** Logged days within ±10 % of the budget ("im Ziel": neither far under nor over). */
  daysOnTarget: number;
  totalExerciseKcal: number;
  totalExerciseMinutes: number;
  weightStart: number | null;
  weightEnd: number | null;
  /** "Trend": change of the linear weight trend over the period's weigh-ins (`weightTrend`). */
  weightTrendKg: number | null;
}

export interface PeriodOptions {
  /** Whether training kcal raise the day's budget (setting "Training aufs Ziel anrechnen"). */
  creditExercise?: boolean;
  /** The same for the steps (setting "Schritte aufs Ziel anrechnen"). */
  creditSteps?: boolean;
  /** The running day: complete only once closed (`isCompleteDay`). */
  today?: ISODate;
}

/** The kcal a day may have: its target, plus the trainings and steps that are credited. */
export function dayBudget(
  r: Pick<DailyRow, 'targetKcal' | 'exerciseKcal'> & { stepsKcal?: number },
  creditExercise = true,
  creditSteps = true,
): number {
  return (
    r.targetKcal +
    creditedTrainingKcal(r.exerciseKcal, r.stepsKcal ?? 0, { exercise: creditExercise, steps: creditSteps })
  );
}

/**
 * "Budget Ø": the average day budget (kcal target plus the credited training and steps, `dayBudget`)
 * over `days`, rounded; null without days. The week card and the reports show this one number.
 */
export function budgetAverage(days: readonly DailyRow[], opts: PeriodOptions = {}): number | null {
  if (days.length === 0) return null;
  const credit = opts.creditExercise ?? true;
  const creditSteps = opts.creditSteps ?? true;
  return Math.round(days.reduce((s, r) => s + dayBudget(r, credit, creditSteps), 0) / days.length);
}

/**
 * "Trend": how much the linear trend of the weigh-ins in [from, to] moved between the first and the
 * last of them (kg, two decimals, negative = losing); null with fewer than two weigh-ins on
 * different days. Single outliers move it less than "last minus first" would.
 */
export function weightTrend(weights: readonly WeightPoint[], from: ISODate, to: ISODate): number | null {
  const inside = weights
    .filter((w) => w.date >= from && w.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inside.length < 2) return null;
  const span = diffDays(inside[0]!.date, inside.at(-1)!.date);
  const trend = linearTrend(inside);
  if (!trend || span <= 0) return null;
  const v = round(trend.slopePerDay * span, 2);
  return v === 0 ? 0 : v;
}

export function periodStats(rows: readonly DailyRow[], opts: PeriodOptions = {}): PeriodStats {
  const credit = opts.creditExercise ?? true;
  const creditSteps = opts.creditSteps ?? true;
  const anyLogged = rows.filter((r) => r.logged);
  const complete = anyLogged.filter((r) => isCompleteDay(r, opts));
  const basis = complete.length > 0 ? 'complete' : 'logged';
  const logged = basis === 'complete' ? complete : anyLogged;
  const n = logged.length || 1;
  const avgOf = (key: string) => round(logged.reduce((s, r) => s + get(r.nutrients, key), 0) / n, 1);
  const weights = rows.filter((r) => r.weightKg !== null);
  const weightStart = weights[0]?.weightKg ?? null;
  const weightEnd = weights.at(-1)?.weightKg ?? null;
  return {
    days: rows.length,
    loggedDays: anyLogged.length,
    completeDays: complete.length,
    basis,
    avg: {
      kcal: round(logged.reduce((s, r) => s + get(r.nutrients, N.kcal), 0) / n, 0),
      protein: avgOf(N.protein),
      fat: avgOf(N.fat),
      carbs: avgOf(N.carbs),
      fiber: avgOf(N.fiber),
      sugar: avgOf(N.sugar),
      satFat: avgOf(N.satFat),
      salt: avgOf(N.salt),
    },
    avgBudgetKcal: budgetAverage(logged, opts) ?? 0,
    avgNutrients: logged.length ? multiplyNutrients(sumNutrients(logged.map((r) => r.nutrients)), 1 / n) : {},
    avgTargets: {
      kcal: round(logged.reduce((s, r) => s + r.targetKcal, 0) / n, 0),
      proteinG: round(logged.reduce((s, r) => s + r.targetProteinG, 0) / n, 1),
      fatG: round(logged.reduce((s, r) => s + r.targetFatG, 0) / n, 1),
      carbsG: round(logged.reduce((s, r) => s + r.targetCarbsG, 0) / n, 1),
    },
    daysUnderGoal: logged.filter((r) => get(r.nutrients, N.kcal) <= dayBudget(r, credit, creditSteps)).length,
    daysOnTarget: logged.filter((r) => {
      const budget = dayBudget(r, credit, creditSteps);
      const kcal = get(r.nutrients, N.kcal);
      return budget > 0 && kcal >= budget * 0.9 && kcal <= budget * 1.1;
    }).length,
    totalExerciseKcal: round(
      rows.reduce((s, r) => s + r.exerciseKcal, 0),
      0,
    ),
    totalExerciseMinutes: rows.reduce((s, r) => s + r.exerciseMinutes, 0),
    weightStart,
    weightEnd,
    weightTrendKg:
      rows.length > 0
        ? weightTrend(
            weights.map((r) => ({ date: r.date, kg: r.weightKg! })),
            rows[0]!.date,
            rows.at(-1)!.date,
          )
        : null,
  };
}
