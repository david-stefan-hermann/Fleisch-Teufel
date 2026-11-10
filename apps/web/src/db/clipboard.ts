/**
 * The diary clipboard: one copied diary row (a single entry or a whole group) or a whole diary meal
 * ("Kopieren" in its ⋯ menu) on this device, filled by swiping a row to the right and pasted with the
 * paste icon of a diary meal. Lives in `kv` (not synced),
 * survives a reload and stays filled after pasting until it is cleared or something else is copied.
 *
 * It holds a snapshot (item fields, group fields, photo ids), no references to the source entries: the
 * source may be changed or deleted afterwards. Photos are immutable, so their ids are shared, not copied.
 *
 * Trainings go into the same clipboard (`TrainingClipboard`, swipe right on a training row): only the
 * training card pastes them, only meals paste food.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import {
  get,
  groupTrainingEntries,
  isAutoTrainingKcal,
  isStepsEntry,
  N,
  photoIdsOf,
  trainingKcal,
  type ExerciseEntry,
  type FoodEntry,
  type Intensity,
} from '@ft/shared';
import type { UserDb } from './dexie';
import {
  diaryParts,
  entriesToMealItems,
  type TrainingToLog,
  entryToItem,
  firstPhotoId,
  logParts,
  partsItems,
  type DiaryItem,
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
  /** A single plain entry keeps the note of a quick entry. */
  items: DiaryItem[];
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
  /** Only `meal`: its rows, logged again with the same structure. `items` holds all their ingredients. */
  parts?: DiaryPart[];
  copiedAt: number;
}

/** One copied training: what it was logged with, as a snapshot. */
export interface TrainingPart {
  typeKey: string;
  name: string;
  minutes: number;
  intensity: Intensity;
  met: number;
  note: string | null;
  kcal: number;
  /** The kcal were computed (they follow the weight of the day pasted into); false: typed, they stay. */
  auto: boolean;
  templateId: string | null;
  /** Parts with the same mark were logged together (a saved training) and are pasted together again. */
  group: string | null;
}

/** Copied trainings: a single one, or the activities of a saved training logged together. */
export interface TrainingClipboard {
  kind: 'training';
  name: string;
  parts: TrainingPart[];
  copiedAt: number;
}

/** Whatever the clipboard holds: food (`Clipboard`) or trainings. */
export type AnyClipboard = Clipboard | TrainingClipboard;

export const CLIPBOARD_KEY = 'clipboard';

export async function readClipboard(db: UserDb): Promise<AnyClipboard | null> {
  const row = await db.kv.get(CLIPBOARD_KEY);
  return (row?.value as AnyClipboard | undefined) ?? null;
}

/** The clipboard when it holds food (what meals paste), else null. */
export const foodClipboard = (clip: AnyClipboard | null | undefined): Clipboard | null =>
  clip && clip.kind !== 'training' ? clip : null;

/** The clipboard when it holds trainings (what the training card pastes), else null. */
export const trainingClipboard = (clip: AnyClipboard | null | undefined): TrainingClipboard | null =>
  clip?.kind === 'training' ? clip : null;

/** Training entries as parts to log again (diary order, a package keeps its mark). */
export function trainingParts(entries: readonly ExerciseEntry[]): TrainingPart[] {
  // Steps come from Apple Health once per day: they are never copied.
  return groupTrainingEntries(entries.filter((e) => !isStepsEntry(e))).flatMap((row) =>
    (row.kind === 'entry' ? [row.entry] : row.entries).map((e) => ({
      typeKey: e.typeKey,
      name: e.name,
      minutes: e.minutes,
      intensity: e.intensity,
      met: e.met,
      note: e.note ?? null,
      kcal: e.kcal,
      auto: isAutoTrainingKcal(e),
      templateId: e.templateId ?? null,
      group: row.kind === 'group' ? row.groupId : null,
    })),
  );
}

/** Copies trainings (a row or a package of the training card); replaces what was copied before. */
export async function copyTrainingToClipboard(
  db: UserDb,
  name: string,
  entries: readonly ExerciseEntry[],
): Promise<TrainingClipboard> {
  const clip: TrainingClipboard = {
    kind: 'training',
    name: name.trim().slice(0, 120),
    parts: trainingParts(entries),
    copiedAt: Date.now(),
  };
  await db.kv.put({ key: CLIPBOARD_KEY, value: clip });
  return clip;
}

/**
 * Parts as trainings to log on another day: computed kcal again with that day's weight (the stored
 * MET and minutes), typed kcal as they are; a package gets a new group (`logTrainings` gives each
 * mark a fresh `groupId`).
 */
export function copiesOf(parts: readonly TrainingPart[], weightKg: number): TrainingToLog[] {
  return parts
    .filter((p) => !isStepsEntry(p))
    .map((p) => ({
      typeKey: p.typeKey,
      name: p.name,
      minutes: p.minutes,
      intensity: p.intensity,
      met: p.met,
      weightKg,
      kcal: p.auto ? trainingKcal(p.met, weightKg, p.minutes) : p.kcal,
      note: p.note,
      templateId: p.templateId,
      ...(p.group && { group: p.group }),
    }));
}

/** kcal of the parts as they would be logged with `weightKg`. */
export const trainingPartsKcal = (parts: readonly TrainingPart[], weightKg: number) =>
  copiesOf(parts, weightKg).reduce((s, r) => s + r.kcal, 0);

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
    items: kind === 'entry' && first ? [entryToItem(first)] : entriesToMealItems(entries),
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
