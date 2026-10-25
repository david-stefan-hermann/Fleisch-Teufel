/**
 * Unsaved edits of a saved meal (meal editor). Nothing is written to the synced `meals` record until
 * "Speichern"; the draft lives on this device in `kv` so it survives the way through the ingredient
 * search (`/add?into=meal:<id>` → food page → back) and a reload.
 *
 * A new photo waits as bytes under its own key: the draft itself is rewritten on every keystroke,
 * and the photo only goes to `photos` (which queues an upload) once the draft is saved.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { uuidv7, type Meal, type MealItem } from '@ft/shared';
import type { UserDb } from './dexie';
import { storePhotoBytes } from './photos';
import { patchRecord, saveRecord } from './write';

export interface MealDraft {
  mealId: string;
  name: string;
  items: MealItem[];
  /** `keep` the saved photo, `remove` it, or replace it with the `pending` draft photo. */
  photo: 'keep' | 'remove' | 'pending';
  /** Recipe mode: weight after cooking (see `Meal.cookedGrams`); missing on older drafts counts as null. */
  cookedGrams?: number | null;
  /**
   * `updatedAt` of the meal the draft started from. Differs from the current meal when another device
   * changed it meanwhile: the editor then asks before the draft overwrites that (older drafts: unset).
   */
  baseUpdatedAt?: number;
  /** "Neues Meal": there is no record yet; saving creates it under `mealId`. */
  isNew?: true;
}

export interface MealDraftPhoto {
  bytes: ArrayBuffer;
  type: string;
  /** When it was picked; tells a new photo apart from the previous one without comparing bytes. */
  at: number;
}

export const draftKey = (mealId: string) => `mealDraft:${mealId}`;
export const draftPhotoKey = (mealId: string) => `mealDraftPhoto:${mealId}`;

export function draftFromMeal(
  meal: Pick<Meal, 'id' | 'name' | 'items' | 'updatedAt'> & Partial<Pick<Meal, 'cookedGrams'>>,
): MealDraft {
  return {
    mealId: meal.id,
    name: meal.name,
    items: meal.items,
    photo: 'keep',
    cookedGrams: meal.cookedGrams ?? null,
    baseUpdatedAt: meal.updatedAt,
  };
}

/** Whether the meal changed since the draft was started (another device, or a pull). */
export function isMealDraftStale(draft: MealDraft, meal: Pick<Meal, 'updatedAt'>): boolean {
  return draft.baseUpdatedAt !== undefined && draft.baseUpdatedAt !== meal.updatedAt;
}

/** Only the item fields (diary entries or other objects may carry more). */
export function mealItem(i: MealItem): MealItem {
  const { foodId, source, name, brand, grams, portionLabel, portionGrams, quantity, per100, nutrients } = i;
  return { foodId, source, name, brand, grams, portionLabel, portionGrams, quantity, per100, nutrients };
}

export async function readMealDraft(db: UserDb, mealId: string): Promise<MealDraft | null> {
  const row = await db.kv.get(draftKey(mealId));
  return (row?.value as MealDraft | undefined) ?? null;
}

export async function writeMealDraft(db: UserDb, draft: MealDraft): Promise<void> {
  await db.kv.put({ key: draftKey(draft.mealId), value: draft });
}

export async function readMealDraftPhoto(db: UserDb, mealId: string): Promise<MealDraftPhoto | null> {
  const row = await db.kv.get(draftPhotoKey(mealId));
  return (row?.value as MealDraftPhoto | undefined) ?? null;
}

export async function setMealDraftPhoto(
  db: UserDb,
  mealId: string,
  photo: MealDraftPhoto | null,
): Promise<void> {
  if (photo) await db.kv.put({ key: draftPhotoKey(mealId), value: photo });
  else await db.kv.delete(draftPhotoKey(mealId));
}

export async function clearMealDraft(db: UserDb, mealId: string): Promise<void> {
  await db.kv.bulkDelete([draftKey(mealId), draftPhotoKey(mealId)]);
}

/** Whether the draft differs from the saved meal (name, ingredients and amounts, photo, cooked weight). */
export function isDirty(
  draft: MealDraft,
  meal: Pick<Meal, 'name' | 'items'> & Partial<Pick<Meal, 'cookedGrams'>>,
): boolean {
  return (
    draft.photo !== 'keep' ||
    (draft.name.trim() || meal.name) !== meal.name ||
    (draft.cookedGrams ?? null) !== (meal.cookedGrams ?? null) ||
    JSON.stringify(draft.items.map(mealItem)) !== JSON.stringify(meal.items.map(mealItem))
  );
}

/**
 * "Neues Meal" (Gespeicherte Meals): an empty draft under a new id, the record follows on "Speichern".
 * Returns the id for the editor.
 */
export async function startNewMeal(db: UserDb): Promise<string> {
  const mealId = uuidv7();
  await writeMealDraft(db, { mealId, name: '', items: [], photo: 'keep', cookedGrams: null, isNew: true });
  return mealId;
}

/** Stand-in for the record of a new meal while only its draft exists (the editor needs a `Meal`). */
export function newMealPlaceholder(mealId: string): Meal {
  return { id: mealId, name: '', items: [], photoId: null, cookedGrams: null, updatedAt: 0, deleted: false };
}

/**
 * Writes the draft to the meal (one synced change) and drops it; a new meal's draft creates the record.
 * A pending photo is stored (and queued for upload) only now. Returns false when the meal is gone.
 */
export async function saveMealDraft(db: UserDb, draft: MealDraft): Promise<boolean> {
  if (draft.items.length === 0) throw new Error('A meal needs at least one ingredient');
  // Photo, meal and draft in one transaction: an empty or vanished meal leaves no orphaned photo
  // behind, and a kill in between leaves no half-saved state.
  return db.transaction('rw', [db.meals, db.outbox, db.photos, db.kv], async () => {
    const meal = await db.meals.get(draft.mealId);
    if (!meal && draft.isNew) {
      const name = draft.name.trim().slice(0, 120);
      if (!name) throw new Error('A meal needs a name');
      const photo = draft.photo === 'pending' ? await readMealDraftPhoto(db, draft.mealId) : null;
      await saveRecord(db, 'meals', {
        id: draft.mealId,
        name,
        items: draft.items.map(mealItem),
        photoId: photo ? await storePhotoBytes(db, photo.bytes, photo.type) : null,
        cookedGrams: draft.cookedGrams ?? null,
      });
      await clearMealDraft(db, draft.mealId);
      return true;
    }
    if (!meal || meal.deleted) return false;
    let photoId = meal.photoId;
    if (draft.photo === 'remove') photoId = null;
    if (draft.photo === 'pending') {
      const photo = await readMealDraftPhoto(db, draft.mealId);
      if (photo) photoId = await storePhotoBytes(db, photo.bytes, photo.type);
    }
    await patchRecord(db, 'meals', draft.mealId, {
      name: draft.name.trim().slice(0, 120) || meal.name,
      items: draft.items.map(mealItem),
      photoId,
      cookedGrams: draft.cookedGrams ?? null,
    });
    await clearMealDraft(db, draft.mealId);
    return true;
  });
}

/**
 * Appends an ingredient to the draft of a saved meal ("Zutat hinzufügen" in the editor), starting a
 * draft from the saved meal when there is none. Returns false when the meal is gone.
 */
export async function addItemToMealDraft(db: UserDb, mealId: string, item: MealItem): Promise<boolean> {
  return addItemsToMealDraft(db, mealId, [item]);
}

/** Like `addItemToMealDraft` for several ingredients at once (another saved meal taken apart). */
export async function addItemsToMealDraft(
  db: UserDb,
  mealId: string,
  items: readonly MealItem[],
): Promise<boolean> {
  return db.transaction('rw', [db.meals, db.kv], async () => {
    const meal = await db.meals.get(mealId);
    const saved = await readMealDraft(db, mealId);
    // A new meal has only its draft.
    if (!meal && !saved?.isNew) return false;
    if (meal?.deleted) return false;
    const draft = saved ?? draftFromMeal(meal!);
    await writeMealDraft(db, { ...draft, items: [...draft.items, ...items.map(mealItem)] });
    return true;
  });
}
