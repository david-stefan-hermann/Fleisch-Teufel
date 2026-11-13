/** Body weight writes outside the weight page (the assistant). Free of `@/` aliases (API tests import `db/*`). */
import { dayId, type ISODate } from '@ft/shared';
import type { UndoStep, UserDb } from './dexie';
import { upsertRecord } from './write';

/**
 * Logs or corrects the weight of a day (one record per day, `w:<date>`; a deleted one comes back
 * with the new value). Returns the undo step: the record goes again when there was none, else it
 * gets its previous value and state back (also a tombstone).
 */
export async function setWeight(db: UserDb, date: ISODate, kg: number): Promise<UndoStep[]> {
  const id = dayId.weight(date);
  return db.transaction('rw', [db.weightEntries, db.outbox], async () => {
    const prev = await db.weightEntries.get(id);
    await upsertRecord(db, 'weightEntries', id, () => ({ id, date, kg: Math.round(kg * 100) / 100 }));
    return prev
      ? [
          {
            kind: 'patch',
            table: 'weightEntries',
            id,
            fields: { kg: prev.kg, deleted: prev.deleted, purgedAt: prev.purgedAt ?? null },
          },
        ]
      : [{ kind: 'delete', table: 'weightEntries', ids: [id] }];
  });
}
