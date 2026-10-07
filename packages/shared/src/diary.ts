import type { ISODate } from './dates.js';
import { targetsForDate, type ResolvedTargets } from './goals.js';
import { MICRO_NUTRIENTS, N, type NutrientMap } from './nutrients.js';
import { get, multiplyNutrients, round, scaleNutrients, sumNutrients } from './nutrition.js';
import type { ExerciseEntry, FoodEntry, Goal, MealItem, Settings } from './schemas.js';

/** Inputs for a logged item derived from a food + chosen portion. */
export interface PortionChoice {
  per100: NutrientMap;
  portionLabel: string;
  portionGrams: number;
  quantity: number;
}

/** Grams and absolute nutrients for `quantity × portion`. */
export function computeItem(choice: PortionChoice): { grams: number; nutrients: NutrientMap } {
  const grams = round(choice.portionGrams * choice.quantity, 2);
  return { grams, nutrients: scaleNutrients(choice.per100, grams) };
}

/** Quick add: absolute values without a food. */
export function quickAddNutrients(v: {
  kcal: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
}): NutrientMap {
  const out: NutrientMap = { [N.kcal]: v.kcal };
  if (v.proteinG) out[N.protein] = v.proteinG;
  if (v.fatG) out[N.fat] = v.fatG;
  if (v.carbsG) out[N.carbs] = v.carbsG;
  return out;
}

/** Re-scales an item to a new quantity (used when editing entries / logging meals at a factor). */
export function rescaleItem<
  T extends Pick<MealItem, 'grams' | 'portionGrams' | 'quantity' | 'per100' | 'nutrients'>,
>(item: T, quantity: number): T {
  if (item.per100 && item.portionGrams) {
    const { grams, nutrients } = computeItem({
      per100: item.per100,
      portionGrams: item.portionGrams,
      portionLabel: '',
      quantity,
    });
    return { ...item, quantity, grams, nutrients };
  }
  const factor = item.quantity > 0 ? quantity / item.quantity : 0;
  return {
    ...item,
    quantity,
    grams: item.grams === null ? null : round(item.grams * factor, 2),
    nutrients: multiplyNutrients(item.nutrients, factor),
  };
}

export interface DaySummary {
  date: ISODate;
  targets: ResolvedTargets;
  food: NutrientMap;
  perMeal: NutrientMap[];
  exerciseKcal: number;
  /** Goal + credited exercise. */
  budgetKcal: number;
  remainingKcal: number;
  entryCount: number;
}

/**
 * Everything the diary header shows: "Ziel − Essen + Sport = Übrig".
 * Exercise is credited only when the user enabled it (feature #9).
 */
export function summarizeDay(params: {
  date: ISODate;
  entries: readonly FoodEntry[];
  exercises: readonly ExerciseEntry[];
  goals: readonly Goal[];
  settings: Pick<Settings, 'addExerciseCalories'> | undefined;
  mealCount?: number;
}): DaySummary {
  const { date } = params;
  const mealCount = params.mealCount ?? 4;
  const entries = params.entries.filter((e) => !e.deleted && e.date === date);
  const exercises = params.exercises.filter((e) => !e.deleted && e.date === date);
  const perMeal = Array.from({ length: mealCount }, (_, m) =>
    sumNutrients(entries.filter((e) => e.meal === m).map((e) => e.nutrients)),
  );
  const food = sumNutrients(perMeal);
  const targets = targetsForDate(params.goals, date);
  const exerciseKcal = round(
    exercises.reduce((s, e) => s + e.kcal, 0),
    0,
  );
  const credit = params.settings?.addExerciseCalories === false ? 0 : exerciseKcal;
  const budgetKcal = targets.kcal + credit;
  return {
    date,
    targets,
    food,
    perMeal,
    exerciseKcal,
    budgetKcal,
    remainingKcal: round(budgetKcal - get(food, N.kcal), 0),
    entryCount: entries.length,
  };
}

/** Status of a micronutrient against its target (for coloring). */
export function microStatus(
  value: number,
  target: { grams: number; kind: 'min' | 'max' },
): 'ok' | 'low' | 'high' {
  if (target.kind === 'min') return value >= target.grams ? 'ok' : 'low';
  return value > target.grams ? 'high' : 'ok';
}

export { MICRO_NUTRIENTS };

/** One row of a diary meal: a single entry, or all entries logged together from a saved meal. */
export type DiaryRow =
  | { kind: 'entry'; entry: FoodEntry }
  | {
      kind: 'group';
      groupId: string;
      mealId: string | null;
      /** Name of a group logged without a saved meal (`groupName` of its first entry). */
      groupName: string | null;
      entries: FoodEntry[];
      nutrients: NutrientMap;
    };

/**
 * Groups entries that share a `groupId` (logged in one action from a saved meal, or as a named
 * group from an AI analysis) into one row.
 * Rows keep the order of their first entry (`entries` must be sorted by `loggedAt`); entries
 * without `groupId` (quick adds, single foods, records from older app versions) stay single.
 * A group with only one remaining entry (the others were deleted) is shown as a plain entry.
 */
export function groupDiaryEntries(entries: FoodEntry[]): DiaryRow[] {
  const byGroup = new Map<string, FoodEntry[]>();
  for (const e of entries) {
    if (!e.groupId) continue;
    const list = byGroup.get(e.groupId);
    if (list) list.push(e);
    else byGroup.set(e.groupId, [e]);
  }
  const rows: DiaryRow[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const group = e.groupId ? byGroup.get(e.groupId) : undefined;
    if (!group || group.length < 2) {
      rows.push({ kind: 'entry', entry: e });
      continue;
    }
    if (seen.has(e.groupId!)) continue;
    seen.add(e.groupId!);
    rows.push({
      kind: 'group',
      groupId: e.groupId!,
      mealId: e.mealId,
      groupName: e.groupName ?? null,
      entries: group,
      nutrients: sumNutrients(group.map((g) => g.nutrients)),
    });
  }
  return rows;
}
