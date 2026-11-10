/**
 * Trash ("Papierkorb"): deleted weight entries, steps, saved meals and saved trainings. Deletes are soft (tombstones that
 * sync and are never purged), so the trash is just a view on them; restoring is `restoreRecord`.
 * There is deliberately no "delete forever": the sync protocol has no purge, and a tombstone costs
 * a few bytes.
 */
import {
  isStepsEntry,
  type ExerciseEntry,
  type ExerciseTemplate,
  type Meal,
  type WeightEntry,
} from '@ft/shared';
import type { UserDb } from './dexie';

/** Deleted weight entries, most recently deleted first. */
export async function trashedWeights(db: UserDb): Promise<WeightEntry[]> {
  return db.weightEntries
    .filter((w) => w.deleted)
    .reverse()
    .sortBy('updatedAt');
}

/**
 * Deleted steps entries (Apple Health), most recently deleted first. They stay deleted when the next
 * import comes; restoring brings the day back and the import updates it again.
 */
export async function trashedSteps(db: UserDb): Promise<ExerciseEntry[]> {
  return db.exerciseEntries
    .filter((e) => e.deleted && isStepsEntry(e))
    .reverse()
    .sortBy('updatedAt');
}

/** Deleted saved meals, most recently deleted first. */
export async function trashedMeals(db: UserDb): Promise<Meal[]> {
  return db.meals
    .filter((m) => m.deleted)
    .reverse()
    .sortBy('updatedAt');
}

/** Deleted saved trainings, most recently deleted first. */
export async function trashedTrainings(db: UserDb): Promise<ExerciseTemplate[]> {
  return db.exerciseTemplates
    .filter((t) => t.deleted)
    .reverse()
    .sortBy('updatedAt');
}

/** Number of items in the trash (weights, steps, meals and saved trainings). */
export async function trashCount(db: UserDb): Promise<number> {
  const [w, s, m, t] = await Promise.all([
    db.weightEntries.filter((r) => r.deleted).count(),
    db.exerciseEntries.filter((r) => r.deleted && isStepsEntry(r)).count(),
    db.meals.filter((r) => r.deleted).count(),
    db.exerciseTemplates.filter((r) => r.deleted).count(),
  ]);
  return w + s + m + t;
}
