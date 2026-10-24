import { dayId, type ISODate } from '@ft/shared';
import type { UserDb } from './dexie';
import { saveRecord } from './write';

/** Writes the text of a day's note, keeping its "Tag abgeschlossen" state (read in the transaction). */
export async function saveDayNote(db: UserDb, date: ISODate, note: string): Promise<void> {
  await db.transaction('rw', [db.dayNotes, db.outbox], async () => {
    const prev = await db.dayNotes.get(dayId.note(date));
    await saveRecord(db, 'dayNotes', {
      id: dayId.note(date),
      date,
      note,
      completedAt: prev?.completedAt ?? null,
    });
  });
}
