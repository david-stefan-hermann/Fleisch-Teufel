/**
 * Trash ("Papierkorb"): deleted weight entries, steps, saved meals and saved trainings. Deletes are soft
 * (tombstones that sync), so the trash is just a view on them; restoring is `restoreRecord`.
 * "Endgültig löschen" does not remove the tombstone (the sync protocol has no purge): it sets the synced
 * `purgedAt`, which hides the record from the trash on every device.
 */
import {
  isStepsEntry,
  type ExerciseEntry,
  type ExerciseTemplate,
  type Meal,
  type WeightEntry,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { patchRecord, type PurgeableTable } from './write';

/** A deleted record that is still shown in the trash. */
const inTrash = (r: { deleted: boolean; purgedAt?: number | null }) => r.deleted && !r.purgedAt;

/** Deleted weight entries, most recently deleted first. */
export async function trashedWeights(db: UserDb): Promise<WeightEntry[]> {
  return db.weightEntries.filter(inTrash).reverse().sortBy('updatedAt');
}

/**
 * Deleted steps entries (Apple Health), most recently deleted first. They stay deleted when the next
 * import comes; restoring brings the day back and the import updates it again.
 */
export async function trashedSteps(db: UserDb): Promise<ExerciseEntry[]> {
  return db.exerciseEntries
    .filter((e) => inTrash(e) && isStepsEntry(e))
    .reverse()
    .sortBy('updatedAt');
}

/** Deleted saved meals, most recently deleted first. */
export async function trashedMeals(db: UserDb): Promise<Meal[]> {
  return db.meals.filter(inTrash).reverse().sortBy('updatedAt');
}

/** Deleted saved trainings, most recently deleted first. */
export async function trashedTrainings(db: UserDb): Promise<ExerciseTemplate[]> {
  return db.exerciseTemplates.filter(inTrash).reverse().sortBy('updatedAt');
}

/** Number of items in the trash (weights, steps, meals and saved trainings). */
export async function trashCount(db: UserDb): Promise<number> {
  const [w, s, m, t] = await Promise.all([
    db.weightEntries.filter(inTrash).count(),
    db.exerciseEntries.filter((r) => inTrash(r) && isStepsEntry(r)).count(),
    db.meals.filter(inTrash).count(),
    db.exerciseTemplates.filter(inTrash).count(),
  ]);
  return w + s + m + t;
}

export interface TrashItem {
  table: PurgeableTable;
  id: string;
}

/**
 * Removes records from the trash for good ("Endgültig löschen"): each gets `purgedAt` (a normal synced
 * write) in one transaction. Records restored or purged in the meantime (e.g. by a pull) are skipped.
 * Returns how many were purged.
 */
export async function purgeRecords(db: UserDb, items: readonly TrashItem[]): Promise<number> {
  const tables = [...new Set(items.map((i) => i.table))];
  if (tables.length === 0) return 0;
  return db.transaction('rw', [...tables.map((t) => db.syncTable(t)), db.outbox], async () => {
    let purged = 0;
    for (const { table, id } of items) {
      const record = await db.syncTable(table).get(id);
      if (!record || !inTrash(record as { deleted: boolean; purgedAt?: number | null })) continue;
      await patchRecord(db, table, id, { purgedAt: Date.now() + db.clockOffset } as never);
      purged++;
    }
    return purged;
  });
}

/** Empties the whole trash ("Papierkorb leeren"); returns how many records were purged. */
export async function purgeTrash(db: UserDb): Promise<number> {
  const [weights, steps, meals, trainings] = await Promise.all([
    trashedWeights(db),
    trashedSteps(db),
    trashedMeals(db),
    trashedTrainings(db),
  ]);
  const of = (table: PurgeableTable, rows: readonly { id: string }[]) =>
    rows.map(({ id }) => ({ table, id }));
  return purgeRecords(db, [
    ...of('weightEntries', weights),
    ...of('exerciseEntries', steps),
    ...of('meals', meals),
    ...of('exerciseTemplates', trainings),
  ]);
}
