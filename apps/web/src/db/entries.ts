/** Diary write operations used by several screens (kept outside components: pure data logic). */
import {
  foodFromMeal,
  groupDiaryEntries,
  rescaleItem,
  scaleNutrients,
  uuidv7,
  type AiAnalysisResult,
  type ExerciseEntry,
  type ExerciseTemplate,
  type FoodEntry,
  type Meal,
  type MealItem,
  photoIdsOf,
} from '@ft/shared';
import type { AiItem } from './aiDraft';
import type { UserDb } from './dexie';
import { addItemToMealDraft } from './mealDraft';
import { storePhoto, storePhotoBytes } from './photos';
import { patchRecord, restoreRecord, saveRecord } from './write';

export type NewFoodEntry = Omit<
  FoodEntry,
  'id' | 'updatedAt' | 'deleted' | 'date' | 'loggedAt' | 'groupId' | 'groupName' | 'photoId' | 'photoIds'
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
    photoIds: null,
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
 * `photoIds` go on every entry of the group, the first also as `photoId` (the diary row shows it before
 * the meal's photo). Returns the ids of the new entries, in order.
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
    /** Photos of the group in order; the first becomes `photoId` (thumbnail). */
    photoIds?: readonly string[] | null;
  } = {},
): Promise<string[]> {
  const factor = opts.factor ?? 1;
  const groupName = opts.groupName?.trim().slice(0, 120) || null;
  const groupId = opts.mealId || groupName ? uuidv7() : null;
  const photoIds = groupId && opts.photoIds?.length ? [...opts.photoIds] : null;
  const now = Date.now();
  const ids: string[] = [];
  // One transaction: the app being killed or one invalid item never leaves half a group behind.
  await db.transaction('rw', [db.foodEntries, db.outbox], async () => {
    for (const [i, item] of items.entries()) {
      const id = uuidv7();
      ids.push(id);
      const scaled =
        factor === 1 ? item : rescaleItem(item, Math.round(item.quantity * factor * 1000) / 1000);
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
        id,
        date: target.date,
        meal: target.meal,
        loggedAt: now + i,
        mealId: opts.mealId ?? null,
        aiAnalysisId: opts.aiAnalysisId ?? null,
        groupId,
        groupName,
        photoId: photoIds?.[0] ?? null,
        photoIds,
      });
    }
  });
  return ids;
}

/**
 * Appends an ingredient to a saved meal from the food search ("Zutat hinzufügen" in the meal editor).
 * It goes into the editor's draft, not into the record: the editor saves explicitly.
 */
export async function addItemToMeal(db: UserDb, mealId: string, item: MealItem): Promise<boolean> {
  return addItemToMealDraft(db, mealId, item);
}

/**
 * Confirmed ingredients of an AI analysis as logged items (source "ai"): grams as 1 g / 1 ml
 * portions, or the count of the portion chosen in the review ("1,5 × EL"). A food with estimated
 * values is no database food: its item has no food id and keeps the values as a snapshot.
 */
export function aiMealItems(items: AiItem[]): MealItem[] {
  return items.map(({ food, grams, portion }) => {
    const p =
      portion && portion.grams > 0 ? portion : { label: food.unit === 'ml' ? '1 ml' : '1 g', grams: 1 };
    // The quantity is what gets stored and edited later (editor: quantity × portion); the grams
    // follow it, so the entry never shows one amount and computes with another.
    const quantity = Math.round((grams / p.grams) * 100) / 100;
    const exact = p.grams === 1 ? grams : Math.round(quantity * p.grams * 100) / 100;
    return {
      foodId: food.estimated ? null : food.id,
      source: 'ai',
      name: food.name,
      brand: food.brand,
      grams: exact,
      portionLabel: p.label,
      portionGrams: p.grams,
      quantity,
      per100: food.nutrients,
      nutrients: scaleNutrients(food.nutrients, exact),
    };
  });
}

/**
 * Saves the confirmed items of an AI photo analysis as a reusable meal with the analysed photo,
 * without logging anything ("Als Meal speichern" in the review). Returns the id of the new meal.
 */
export async function createAiMeal(
  db: UserDb,
  name: string,
  items: AiItem[],
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
    cookedGrams: null,
  });
  return mealId;
}

/**
 * "Meal eintragen" of an AI analysis that was saved as a meal: the meal first takes over the current
 * ingredients and name (it always matches what gets logged; a meal deleted meanwhile comes back),
 * then the items are logged as a group attached to it. The entries keep the analysed photos (stored
 * and uploaded); without any, the meal's photo of this moment. Returns the number of logged entries.
 */
export async function logAiMeal(
  db: UserDb,
  mealId: string,
  name: string,
  items: AiItem[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
  /** The analysed photos (already compressed by the AI queue), in order. */
  photos: readonly Blob[] = [],
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
      cookedGrams: null,
    });
  const photoIds = await storePhotos(db, photos);
  const ids = await logItems(db, mealItems, target, {
    mealId,
    aiAnalysisId: analysis.analysisId,
    photoIds: photoIds.length ? photoIds : existing?.photoId ? [existing.photoId] : null,
  });
  return ids.length;
}

/**
 * "Meal eintragen" of an AI analysis that was not saved: logs the confirmed items as one named group in the diary,
 * without a saved meal. The analysed photos are stored (and uploaded) and kept on every entry; the
 * diary row shows the first. Returns the number of logged entries.
 */
export async function logAiItems(
  db: UserDb,
  name: string,
  items: AiItem[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
  /** The analysed photos (already compressed by the AI queue), in order; none keeps the row without photo. */
  photos: readonly Blob[] = [],
): Promise<number> {
  // Bytes first (not an IndexedDB promise), then photos and entries in one transaction: the app
  // being killed in between can neither leave orphaned photos nor a group without its photos.
  const bytes = await readPhotoBytes(photos);
  const ids = await db.transaction('rw', [db.foodEntries, db.outbox, db.photos], async () =>
    logItems(db, aiMealItems(items), target, {
      groupName: name.trim() || 'Meal vom Foto',
      aiAnalysisId: analysis.analysisId,
      photoIds: await storePhotoRows(db, bytes),
    }),
  );
  return ids.length;
}

/** The images as bytes, read outside any IndexedDB transaction. */
export async function readPhotoBytes(photos: readonly Blob[]): Promise<PhotoBytes[]> {
  return Promise.all(photos.map(async (p) => ({ bytes: await p.arrayBuffer(), type: p.type })));
}

export interface PhotoBytes {
  bytes: ArrayBuffer;
  type: string;
}

/** Stores photos on the device (uploaded with the next sync) and returns their ids in order. */
export async function storePhotoRows(db: UserDb, photos: readonly PhotoBytes[]): Promise<string[]> {
  const ids: string[] = [];
  for (const p of photos) ids.push(await storePhotoBytes(db, p.bytes, p.type));
  return ids;
}

/** Stores photos on the device (uploaded with the next sync) and returns their ids in order. */
async function storePhotos(db: UserDb, photos: readonly Blob[]): Promise<string[]> {
  return storePhotoRows(db, await readPhotoBytes(photos));
}

/** Diary entries (or items) as ingredients of a saved meal (only the item fields). */
export function entriesToMealItems(entries: readonly MealItem[]): MealItem[] {
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

/**
 * One row of a diary meal as something that can be logged again: a plain entry, or a group (entries
 * logged together) with its saved meal, own name, analysis and photos. A snapshot, no references to
 * the source entries ("Wie gestern", the clipboard, suggestions).
 */
export interface DiaryPart {
  kind: 'entry' | 'group';
  items: MealItem[];
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
}

/** The rows of a diary meal as parts, in diary order (`entries` sorted by `loggedAt`). */
export function diaryParts(entries: readonly FoodEntry[]): DiaryPart[] {
  return groupDiaryEntries([...entries]).map((row) => {
    if (row.kind === 'entry')
      return {
        kind: 'entry',
        items: entriesToMealItems([row.entry]),
        mealId: null,
        groupName: null,
        aiAnalysisId: null,
        photoIds: [],
      };
    const first = row.entries[0]!;
    return {
      kind: 'group',
      items: entriesToMealItems(row.entries),
      mealId: row.mealId,
      groupName: row.groupName,
      aiAnalysisId: first.aiAnalysisId,
      photoIds: photoIdsOf(first),
    };
  });
}

/**
 * Logs parts into a diary meal in one transaction: a group as a new group (new ids, new `groupId`)
 * with the same saved meal, name, analysis and photos, an entry as a plain entry. A group with neither
 * saved meal nor name is called "Meal" (it needs one to stay a group). Returns the new entry ids.
 */
export async function logParts(
  db: UserDb,
  parts: readonly DiaryPart[],
  target: { date: string; meal: number },
): Promise<string[]> {
  const ids: string[] = [];
  await db.transaction('rw', [db.foodEntries, db.outbox], async () => {
    for (const p of parts) {
      if (p.kind === 'entry') ids.push(...(await logItems(db, p.items, target)));
      else
        ids.push(
          ...(await logItems(db, p.items, target, {
            mealId: p.mealId,
            groupName: p.groupName ?? (p.mealId ? null : 'Meal'),
            aiAnalysisId: p.aiAnalysisId,
            photoIds: p.photoIds,
          })),
        );
    }
  });
  return ids;
}

/** All ingredients of the parts, groups taken apart (saving a meal, kcal). */
export function partsItems(parts: readonly DiaryPart[]): MealItem[] {
  return parts.flatMap((p) => p.items);
}

/** The first photo of any group (the analysed or the meal photo it was logged with), or null. */
export function firstPhotoId(entries: readonly FoodEntry[]): string | null {
  for (const e of entries) {
    const id = photoIdsOf(e)[0];
    if (id) return id;
  }
  return null;
}

/** Saves the entries of a diary meal as a reusable meal ("Als Meal speichern"); returns its id. */
export async function saveMealFromEntries(
  db: UserDb,
  name: string,
  entries: readonly FoodEntry[],
): Promise<string> {
  // All ingredients one by one (groups taken apart); the photo of the first group that has one.
  return saveMealFromItems(db, name, entriesToMealItems(entries), firstPhotoId(entries));
}

/**
 * Saves items as a reusable meal with an optional photo (an existing photo id, shared, not copied);
 * returns its id. Used by "Als Meal speichern" of the diary meal page and of the clipboard.
 */
export async function saveMealFromItems(
  db: UserDb,
  name: string,
  items: readonly MealItem[],
  photoId: string | null,
): Promise<string> {
  const id = uuidv7();
  await saveRecord(db, 'meals', {
    id,
    name: name.trim().slice(0, 120),
    items: entriesToMealItems(items),
    photoId,
    cookedGrams: null,
  });
  return id;
}

/**
 * "Als Lebensmittel speichern" in the meal editor: the meal per 100 g (cooked weight when known) as an
 * own food, so leftovers and meal prep are logged like anything packaged. Returns the new food's id, or
 * null when the meal has no weight.
 */
export async function saveMealAsFood(
  db: UserDb,
  meal: Pick<Meal, 'name' | 'items'> & Partial<Pick<Meal, 'cookedGrams'>>,
  name: string,
): Promise<string | null> {
  const food = foodFromMeal(meal, uuidv7(), name);
  if (!food) return null;
  await saveRecord(db, 'customFoods', food);
  return food.id;
}
