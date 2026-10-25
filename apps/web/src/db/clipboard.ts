/**
 * The diary clipboard: one copied diary row (a single entry or a whole group) or a whole diary meal
 * ("Kopieren" in its ⋯ menu) on this device, filled by swiping a row to the right and pasted with the
 * paste icon of a diary meal. Lives in `kv` (not synced),
 * survives a reload and stays filled after pasting until it is cleared or something else is copied.
 *
 * It holds a snapshot (item fields, group fields, photo ids), no references to the source entries: the
 * source may be changed or deleted afterwards. Photos are immutable, so their ids are shared, not copied.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { get, N, photoIdsOf, type FoodEntry, type MealItem } from '@ft/shared';
import type { UserDb } from './dexie';
import {
  diaryParts,
  entriesToMealItems,
  firstPhotoId,
  logParts,
  partsItems,
  type DiaryPart,
} from './entries';

export interface Clipboard {
  /**
   * `group`: entries logged together (saved meal, AI analysis); `entry`: one plain entry; `meal`: all
   * rows of a diary meal (`parts`).
   */
  kind: 'entry' | 'group' | 'meal';
  /** What the row showed: name for toasts, the menu and the default name when saving. */
  name: string;
  items: MealItem[];
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
  /** Only `meal`: its rows, logged again with the same structure. `items` holds all their ingredients. */
  parts?: DiaryPart[];
  copiedAt: number;
}

export const CLIPBOARD_KEY = 'clipboard';

export async function readClipboard(db: UserDb): Promise<Clipboard | null> {
  const row = await db.kv.get(CLIPBOARD_KEY);
  return (row?.value as Clipboard | undefined) ?? null;
}

export async function clearClipboard(db: UserDb): Promise<void> {
  await db.kv.delete(CLIPBOARD_KEY);
}

/** Copies a diary row; replaces what was copied before. A group keeps its group fields and photos. */
export async function copyToClipboard(
  db: UserDb,
  kind: 'entry' | 'group',
  name: string,
  entries: readonly FoodEntry[],
): Promise<Clipboard> {
  const first = entries[0];
  const group = kind === 'group' && first;
  const clip: Clipboard = {
    kind,
    name: name.trim().slice(0, 120),
    items: entriesToMealItems(entries),
    mealId: group ? first.mealId : null,
    groupName: group ? first.groupName : null,
    aiAnalysisId: group ? first.aiAnalysisId : null,
    photoIds: group ? photoIdsOf(first) : [],
    copiedAt: Date.now(),
  };
  await db.kv.put({ key: CLIPBOARD_KEY, value: clip });
  return clip;
}

/**
 * Copies a whole diary meal ("Kopieren" in its ⋯ menu): its rows keep their structure; `items` are all
 * ingredients and `photoIds` the first photo of any group (the meal photo when saving it).
 */
export async function copyMealToClipboard(
  db: UserDb,
  name: string,
  entries: readonly FoodEntry[],
): Promise<Clipboard> {
  const parts = diaryParts(entries);
  const photo = firstPhotoId(entries);
  const clip: Clipboard = {
    kind: 'meal',
    name: name.trim().slice(0, 120),
    items: partsItems(parts),
    mealId: null,
    groupName: null,
    aiAnalysisId: null,
    photoIds: photo ? [photo] : [],
    parts,
    copiedAt: Date.now(),
  };
  await db.kv.put({ key: CLIPBOARD_KEY, value: clip });
  return clip;
}

/**
 * Logs the clipboard into a diary meal: a group as a new group (new ids, new `groupId`, logged now) with
 * the same saved meal, name, analysis and photos; an entry as a plain entry; a meal row by row. Returns the new entry ids.
 */
export async function pasteClipboard(
  db: UserDb,
  clip: Clipboard,
  target: { date: string; meal: number },
): Promise<string[]> {
  if (clip.kind === 'meal') return logParts(db, clip.parts ?? [], target);
  return logParts(
    db,
    [
      {
        kind: clip.kind,
        items: clip.items,
        mealId: clip.mealId,
        // Without a saved meal a group needs a name to stay a group.
        groupName: clip.groupName ?? (clip.mealId ? null : clip.name),
        aiAnalysisId: clip.aiAnalysisId,
        photoIds: clip.photoIds,
      },
    ],
    target,
  );
}

/** Energy of the copied items (kcal). */
export function clipboardKcal(clip: Pick<Clipboard, 'items'>): number {
  return clip.items.reduce((s, i) => s + get(i.nutrients, N.kcal), 0);
}
