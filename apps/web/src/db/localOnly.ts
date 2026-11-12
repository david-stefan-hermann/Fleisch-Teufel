/**
 * What exists only on this device and would be lost by "Gerätedaten löschen": changes and photos
 * not uploaded yet (a last upload is tried), and analyses and editor drafts, which never leave the
 * device. Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import type { UserDb } from './dexie';

export interface LocalOnly {
  /** Outbox entries (synced records not uploaded yet). */
  changes: number;
  /** Meal photos waiting for their upload. */
  photos: number;
  /** Photo analyses not logged yet (waiting, running, failed or waiting for the review). */
  analyses: number;
  /** Unsaved meal, diary group and training editors. */
  drafts: number;
}

const DRAFT_PREFIXES = ['mealDraft:', 'groupDraft:', 'trainingDraft:'];

export async function localOnlyData(db: UserDb): Promise<LocalOnly> {
  const [changes, photos, analyses, keys] = await Promise.all([
    db.outbox.count(),
    db.photos.where('uploaded').equals(0).count(),
    db.aiQueue.count(),
    db.kv.toCollection().primaryKeys(),
  ]);
  const drafts = keys.filter((k) => DRAFT_PREFIXES.some((p) => String(k).startsWith(p))).length;
  return { changes, photos, analyses, drafts };
}

/** Changes or photos a last upload could still save. */
export const hasUploads = (l: LocalOnly) => l.changes + l.photos > 0;

export const isEmpty = (l: LocalOnly) => l.changes + l.photos + l.analyses + l.drafts === 0;
