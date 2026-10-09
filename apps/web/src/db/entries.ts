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
import { addItemToMealDraft } from './mealDraft';
import { storePhoto } from './photos';
import { patchRecord, restoreRecord, saveRecord } from './write';

export type NewFoodEntry = Omit<
  FoodEntry,
  'id' | 'updatedAt' | 'deleted' | 'date' | 'loggedAt' | 'groupId' | 'groupName' | 'photoId'
>;

/** Logs one food on a day (the food page). */
export async function logFoodEntry(db: UserDb, item: NewFoodEntry, date: string): Promise<void> {
  await saveRecord(db, 'foodEntries', {
    ...item,
    id: uuidv7(),
    date,
    loggedAt: Date.now(),
    groupId: null,
    groupName: null,
    photoId: null,
  });
}

export async function saveExercise(
  db: UserDb,
  data: Omit<ExerciseEntry, 'id' | 'updatedAt' | 'deleted' | 'loggedAt'>,
  existing: ExerciseEntry | null,
): Promise<void> {
  if (existing) await saveRecord(db, 'exerciseEntries', { ...existing, ...data });
  else await saveRecord(db, 'exerciseEntries', { ...data, id: uuidv7(), loggedAt: Date.now() });
}

/**
 * Moves diary entries to another meal of the same day (drag and drop in the diary). `loggedAt` and
 * `groupId` stay, so a saved meal moves as one row and keeps its place in the time order.
 */
export async function moveEntriesToMeal(db: UserDb, ids: readonly string[], meal: number): Promise<void> {
  await db.transaction('rw', [db.foodEntries, db.outbox], async () => {
    for (const id of ids) {
      const prev = await db.foodEntries.get(id);
      if (prev && !prev.deleted && prev.meal !== meal) await patchRecord(db, 'foodEntries', id, { meal });
    }
  });
}

/** Saves a training for reuse ("gespeichertes Training"); returns its id. */
export async function saveExerciseTemplate(
  db: UserDb,
  data: Omit<ExerciseTemplate, 'id' | 'updatedAt' | 'deleted'>,
): Promise<string> {
  const id = uuidv7();
  await saveRecord(db, 'exerciseTemplates', { ...data, id });
  return id;
}

/**
 * Logs items into a diary meal. With `mealId` (a saved meal) or `groupName` (a group without a
 * saved meal, e.g. an AI analysis logged with "Meal eintragen") all entries share one `groupId`,
 * so the diary shows them as one expandable row; `factor` scales every item (0.5 = half).
 * `photoId` goes on every entry of the group (the diary row shows it before the meal's photo).
 */
export async function logItems(
  db: UserDb,
  items: MealItem[],
  target: { date: string; meal: number },
  opts: {
    factor?: number;
    mealId?: string | null;
    aiAnalysisId?: string | null;
    groupName?: string | null;
    photoId?: string | null;
  } = {},
): Promise<number> {
  const factor = opts.factor ?? 1;
  const groupName = opts.groupName?.trim().slice(0, 120) || null;
  const groupId = opts.mealId || groupName ? uuidv7() : null;
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
      groupName,
      photoId: groupId ? (opts.photoId ?? null) : null,
    });
  }
  return items.length;
}

/**
 * Appends an ingredient to a saved meal from the food search ("Zutat hinzufügen" in the meal editor).
 * It goes into the editor's draft, not into the record: the editor saves explicitly.
 */
export async function addItemToMeal(db: UserDb, mealId: string, item: MealItem): Promise<boolean> {
  return addItemToMealDraft(db, mealId, item);
}

/** Confirmed ingredients of an AI analysis as logged items (source "ai", grams as 1 g portions). */
export function aiMealItems(items: { food: Food; grams: number }[]): MealItem[] {
  return items.map(({ food, grams }) => ({
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
}

/**
 * Saves the confirmed items of an AI photo analysis as a reusable meal with the analysed photo,
 * without logging anything ("Als Meal speichern" in the review). Returns the id of the new meal.
 */
export async function createAiMeal(
  db: UserDb,
  name: string,
  items: { food: Food; grams: number }[],
  /** The analysed photo; becomes the meal photo. */
  photo: Blob | null = null,
): Promise<string> {
  const mealId = uuidv7();
  const photoId = photo ? await storePhoto(db, photo) : null;
  await saveRecord(db, 'meals', {
    id: mealId,
    name: name.trim().slice(0, 120),
    items: aiMealItems(items),
    photoId,
  });
  return mealId;
}

/**
 * "Meal eintragen" of an AI analysis that was saved as a meal: the meal first takes over the current
 * ingredients and name (it always matches what gets logged; a meal deleted meanwhile comes back),
 * then the items are logged as a group attached to it. The entries keep the meal's photo of this
 * moment, also when the meal gets another photo later. Returns the number of logged entries.
 */
export async function logAiMeal(
  db: UserDb,
  mealId: string,
  name: string,
  items: { food: Food; grams: number }[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
): Promise<number> {
  const mealItems = aiMealItems(items);
  const existing = await db.meals.get(mealId);
  if (existing?.deleted) await restoreRecord(db, 'meals', mealId);
  if (existing) await patchRecord(db, 'meals', mealId, { name: name.trim().slice(0, 120), items: mealItems });
  else
    await saveRecord(db, 'meals', {
      id: mealId,
      name: name.trim().slice(0, 120),
      items: mealItems,
      photoId: null,
    });
  return logItems(db, mealItems, target, {
    mealId,
    aiAnalysisId: analysis.analysisId,
    photoId: existing?.photoId ?? null,
  });
}

/**
 * "Meal eintragen" of an AI analysis that was not saved: logs the confirmed items as one named group in the diary,
 * without a saved meal. The analysed photo is stored (and uploaded) and shown on the diary row.
 * Returns the number of logged entries.
 */
export async function logAiItems(
  db: UserDb,
  name: string,
  items: { food: Food; grams: number }[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
  /** The analysed photo (already compressed by the AI queue); null keeps the row without photo. */
  photo: Blob | null = null,
): Promise<number> {
  const photoId = photo ? await storePhoto(db, photo) : null;
  return logItems(db, aiMealItems(items), target, {
    groupName: name.trim() || 'Meal vom Foto',
    aiAnalysisId: analysis.analysisId,
    photoId,
  });
}

/** Diary entries as ingredients of a saved meal (only the item fields). */
export function entriesToMealItems(entries: readonly FoodEntry[]): MealItem[] {
  return entries.map(
    ({ foodId, source, name, brand, grams, portionLabel, portionGrams, quantity, per100, nutrients }) => ({
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
    }),
  );
}

/** Saves the entries of a diary meal as a reusable meal ("Als Meal speichern"); returns its id. */
export async function saveMealFromEntries(
  db: UserDb,
  name: string,
  entries: readonly FoodEntry[],
): Promise<string> {
  const id = uuidv7();
  await saveRecord(db, 'meals', {
    id,
    name: name.trim().slice(0, 120),
    items: entriesToMealItems(entries),
    photoId: null,
  });
  return id;
}
