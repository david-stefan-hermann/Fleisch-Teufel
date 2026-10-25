/**
 * Unsaved edits of one diary group (entries logged together from a saved meal or an AI analysis),
 * edited on `/diary-group/$groupId`. Like the meal editor, nothing touches the synced entries until
 * "Änderungen übernehmen"; the draft lives on this device in `kv` so it survives the way through the
 * ingredient search (`/add?into=group:<id>` → food page → back) and a reload.
 *
 * Saving changes only these diary entries, never the saved meal they came from; only "Als Meal
 * speichern" (`saveGroupAsMeal`) writes a saved meal, on purpose.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import {
  photoIdsOf,
  uuidv7,
  type AiAnalysisResult,
  type Food,
  type FoodEntry,
  type MealItem,
} from '@ft/shared';
import { draftFromResult } from './aiDraft';
import type { UserDb } from './dexie';
import { aiMealItems } from './entries';
import { mealItem } from './mealDraft';
import { storePhotoBytes } from './photos';
import { deleteRecord, patchRecord, restoreRecord, saveRecord } from './write';

/** An ingredient of the draft; `entryId` links it to its diary entry, null for one added in the editor. */
export type GroupDraftItem = MealItem & { entryId: string | null };

export interface GroupDraft {
  groupId: string;
  /** Day of the group (the entries are looked up by date). */
  date: string;
  name: string;
  items: GroupDraftItem[];
  /** Set by "Neu analysieren": the analysis the new ingredients come from. */
  aiAnalysisId?: string;
  /** `groupVersion` of the entries the draft started from (see `MealDraft.baseUpdatedAt`). */
  baseUpdatedAt?: number;
}

/**
 * The version of a group: the sum of its live entries' versions. Any change to any entry bumps it,
 * and so does an entry leaving (deleted on another device) or joining, even when the remaining ones
 * share the newest version (two ingredients logged in the same millisecond, the newer one deleted:
 * the maximum would not move). Epoch milliseconds times a handful of entries stay exact in a double.
 */
export function groupVersion(entries: readonly Pick<FoodEntry, 'updatedAt'>[]): number {
  return entries.reduce((s, e) => s + e.updatedAt, 0);
}

/** Whether the group's entries changed since the draft was started (another device, or a pull). */
export function isGroupDraftStale(
  draft: GroupDraft,
  entries: readonly Pick<FoodEntry, 'updatedAt'>[],
): boolean {
  return draft.baseUpdatedAt !== undefined && draft.baseUpdatedAt !== groupVersion(entries);
}

export const groupDraftKey = (groupId: string) => `groupDraft:${groupId}`;

/**
 * A photo added in the group editor, waiting for "Änderungen übernehmen" (like `mealDraftPhoto`):
 * bytes under their own key, because the draft itself is rewritten on every keystroke, and only
 * saving puts them into `photos` (which queues the upload).
 */
export interface GroupDraftPhoto {
  bytes: ArrayBuffer;
  type: string;
  /** When it was added; its identity (removing, keys in the photo strip). */
  at: number;
}

export const groupDraftPhotosKey = (groupId: string) => `groupDraftPhotos:${groupId}`;

/** The photos added to a group's draft, in order. */
export async function readGroupDraftPhotos(db: UserDb, groupId: string): Promise<GroupDraftPhoto[]> {
  const row = await db.kv.get(groupDraftPhotosKey(groupId));
  return (row?.value as GroupDraftPhoto[] | undefined) ?? [];
}

/** Adds photos (already compressed) to the group's draft; saved with the draft. */
export async function addGroupDraftPhotos(
  db: UserDb,
  groupId: string,
  images: readonly Blob[],
): Promise<void> {
  // Read before the transaction: it would close while waiting for `arrayBuffer()`.
  const at = Date.now();
  const added = await Promise.all(
    images.map(async (b, i) => ({ bytes: await b.arrayBuffer(), type: b.type || 'image/jpeg', at: at + i })),
  );
  await db.transaction('rw', db.kv, async () => {
    const now = await readGroupDraftPhotos(db, groupId);
    await db.kv.put({ key: groupDraftPhotosKey(groupId), value: [...now, ...added] });
  });
}

export async function removeGroupDraftPhoto(db: UserDb, groupId: string, at: number): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const left = (await readGroupDraftPhotos(db, groupId)).filter((p) => p.at !== at);
    if (left.length) await db.kv.put({ key: groupDraftPhotosKey(groupId), value: left });
    else await db.kv.delete(groupDraftPhotosKey(groupId));
  });
}

/** Live entries of a group on its day, in diary order. */
export async function groupEntries(db: UserDb, groupId: string, date: string): Promise<FoodEntry[]> {
  return db.foodEntries
    .where('date')
    .equals(date)
    .filter((e) => e.groupId === groupId && !e.deleted)
    .sortBy('loggedAt');
}

/** Draft of the group as logged; `name` is the name the diary row shows. */
export function draftFromEntries(entries: readonly FoodEntry[], name: string): GroupDraft {
  const first = entries[0]!;
  return {
    groupId: first.groupId!,
    date: first.date,
    name,
    items: entries.map((e) => ({ ...mealItem(e), entryId: e.id })),
    baseUpdatedAt: groupVersion(entries),
  };
}

export async function readGroupDraft(db: UserDb, groupId: string): Promise<GroupDraft | null> {
  const row = await db.kv.get(groupDraftKey(groupId));
  return (row?.value as GroupDraft | undefined) ?? null;
}

export async function writeGroupDraft(db: UserDb, draft: GroupDraft): Promise<void> {
  await db.kv.put({ key: groupDraftKey(draft.groupId), value: draft });
}

/** Drops the draft and its added photos. */
export async function clearGroupDraft(db: UserDb, groupId: string): Promise<void> {
  await db.kv.bulkDelete([groupDraftKey(groupId), groupDraftPhotosKey(groupId)]);
}

/**
 * "Neu analysieren" in the group editor: the ingredients of the draft are replaced by the result of
 * a new analysis of the group's photo, like an unchanged review (first candidate of every item, the
 * model's grams). The name follows the recognised dish unless the group belongs to a saved meal.
 * Returns null when the analysis has no usable item (the draft then stays as it is), else the new
 * draft and the chosen foods.
 */
export function groupDraftFromAnalysis(
  draft: GroupDraft,
  result: AiAnalysisResult,
  keepName: boolean,
): { draft: GroupDraft; foods: Food[] } | null {
  const review = draftFromResult({ meal: 0, result });
  const chosen = review.rows.flatMap((r) => {
    const food = r.candidates.find((c) => c.id === r.foodId);
    return food && r.grams && r.grams > 0 ? [{ food, grams: r.grams }] : [];
  });
  if (chosen.length === 0) return null;
  return {
    draft: {
      ...draft,
      name: keepName || !result.dishName ? draft.name : review.mealName.slice(0, 120),
      items: aiMealItems(chosen).map((i) => ({ ...i, entryId: null })),
      aiAnalysisId: result.analysisId,
    },
    foods: chosen.map((c) => c.food),
  };
}

const itemKey = (i: GroupDraftItem) => JSON.stringify([i.entryId, mealItem(i)]);

/** The draft without its base version, for comparing with the entries. */
const comparable = (d: GroupDraft) => d.items.map(itemKey);

/** Whether the draft differs from the logged entries (name, ingredients and amounts). */
export function isGroupDirty(draft: GroupDraft, entries: readonly FoodEntry[], name: string): boolean {
  const saved = draftFromEntries(entries, name);
  return (
    (draft.name.trim() || name) !== name ||
    JSON.stringify(comparable(draft)) !== JSON.stringify(comparable(saved))
  );
}

/**
 * Appends an ingredient to the draft ("Zutat hinzufügen" through the food search), starting a draft
 * from the logged entries when there is none. Returns false when the group is gone.
 */
export async function addItemToGroupDraft(
  db: UserDb,
  groupId: string,
  date: string,
  item: MealItem,
): Promise<boolean> {
  return addItemsToGroupDraft(db, groupId, date, [item]);
}

/** Like `addItemToGroupDraft` for several ingredients at once (a saved meal taken apart). */
export async function addItemsToGroupDraft(
  db: UserDb,
  groupId: string,
  date: string,
  items: readonly MealItem[],
): Promise<boolean> {
  return db.transaction('rw', [db.foodEntries, db.meals, db.kv], async () => {
    const entries = await groupEntries(db, groupId, date);
    if (entries.length === 0) return false;
    const draft =
      (await readGroupDraft(db, groupId)) ?? draftFromEntries(entries, await groupName(db, entries));
    const added = items.map((i) => ({ ...mealItem(i), entryId: null }));
    await writeGroupDraft(db, { ...draft, items: [...draft.items, ...added] });
    return true;
  });
}

/** The name the diary shows for the group: its own name, else the saved meal's, else "Meal". */
export async function groupName(db: UserDb, entries: readonly FoodEntry[]): Promise<string> {
  const first = entries[0];
  if (!first) return 'Meal';
  if (first.groupName) return first.groupName;
  const meal = first.mealId ? await db.meals.get(first.mealId) : undefined;
  return meal?.name ?? 'Meal';
}

/**
 * Writes the draft to the diary entries of the group and drops it:
 * - kept ingredients get their new amount (and the name of the group),
 * - removed ones are deleted (soft, like every delete),
 * - added ones become new entries of the same group (same meal and photos; the analysis of the draft
 *   after "Neu analysieren", else the group's), after the last one,
 * - photos added in the editor are stored (and uploaded) and appended to the photos of every entry.
 * The saved meal is never touched. A name equal to the saved meal's name stays unset (`groupName`
 * null), so the row keeps following the meal. Returns false when the group is gone.
 */
export async function saveGroupDraft(db: UserDb, draft: GroupDraft): Promise<boolean> {
  return (await writeGroup(db, draft, null)) !== null;
}

/** How "Als Meal speichern" in the group editor treats the saved meal. */
export interface GroupAsMeal {
  /** `new`: a new meal; `update`: the meal the group was logged from takes over name and ingredients. */
  mode: 'new' | 'update';
  name: string;
}

/**
 * "Als Meal speichern" in the group editor: what the editor shows (the draft) becomes a saved meal and
 * the group's entries take over the draft like `saveGroupDraft`, now attached to that meal (`mealId`;
 * the own name is dropped when it equals the meal's, analysis and photos stay). `update` replaces name
 * and ingredients of the group's meal (a deleted one comes back) and keeps its photo (without one: the
 * group's first) and cooked weight; `new` creates a meal with the group's first photo. Days logged
 * before stay as they are. Returns the meal id, or null when the group is gone.
 */
export async function saveGroupAsMeal(
  db: UserDb,
  draft: GroupDraft,
  asMeal: GroupAsMeal,
): Promise<string | null> {
  return writeGroup(db, draft, asMeal);
}

/** `saveGroupDraft` and `saveGroupAsMeal` in one transaction; returns the group's meal id ('' without). */
async function writeGroup(db: UserDb, draft: GroupDraft, asMeal: GroupAsMeal | null): Promise<string | null> {
  if (draft.items.length === 0) throw new Error('A group needs at least one ingredient');
  const added = await readGroupDraftPhotos(db, draft.groupId);
  return db.transaction('rw', [db.foodEntries, db.meals, db.outbox, db.kv, db.photos], async () => {
    const entries = await groupEntries(db, draft.groupId, draft.date);
    const first = entries[0];
    if (!first) return null;
    const meal = first.mealId ? await db.meals.get(first.mealId) : undefined;
    const typed = draft.name.trim().slice(0, 120);

    // Photos: unchanged without added ones; else the group's (or the meal photo it showed) plus the new.
    let photos: { photoId: string | null; photoIds: string[] | null } = {
      photoId: first.photoId,
      photoIds: first.photoIds ?? null,
    };
    if (added.length > 0) {
      const stored = photoIdsOf(first);
      const base = stored.length ? stored : meal?.photoId ? [meal.photoId] : [];
      const ids = [...base];
      for (const p of added) ids.push(await storePhotoBytes(db, p.bytes, p.type));
      photos = { photoId: ids[0]!, photoIds: ids };
    }
    const photosChanged = added.length > 0;

    let mealId = first.mealId;
    let groupNameValue: string | null;
    if (asMeal) {
      const mealName = asMeal.name.trim().slice(0, 120);
      const items = draft.items.map(mealItem);
      const groupPhoto = photos.photoIds?.[0] ?? photos.photoId ?? meal?.photoId ?? null;
      if (asMeal.mode === 'update' && first.mealId && meal) {
        if (meal.deleted) await restoreRecord(db, 'meals', meal.id);
        await patchRecord(db, 'meals', meal.id, {
          name: mealName,
          items,
          photoId: meal.photoId ?? groupPhoto,
        });
      } else {
        mealId = uuidv7();
        await saveRecord(db, 'meals', {
          id: mealId,
          name: mealName,
          items,
          photoId: groupPhoto,
          cookedGrams: null,
        });
      }
      const own = typed || first.groupName;
      groupNameValue = !own || own === mealName ? null : own;
    } else {
      // A name equal to the saved meal's is no own name: the row follows the meal again (also when the
      // group had its own name before).
      groupNameValue = !typed ? first.groupName : meal && typed === meal.name ? null : typed;
    }

    const byId = new Map(entries.map((e) => [e.id, e]));
    const kept = new Set<string>();
    let loggedAt = Math.max(...entries.map((e) => e.loggedAt));
    for (const item of draft.items) {
      const prev = item.entryId ? byId.get(item.entryId) : undefined;
      if (prev) {
        kept.add(prev.id);
        const next = {
          ...mealItem(item),
          groupName: groupNameValue,
          mealId,
          ...(photosChanged ? photos : {}),
        };
        const changed =
          JSON.stringify(mealItem(prev)) !== JSON.stringify(mealItem(item)) ||
          prev.groupName !== groupNameValue ||
          prev.mealId !== mealId ||
          photosChanged;
        if (changed) await patchRecord(db, 'foodEntries', prev.id, next);
        continue;
      }
      // Its entry was deleted meanwhile (another device): a deletion is never undone from a draft.
      if (item.entryId) continue;
      // Added in the editor: a new entry of the same group.
      await saveRecord(db, 'foodEntries', {
        ...mealItem(item),
        id: uuidv7(),
        date: first.date,
        meal: first.meal,
        loggedAt: ++loggedAt,
        mealId,
        aiAnalysisId: draft.aiAnalysisId ?? first.aiAnalysisId,
        groupId: first.groupId,
        groupName: groupNameValue,
        ...photos,
      });
    }
    for (const e of entries) if (!kept.has(e.id)) await deleteRecord(db, 'foodEntries', e.id);
    await clearGroupDraft(db, draft.groupId);
    return mealId ?? '';
  });
}
