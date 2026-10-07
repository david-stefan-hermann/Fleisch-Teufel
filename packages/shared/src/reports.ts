import { dateRange, type ISODate } from './dates.js';
import { targetsForDate } from './goals.js';
import { N, type NutrientMap } from './nutrients.js';
import { get, multiplyNutrients, round, sumNutrients } from './nutrition.js';
import type { DayTarget, ExerciseEntry, FoodEntry, Goal, WeightEntry } from './schemas.js';

export interface DailyRow {
  date: ISODate;
  logged: boolean;
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
}): DailyRow[] {
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

export interface PeriodStats {
  days: number;
  loggedDays: number;
  /** Averages over logged days only (unlogged days would distort them towards 0). */
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
  daysUnderGoal: number;
  totalExerciseKcal: number;
  totalExerciseMinutes: number;
  weightStart: number | null;
  weightEnd: number | null;
  weightChange: number | null;
}

export function periodStats(rows: readonly DailyRow[]): PeriodStats {
  const logged = rows.filter((r) => r.logged);
  const n = logged.length || 1;
  const avgOf = (key: string) => round(logged.reduce((s, r) => s + get(r.nutrients, key), 0) / n, 1);
  const weights = rows.filter((r) => r.weightKg !== null);
  const weightStart = weights[0]?.weightKg ?? null;
  const weightEnd = weights.at(-1)?.weightKg ?? null;
  return {
    days: rows.length,
    loggedDays: logged.length,
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
    daysUnderGoal: logged.filter((r) => get(r.nutrients, N.kcal) <= r.targetKcal + r.exerciseKcal).length,
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
