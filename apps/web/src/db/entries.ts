/** Diary write operations used by several screens (kept outside components: pure data logic). */
import {
  foodFromMeal,
  groupDiaryEntries,
  MAX_HINT_LENGTH,
  QUICK_ENTRY_DEFAULT_NAMES,
  QUICK_ENTRY_NAME,
  quickAddNutrients,
  quickEntryTitle,
  rescaleItem,
  scaleNutrients,
  uuidv7,
  type AiAnalysisResult,
  type ExerciseEntry,
  type TrainingItem,
  type FoodEntry,
  type ISODate,
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
  | 'id'
  | 'updatedAt'
  | 'deleted'
  | 'date'
  | 'loggedAt'
  | 'groupId'
  | 'groupName'
  | 'photoId'
  | 'photoIds'
  | 'note'
>;

/** A logged item that may carry the note of the quick entry it was copied from (`entryToItem`). */
export type DiaryItem = MealItem & { note?: string | null };

/** Logs one food on a day (the food page). Returns the id of the new entry. */
export async function logFoodEntry(db: UserDb, item: NewFoodEntry, date: string): Promise<string> {
  const id = uuidv7();
  await saveRecord(db, 'foodEntries', {
    ...item,
    id,
    date,
    loggedAt: Date.now(),
    groupId: null,
    groupName: null,
    photoId: null,
    photoIds: null,
    note: null,
  });
  return id;
}

/** What the quick entry form holds: the text and the typed values. */
export interface QuickEntryValues {
  meal: number;
  /** "Was hast du gegessen?", in full; may be empty. */
  text: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/** The fields of a quick entry from the form: values without a food, the text as note and title. */
function quickEntryFields(v: QuickEntryValues, keepName?: string) {
  const text = v.text.trim().slice(0, MAX_HINT_LENGTH);
  return {
    source: 'quick' as const,
    foodId: null,
    // Without a text an entry of an older app version keeps the name it has.
    name: text ? quickEntryTitle(text) : (keepName ?? QUICK_ENTRY_NAME),
    brand: null,
    grams: null,
    portionLabel: null,
    portionGrams: null,
    quantity: 1,
    per100: null,
    nutrients: quickAddNutrients({
      kcal: v.kcal,
      proteinG: v.proteinG ?? undefined,
      carbsG: v.carbsG ?? undefined,
      fatG: v.fatG ?? undefined,
    }),
    meal: v.meal,
    mealId: null,
    aiAnalysisId: null,
    note: text || null,
  };
}

/**
 * "Eintragen" of the quick entry form: a plain entry with the typed values (no food, no group). The
 * full text goes into `note`, its shortened first line is the name. Returns the id of the new entry.
 */
export async function logQuickEntry(db: UserDb, date: ISODate, values: QuickEntryValues): Promise<string> {
  const id = uuidv7();
  await saveRecord(db, 'foodEntries', {
    ...quickEntryFields(values),
    id,
    date,
    loggedAt: Date.now(),
    groupId: null,
    groupName: null,
    photoId: null,
    photoIds: null,
  });
  return id;
}

/** "Änderungen übernehmen" of a quick entry: text, values and meal; day, time and group stay. */
export async function saveQuickEntry(db: UserDb, entry: FoodEntry, values: QuickEntryValues): Promise<void> {
  const keep = QUICK_ENTRY_DEFAULT_NAMES.includes(entry.name) ? entry.name : undefined;
  await saveRecord(db, 'foodEntries', { ...entry, ...quickEntryFields(values, keep) });
}

/** The text a quick entry shows in its form: the note, else the name the person gave it. */
export function quickEntryText(entry: Pick<FoodEntry, 'name' | 'note'>): string {
  return entry.note ?? (QUICK_ENTRY_DEFAULT_NAMES.includes(entry.name) ? '' : entry.name);
}

/** Saves a training entry; editing keeps its day, time, group and saved training. */
export async function saveExercise(
  db: UserDb,
  { group: _group, ...data }: TrainingToLog & { date: ISODate },
  existing: ExerciseEntry | null,
): Promise<void> {
  if (existing)
    await saveRecord(db, 'exerciseEntries', {
      ...existing,
      ...data,
      groupId: existing.groupId ?? null,
      templateId: data.templateId === undefined ? (existing.templateId ?? null) : data.templateId,
      date: existing.date,
    });
  else
    await saveRecord(db, 'exerciseEntries', {
      ...data,
      templateId: data.templateId ?? null,
      groupId: null,
      steps: null,
      distanceM: null,
      id: uuidv7(),
      loggedAt: Date.now(),
    });
}

/**
 * A training to log: the fields of an `ExerciseEntry` without ids, date and times. Newer optional
 * fields may be left out (filled with null here, like `NewFoodEntry`).
 */
export type TrainingToLog = Omit<
  ExerciseEntry,
  'id' | 'updatedAt' | 'deleted' | 'loggedAt' | 'date' | 'templateId' | 'groupId' | 'steps' | 'distanceM'
> & {
  templateId?: string | null;
  /** Rows with the same mark share a new `groupId` (the activities of one saved training). */
  group?: string;
};

/**
 * Logs several trainings of one day at once (the activities of a saved training), each as its own
 * entry, in one transaction, in the given order (`loggedAt` ascending). Rows with the same `group`
 * mark share a fresh `groupId`. Returns the new ids (undo deletes them).
 */
export async function logTrainings(
  db: UserDb,
  date: ISODate,
  rows: readonly TrainingToLog[],
): Promise<string[]> {
  const now = Date.now();
  return db.transaction('rw', [db.exerciseEntries, db.outbox], async () => {
    const ids: string[] = [];
    const groups = new Map<string, string>();
    for (const [i, { group, ...row }] of rows.entries()) {
      const id = uuidv7();
      let groupId: string | null = null;
      if (group !== undefined) {
        groupId = groups.get(group) ?? uuidv7();
        groups.set(group, groupId);
      }
      await saveRecord(db, 'exerciseEntries', {
        ...row,
        templateId: row.templateId ?? null,
        groupId,
        steps: null,
        distanceM: null,
        id,
        date,
        loggedAt: now + i,
      });
      ids.push(id);
    }
    return ids;
  });
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

/** The fields of a saved training from its activities: activity 1 in the flat fields, the rest in `extraItems`. */
function trainingFields(items: readonly TrainingItem[]) {
  const [first, ...rest] = items;
  if (!first) throw new Error('A saved training needs an activity.');
  return {
    typeKey: first.typeKey,
    typeName: first.typeName,
    minutes: first.minutes,
    intensity: first.intensity,
    note: first.note?.trim() || null,
    extraItems: rest.length ? rest.map((i) => ({ ...i, note: i.note?.trim() || null })) : null,
  };
}

/** Saves a training for reuse ("gespeichertes Training") with one or more activities; returns its id. */
export async function saveTraining(
  db: UserDb,
  data: { name: string; items: readonly TrainingItem[]; pinned?: boolean | null },
  /** The id of a new training whose draft already has one ("Neues Training"). */
  id: string = uuidv7(),
): Promise<string> {
  await saveRecord(db, 'exerciseTemplates', {
    id,
    name: data.name.trim().slice(0, 80),
    ...trainingFields(data.items),
    pinned: data.pinned ? true : null,
  });
  return id;
}

/**
 * Changes a saved training: name, activities and pin, each only when given. False when it is gone
 * (deleted meanwhile, also on another device).
 */
export async function updateTraining(
  db: UserDb,
  id: string,
  patch: { name?: string; items?: readonly TrainingItem[]; pinned?: boolean | null },
): Promise<boolean> {
  const prev = await db.exerciseTemplates.get(id);
  if (!prev || prev.deleted) return false;
  await patchRecord(db, 'exerciseTemplates', id, {
    ...(patch.name !== undefined && { name: patch.name.trim().slice(0, 80) || prev.name }),
    ...(patch.items && trainingFields(patch.items)),
    ...(patch.pinned !== undefined && { pinned: patch.pinned ? true : null }),
  });
  return true;
}

/**
 * Logs items into a diary meal. With `mealId` (a saved meal) or `groupName` (a group without a
 * saved meal, e.g. an AI analysis logged with "Meal eintragen") all entries share one `groupId`,
 * so the diary shows them as one expandable row; `factor` scales every item (0.5 = half).
 * `photoIds` go on every entry of the group, the first also as `photoId` (the diary row shows it before
 * the meal's photo). A plain entry (no group) keeps the note of the quick entry it was copied from.
 * Returns the ids of the new entries, in order.
 */
export async function logItems(
  db: UserDb,
  items: DiaryItem[],
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
        note: groupId ? null : (item.note ?? null),
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
 * and uploaded); without any, the meal's photo of this moment. Returns the ids of the logged entries.
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
): Promise<string[]> {
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
  return logItems(db, mealItems, target, {
    mealId,
    aiAnalysisId: analysis.analysisId,
    photoIds: photoIds.length ? photoIds : existing?.photoId ? [existing.photoId] : null,
  });
}

/**
 * "Meal eintragen" of an AI analysis that was not saved: logs the confirmed items as one named group in the diary,
 * without a saved meal. The analysed photos are stored (and uploaded) and kept on every entry; the
 * diary row shows the first. Returns the ids of the logged entries.
 */
export async function logAiItems(
  db: UserDb,
  name: string,
  items: AiItem[],
  target: { date: string; meal: number },
  analysis: Pick<AiAnalysisResult, 'analysisId'>,
  /** The analysed photos (already compressed by the AI queue), in order; none keeps the row without photo. */
  photos: readonly Blob[] = [],
): Promise<string[]> {
  // Bytes first (not an IndexedDB promise), then photos and entries in one transaction: the app
  // being killed in between can neither leave orphaned photos nor a group without its photos.
  const bytes = await readPhotoBytes(photos);
  return db.transaction('rw', [db.foodEntries, db.outbox, db.photos], async () =>
    logItems(db, aiMealItems(items), target, {
      groupName: name.trim() || 'Meal vom Foto',
      aiAnalysisId: analysis.analysisId,
      photoIds: await storePhotoRows(db, bytes),
    }),
  );
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

/**
 * One diary entry as something to log again on its own (clipboard, "Wie gestern", suggestions): the
 * item fields plus the note of a quick entry. Ingredients of a meal or a group never carry a note
 * (`entriesToMealItems`).
 */
export function entryToItem(entry: DiaryItem): DiaryItem {
  const [item] = entriesToMealItems([entry]);
  return entry.note ? { ...item!, note: entry.note } : item!;
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
  /** `entry`: one item, with the note of a quick entry. */
  items: DiaryItem[];
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
        items: [entryToItem(row.entry)],
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
  return entriesToMealItems(parts.flatMap((p) => p.items));
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
