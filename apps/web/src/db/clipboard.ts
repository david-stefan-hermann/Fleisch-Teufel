/**
 * The diary clipboard: one copied diary row (a single entry or a whole group) on this device, filled by
 * swiping a row to the right and pasted with the paste icon of a diary meal. Lives in `kv` (not synced),
 * survives a reload and stays filled after pasting until it is cleared or something else is copied.
 *
 * It holds a snapshot (item fields, group fields, photo ids), no references to the source entries: the
 * source may be changed or deleted afterwards. Photos are immutable, so their ids are shared, not copied.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { get, N, photoIdsOf, type FoodEntry, type MealItem } from '@ft/shared';
import type { UserDb } from './dexie';
import { entriesToMealItems, logParts } from './entries';

export interface Clipboard {
  /** `group`: entries logged together (saved meal, AI analysis); `entry`: one plain entry. */
  kind: 'entry' | 'group';
  /** What the row showed: name for toasts, the menu and the default name when saving. */
  name: string;
  items: MealItem[];
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
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
  kind: Clipboard['kind'],
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
 * Logs the clipboard into a diary meal: a group as a new group (new ids, new `groupId`, logged now) with
 * the same saved meal, name, analysis and photos; an entry as a plain entry. Returns the new entry ids.
 */
export async function pasteClipboard(
  db: UserDb,
  clip: Clipboard,
  target: { date: string; meal: number },
): Promise<string[]> {
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
