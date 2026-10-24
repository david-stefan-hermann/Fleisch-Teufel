import { dateRange, type ISODate } from './dates.js';
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
  exerciseKcal: number;
  exerciseMinutes: number;
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
      exerciseMinutes: xs.reduce((s, x) => s + x.minutes, 0),
      weightKg: wByDate.get(date) ?? null,
    };
  });
}

/** Whether a day's entries can be taken as the whole day (see `MIN_MEALS_COMPLETE`). */
export function isCompleteDay(r: Pick<DailyRow, 'logged' | 'mealsLogged' | 'completed'>): boolean {
  return r.logged && (r.completed || r.mealsLogged >= MIN_MEALS_COMPLETE);
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
  avgTargetKcal: number;
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
  weightChange: number | null;
}

export interface PeriodOptions {
  /** Whether training kcal raise the day's budget (setting "Trainingskalorien anrechnen"). */
  creditExercise?: boolean;
}

/** The kcal a day may have: its target, plus the training when that is credited. */
export function dayBudget(r: Pick<DailyRow, 'targetKcal' | 'exerciseKcal'>, creditExercise = true): number {
  return r.targetKcal + (creditExercise ? r.exerciseKcal : 0);
}

export function periodStats(rows: readonly DailyRow[], opts: PeriodOptions = {}): PeriodStats {
  const credit = opts.creditExercise ?? true;
  const anyLogged = rows.filter((r) => r.logged);
  const complete = anyLogged.filter(isCompleteDay);
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
    avgTargetKcal: round(logged.reduce((s, r) => s + r.targetKcal, 0) / n, 0),
    avgNutrients: logged.length ? multiplyNutrients(sumNutrients(logged.map((r) => r.nutrients)), 1 / n) : {},
    avgTargets: {
      kcal: round(logged.reduce((s, r) => s + r.targetKcal, 0) / n, 0),
      proteinG: round(logged.reduce((s, r) => s + r.targetProteinG, 0) / n, 1),
      fatG: round(logged.reduce((s, r) => s + r.targetFatG, 0) / n, 1),
      carbsG: round(logged.reduce((s, r) => s + r.targetCarbsG, 0) / n, 1),
    },
    daysUnderGoal: logged.filter((r) => get(r.nutrients, N.kcal) <= dayBudget(r, credit)).length,
    daysOnTarget: logged.filter((r) => {
      const budget = dayBudget(r, credit);
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
    weightChange:
      weights.length >= 2 && weightStart !== null && weightEnd !== null
        ? round(weightEnd - weightStart, 2)
        : null,
  };
}
