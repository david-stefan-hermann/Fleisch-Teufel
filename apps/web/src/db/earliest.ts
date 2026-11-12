import type { ISODate } from '@ft/shared';
import type { Table } from 'dexie';
import type { UserDb } from './dexie';

/** The first live record of a table indexed by `date`. */
const firstOf = <T extends { date: ISODate; deleted: boolean }>(table: Table<T, string>) =>
  table
    .orderBy('date')
    .filter((r) => !r.deleted)
    .first();

/**
 * The first day with a live record of any kind (food, weight, training, day note), or null on an
 * empty device. The start of the "Alles" export of the daily values: earlier weights and trainings
 * belong in it too, not only the days from the first food entry on.
 */
export async function earliestDate(db: UserDb): Promise<ISODate | null> {
  const firsts = await Promise.all([
    firstOf(db.foodEntries),
    firstOf(db.weightEntries),
    firstOf(db.exerciseEntries),
    firstOf(db.dayNotes),
  ]);
  const dates = firsts.flatMap((r) => (r ? [r.date] : []));
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
}
