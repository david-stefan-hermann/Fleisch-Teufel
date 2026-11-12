import { dayId, type DayNote, type ISODate } from '@ft/shared';
import type { UserDb } from './dexie';
import { upsertRecord } from './write';

/**
 * Writes the text of a day's note, keeping its "Tag abgeschlossen" state (read in the transaction).
 * The same text as stored is not written again (a flush of text typed and taken back is a no-op).
 */
export async function saveDayNote(db: UserDb, date: ISODate, note: string): Promise<void> {
  await db.transaction('rw', [db.dayNotes, db.outbox], async () => {
    const prev = await db.dayNotes.get(dayId.note(date));
    if ((prev && !prev.deleted ? prev.note : '') === note) return;
    await upsertRecord(db, 'dayNotes', dayId.note(date), () => ({
      id: dayId.note(date),
      date,
      note,
      completedAt: prev?.completedAt ?? null,
    }));
  });
}

/**
 * Days before `before` that have food entries but are not closed ("Tag abgeschlossen"), sorted,
 * without duplicates. Pure; `loggedDates` may contain days whose entries are all deleted.
 */
export function openDays(
  loggedDates: readonly ISODate[],
  notes: readonly Pick<DayNote, 'date' | 'completedAt'>[],
  before: ISODate,
): ISODate[] {
  const closed = new Set(notes.filter((n) => n.completedAt).map((n) => n.date));
  return [...new Set(loggedDates)].filter((d) => d < before && !closed.has(d)).sort();
}

/**
 * Open days before `before` (see `openDays`) with at least one entry that is not deleted. Reads only
 * dates below `before`, so typing in the shown day's note or logging today does not run it again.
 */
export async function openPastDays(db: UserDb, before: ISODate): Promise<ISODate[]> {
  const [dates, notes] = await Promise.all([
    db.foodEntries.where('date').below(before).uniqueKeys(),
    db.dayNotes.where('date').below(before).toArray(),
  ]);
  const candidates = openDays(dates as ISODate[], notes, before);
  if (candidates.length === 0) return [];
  // Tombstones keep their date: a day whose entries are all deleted is not open.
  const live = new Set<ISODate>();
  await db.foodEntries
    .where('date')
    .anyOf(candidates)
    .filter((e) => !e.deleted)
    .each((e) => void live.add(e.date));
  return candidates.filter((d) => live.has(d));
}

/**
 * Closes these days in one transaction, keeping their note texts. Days another device closed in the
 * meantime are skipped. Returns the days closed here (for undo).
 */
export async function completeDays(
  db: UserDb,
  dates: readonly ISODate[],
  now = Date.now(),
): Promise<ISODate[]> {
  const closed: ISODate[] = [];
  await db.transaction('rw', [db.dayNotes, db.outbox], async () => {
    for (const date of dates) {
      const prev = await db.dayNotes.get(dayId.note(date));
      if (prev?.completedAt && !prev.deleted) continue;
      await upsertRecord(db, 'dayNotes', dayId.note(date), () => ({
        id: dayId.note(date),
        date,
        note: prev?.note ?? '',
        completedAt: now,
      }));
      closed.push(date);
    }
  });
  return closed;
}

/** Undo of `completeDays`: opens exactly these days again, the note texts stay. */
export async function reopenDays(db: UserDb, dates: readonly ISODate[]): Promise<void> {
  await db.transaction('rw', [db.dayNotes, db.outbox], async () => {
    for (const date of dates) {
      const prev = await db.dayNotes.get(dayId.note(date));
      if (!prev?.completedAt) continue;
      await upsertRecord(db, 'dayNotes', dayId.note(date), () => ({
        id: dayId.note(date),
        date,
        note: prev.note,
        completedAt: null,
      }));
    }
  });
}
