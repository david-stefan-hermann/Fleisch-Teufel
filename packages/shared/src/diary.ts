import type { ISODate } from './dates.js';
import { isStepsEntry, isStraySteps } from './exercise.js';
import { targetsForDate, type ResolvedTargets } from './goals.js';
import { MICRO_NUTRIENTS, N, type NutrientMap } from './nutrients.js';
import { get, multiplyNutrients, round, scaleNutrients, sumNutrients } from './nutrition.js';
import type { ExerciseEntry, FoodEntry, Goal, MealItem, Settings } from './schemas.js';

/** The photos of a diary group entry: `photoIds`, or the single `photoId` of an older record. */
export function photoIdsOf(entry: Pick<FoodEntry, 'photoId'> & { photoIds?: string[] | null }): string[] {
  return entry.photoIds ?? (entry.photoId ? [entry.photoId] : []);
}

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

/** Name of a quick entry without a text. */
export const QUICK_ENTRY_NAME = 'Schnelleingabe';
/** Names a quick entry got by default (the older one too): such a name is no text of the person. */
export const QUICK_ENTRY_DEFAULT_NAMES: readonly string[] = [QUICK_ENTRY_NAME, 'Schnell hinzugefügt'];
/** Longest title of a quick entry in the diary (characters, the ellipsis included). */
export const QUICK_TITLE_MAX = 60;

/**
 * Title of a quick entry in the diary: the beginning of what the person wrote (its first line),
 * cut at a word boundary with "…" when it is longer than `QUICK_TITLE_MAX`; "Schnelleingabe"
 * without a text. The full text stays in the entry's `note`.
 */
export function quickEntryTitle(text: string | null | undefined): string {
  const line =
    (text ?? '')
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' '))
      .find((l) => l.length > 0) ?? '';
  if (!line) return QUICK_ENTRY_NAME;
  const chars = Array.from(line);
  if (chars.length <= QUICK_TITLE_MAX) return line;
  const cut = takeGraphemes(line, QUICK_TITLE_MAX - 1);
  // A word that ends exactly at the cut is whole; otherwise back to the last space (unless that
  // would leave less than half: one very long word is cut where it is).
  const space = chars[cut.length] === ' ' ? cut.length : cut.lastIndexOf(' ');
  const head = (space >= QUICK_TITLE_MAX / 2 ? cut.slice(0, space) : cut).join('');
  return `${head.replace(/[\s,;:.!?(-]+$/, '')}…`;
}

/**
 * The code points of the whole characters (graphemes) at the start of `text` that fit into `max`
 * code points: an emoji is never cut in half (a lone surrogate became U+FFFD on the server), and a
 * family emoji of several code points is kept whole or left out. Lengths count code points.
 */
function takeGraphemes(text: string, max: number): string[] {
  const out: string[] = [];
  const segments =
    typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(text), (s) => s.segment)
      : Array.from(text);
  for (const g of segments) {
    const points = Array.from(g);
    if (out.length + points.length > max) break;
    out.push(...points);
  }
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
  /** All trainings of the day, steps included. */
  exerciseKcal: number;
  /** The part of `exerciseKcal` from the day's steps (Apple Health). */
  stepsKcal: number;
  /** What raises the budget: trainings and steps, each when its setting says so. */
  creditedKcal: number;
  /** Goal + credited exercise. */
  budgetKcal: number;
  remainingKcal: number;
  entryCount: number;
}

/** Which trainings raise the day's budget: settings "Training/Schritte aufs Ziel anrechnen". */
export interface Credit {
  exercise: boolean;
  steps: boolean;
}

/** Both on unless switched off (null in older records means on). */
export function creditOf(
  settings: Partial<Pick<Settings, 'addExerciseCalories' | 'addStepsCalories'>> | undefined,
): Credit {
  return { exercise: settings?.addExerciseCalories !== false, steps: settings?.addStepsCalories !== false };
}

/** The credited part of a day's training kcal (`total` includes the steps). */
export function creditedTrainingKcal(total: number, stepsKcal: number, credit: Credit): number {
  return (credit.exercise ? total - stepsKcal : 0) + (credit.steps ? stepsKcal : 0);
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
  settings: (Pick<Settings, 'addExerciseCalories'> & Partial<Pick<Settings, 'addStepsCalories'>>) | undefined;
  mealCount?: number;
}): DaySummary {
  const { date } = params;
  const mealCount = params.mealCount ?? 4;
  const entries = params.entries.filter((e) => !e.deleted && e.date === date);
  // Steps count once per day, only under their fixed id (`isStraySteps`).
  const exercises = params.exercises.filter((e) => !e.deleted && e.date === date && !isStraySteps(e));
  const perMeal = Array.from({ length: mealCount }, (_, m) =>
    sumNutrients(entries.filter((e) => e.meal === m).map((e) => e.nutrients)),
  );
  const food = sumNutrients(perMeal);
  const targets = targetsForDate(params.goals, date);
  const exerciseKcal = round(
    exercises.reduce((s, e) => s + e.kcal, 0),
    0,
  );
  const stepsKcal = round(
    exercises.filter(isStepsEntry).reduce((s, e) => s + e.kcal, 0),
    0,
  );
  const creditedKcal = creditedTrainingKcal(exerciseKcal, stepsKcal, creditOf(params.settings));
  const budgetKcal = targets.kcal + creditedKcal;
  return {
    date,
    targets,
    food,
    perMeal,
    exerciseKcal,
    stepsKcal,
    creditedKcal,
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
 * A group with only one remaining entry (the others were deleted) is shown as a plain entry, unless
 * it comes from an AI analysis: an analysed meal is always a group row (name, photo, group editor),
 * also with a single ingredient.
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
    if (!group || (group.length < 2 && !e.aiAnalysisId)) {
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
