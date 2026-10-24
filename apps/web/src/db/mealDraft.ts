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
import type { Meal, MealItem } from '@ft/shared';
import type { UserDb } from './dexie';
import { storePhotoBytes } from './photos';
import { patchRecord } from './write';

export interface MealDraft {
  mealId: string;
  name: string;
  items: MealItem[];
  /** `keep` the saved photo, `remove` it, or replace it with the `pending` draft photo. */
  photo: 'keep' | 'remove' | 'pending';
  /**
   * `updatedAt` of the meal the draft started from. Differs from the current meal when another device
   * changed it meanwhile: the editor then asks before the draft overwrites that (older drafts: unset).
   */
  baseUpdatedAt?: number;
}

export interface MealDraftPhoto {
  bytes: ArrayBuffer;
  type: string;
  /** When it was picked; tells a new photo apart from the previous one without comparing bytes. */
  at: number;
}

export const draftKey = (mealId: string) => `mealDraft:${mealId}`;
export const draftPhotoKey = (mealId: string) => `mealDraftPhoto:${mealId}`;

export function draftFromMeal(meal: Pick<Meal, 'id' | 'name' | 'items' | 'updatedAt'>): MealDraft {
  return {
    mealId: meal.id,
    name: meal.name,
    items: meal.items,
    photo: 'keep',
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

/** Whether the draft differs from the saved meal (name, ingredients and amounts, photo). */
export function isDirty(draft: MealDraft, meal: Pick<Meal, 'name' | 'items'>): boolean {
  return (
    draft.photo !== 'keep' ||
    (draft.name.trim() || meal.name) !== meal.name ||
    JSON.stringify(draft.items.map(mealItem)) !== JSON.stringify(meal.items.map(mealItem))
  );
}

/**
 * Writes the draft to the meal (one synced change) and drops it. A pending photo is stored (and
 * queued for upload) only now. Returns false when the meal is gone.
 */
export async function saveMealDraft(db: UserDb, draft: MealDraft): Promise<boolean> {
  if (draft.items.length === 0) throw new Error('A meal needs at least one ingredient');
  // Photo, meal and draft in one transaction: an empty or vanished meal leaves no orphaned photo
  // behind, and a kill in between leaves no half-saved state.
  return db.transaction('rw', [db.meals, db.outbox, db.photos, db.kv], async () => {
    const meal = await db.meals.get(draft.mealId);
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
  return db.transaction('rw', [db.meals, db.kv], async () => {
    const meal = await db.meals.get(mealId);
    if (!meal || meal.deleted) return false;
    const draft = (await readMealDraft(db, mealId)) ?? draftFromMeal(meal);
    await writeMealDraft(db, { ...draft, items: [...draft.items, mealItem(item)] });
    return true;
  });
}
