/**
 * Unsaved edits of one diary group (entries logged together from a saved meal or an AI analysis),
 * edited on `/diary-group/$groupId`. Like the meal editor, nothing touches the synced entries until
 * "Änderungen übernehmen"; the draft lives on this device in `kv` so it survives the way through the
 * ingredient search (`/add?into=group:<id>` → food page → back) and a reload.
 *
 * Saving changes only these diary entries, never the saved meal they came from.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { uuidv7, type FoodEntry, type MealItem } from '@ft/shared';
import type { UserDb } from './dexie';
import { mealItem } from './mealDraft';
import { deleteRecord, patchRecord, saveRecord } from './write';

/** An ingredient of the draft; `entryId` links it to its diary entry, null for one added in the editor. */
export type GroupDraftItem = MealItem & { entryId: string | null };

export interface GroupDraft {
  groupId: string;
  /** Day of the group (the entries are looked up by date). */
  date: string;
  name: string;
  items: GroupDraftItem[];
}

export const groupDraftKey = (groupId: string) => `groupDraft:${groupId}`;

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
  };
}

export async function readGroupDraft(db: UserDb, groupId: string): Promise<GroupDraft | null> {
  const row = await db.kv.get(groupDraftKey(groupId));
  return (row?.value as GroupDraft | undefined) ?? null;
}

export async function writeGroupDraft(db: UserDb, draft: GroupDraft): Promise<void> {
  await db.kv.put({ key: groupDraftKey(draft.groupId), value: draft });
}

export async function clearGroupDraft(db: UserDb, groupId: string): Promise<void> {
  await db.kv.delete(groupDraftKey(groupId));
}

const itemKey = (i: GroupDraftItem) => JSON.stringify([i.entryId, mealItem(i)]);

/** Whether the draft differs from the logged entries (name, ingredients and amounts). */
export function isGroupDirty(draft: GroupDraft, entries: readonly FoodEntry[], name: string): boolean {
  const saved = draftFromEntries(entries, name);
  return (
    (draft.name.trim() || name) !== name ||
    JSON.stringify(draft.items.map(itemKey)) !== JSON.stringify(saved.items.map(itemKey))
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
  return db.transaction('rw', [db.foodEntries, db.meals, db.kv], async () => {
    const entries = await groupEntries(db, groupId, date);
    if (entries.length === 0) return false;
    const draft =
      (await readGroupDraft(db, groupId)) ?? draftFromEntries(entries, await groupName(db, entries));
    await writeGroupDraft(db, { ...draft, items: [...draft.items, { ...mealItem(item), entryId: null }] });
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
 * - added ones become new entries of the same group (same meal, photo, analysis), after the last one.
 * The saved meal is never touched. A name equal to the saved meal's name stays unset (`groupName`
 * null), so the row keeps following the meal. Returns false when the group is gone.
 */
export async function saveGroupDraft(db: UserDb, draft: GroupDraft): Promise<boolean> {
  if (draft.items.length === 0) throw new Error('A group needs at least one ingredient');
  return db.transaction('rw', [db.foodEntries, db.meals, db.outbox, db.kv], async () => {
    const entries = await groupEntries(db, draft.groupId, draft.date);
    const first = entries[0];
    if (!first) return false;
    const meal = first.mealId ? await db.meals.get(first.mealId) : undefined;
    const typed = draft.name.trim().slice(0, 120);
    const groupNameValue = !typed
      ? first.groupName
      : meal && typed === meal.name && !first.groupName
        ? null
        : typed;

    const byId = new Map(entries.map((e) => [e.id, e]));
    const kept = new Set<string>();
    let loggedAt = Math.max(...entries.map((e) => e.loggedAt));
    for (const item of draft.items) {
      const prev = item.entryId ? byId.get(item.entryId) : undefined;
      if (prev) {
        kept.add(prev.id);
        const next = { ...mealItem(item), groupName: groupNameValue };
        const changed =
          JSON.stringify(mealItem(prev)) !== JSON.stringify(mealItem(item)) ||
          prev.groupName !== groupNameValue;
        if (changed) await patchRecord(db, 'foodEntries', prev.id, next);
        continue;
      }
      // Added in the editor (or its entry was deleted meanwhile): a new entry of the same group.
      await saveRecord(db, 'foodEntries', {
        ...mealItem(item),
        id: uuidv7(),
        date: first.date,
        meal: first.meal,
        loggedAt: ++loggedAt,
        mealId: first.mealId,
        aiAnalysisId: first.aiAnalysisId,
        groupId: first.groupId,
        groupName: groupNameValue,
        photoId: first.photoId,
      });
    }
    for (const e of entries) if (!kept.has(e.id)) await deleteRecord(db, 'foodEntries', e.id);
    await clearGroupDraft(db, draft.groupId);
    return true;
  });
}
