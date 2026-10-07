/** Diary write operations used by several screens (kept outside components: pure data logic). */
import {
  computeItem,
  rescaleItem,
  uuidv7,
  type AiAnalysisResult,
  type ExerciseEntry,
  type ExerciseTemplate,
  type Food,
  type FoodEntry,
  type MealItem,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { saveRecord } from './write';

export type NewFoodEntry = Omit<FoodEntry, 'id' | 'updatedAt' | 'deleted' | 'date' | 'loggedAt' | 'groupId'>;

/** Logs the same item on one or more days (multi-day log). */
export async function logFoodEntry(db: UserDb, item: NewFoodEntry, dates: string[]): Promise<void> {
  const now = Date.now();
  for (const [i, date] of dates.entries()) {
    await saveRecord(db, 'foodEntries', { ...item, id: uuidv7(), date, loggedAt: now + i, groupId: null });
  }
}

export async function saveExercise(
  db: UserDb,
  data: Omit<ExerciseEntry, 'id' | 'updatedAt' | 'deleted' | 'loggedAt'>,
  existing: ExerciseEntry | null,
): Promise<void> {
  if (existing) await saveRecord(db, 'exerciseEntries', { ...existing, ...data });
  else await saveRecord(db, 'exerciseEntries', { ...data, id: uuidv7(), loggedAt: Date.now() });
}

/** Saves a training as reusable template ("Vorlage"); returns its id. */
export async function saveExerciseTemplate(
  db: UserDb,
  data: Omit<ExerciseTemplate, 'id' | 'updatedAt' | 'deleted'>,
): Promise<string> {
  const id = uuidv7();
  await saveRecord(db, 'exerciseTemplates', { ...data, id });
  return id;
}

/**
 * Logs items into a diary meal. With `mealId` (a saved meal) all entries share one `groupId`,
 * so the diary shows them as one expandable row; `factor` scales every item (0.5 = half).
 */
export async function logItems(
  db: UserDb,
  items: MealItem[],
  target: { date: string; meal: number },
  opts: { factor?: number; mealId?: string | null; aiAnalysisId?: string | null } = {},
): Promise<number> {
  const factor = opts.factor ?? 1;
  const groupId = opts.mealId ? uuidv7() : null;
  const now = Date.now();
  for (const [i, item] of items.entries()) {
    const scaled = factor === 1 ? item : rescaleItem(item, Math.round(item.quantity * factor * 1000) / 1000);
    const { foodId, source, name, brand, grams, portionLabel, portionGrams, quantity, per100, nutrients } =
      scaled;
    await saveRecord(db, 'foodEntries', {
      // Only the item fields: `items` may also be diary entries (copying a meal from another day).
      foodId,
      source,
      name,
      brand,
      grams,
      portionLabel,
      portionGrams,
      quantity,
      per100,
      nutrients,
      id: uuidv7(),
      date: target.date,
      meal: target.meal,
      loggedAt: now + i,
      mealId: opts.mealId ?? null,
      aiAnalysisId: opts.aiAnalysisId ?? null,
      groupId,
    });
  }
  return items.length;
}

/**
 * Saves the confirmed items of an AI photo analysis as a reusable saved meal and logs it
 * (source "ai", grouped in the diary). Returns the id of the new meal.
 */
export async function saveAiMeal(
  db: UserDb,
  name: string,
  items: { food: Food; grams: number }[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
): Promise<string> {
  const mealItems: MealItem[] = items.map(({ food, grams }) => ({
    foodId: food.id,
    source: 'ai',
    name: food.name,
    brand: food.brand,
    grams,
    portionLabel: food.unit === 'ml' ? '1 ml' : '1 g',
    portionGrams: 1,
    quantity: grams,
    per100: food.nutrients,
    nutrients: computeItem({ per100: food.nutrients, portionLabel: '1 g', portionGrams: 1, quantity: grams })
      .nutrients,
  }));
  const mealId = uuidv7();
  await saveRecord(db, 'meals', { id: mealId, name: name.trim().slice(0, 120), items: mealItems });
  await logItems(db, mealItems, target, { mealId, aiAnalysisId: analysis.analysisId });
  return mealId;
}
