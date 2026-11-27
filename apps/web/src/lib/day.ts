import { SETTINGS_ID, nextDayStart as nextStart, today as todayAt, type ISODate } from '@ft/shared';
import { liveQuery } from 'dexie';
import type { UserDb } from '../db/dexie';

/**
 * The app's day on this device: the account's `settings.dayStartHour` (null = the default of five
 * o'clock), kept in memory so that everything that asks for "today" outside a query agrees. The
 * last known value is cached per device: the first paint after a start already has the right day.
 */
const KEY = 'ft.dayStartHour';

function readCached(): number | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  } catch {
    return null;
  }
}

let hour: number | null = readCached();
const listeners = new Set<() => void>();

/** The account's setting as this device knows it (null = default). */
export function dayStartHour(): number | null {
  return hour;
}

export function setDayStartHour(value: number | null): void {
  if (value === hour) return;
  hour = value;
  try {
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(value));
  } catch {
    // Private mode: the value lives as long as the page.
  }
  for (const fn of [...listeners]) fn();
}

export function subscribeDayStart(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The app's day of a moment (now): the calendar day, or the one before until the day starts. */
export function today(now: Date = new Date()): ISODate {
  return todayAt(now, hour);
}

/** The moment the app's day of `now` ends. */
export function nextDayStart(now: Date = new Date()): Date {
  return nextStart(now, hour);
}

/** Follows the settings record of the signed-in account. Returns the stop function. */
export function watchDayStart(db: UserDb): () => void {
  const sub = liveQuery(() => db.settings.get(SETTINGS_ID)).subscribe({
    next: (s) => setDayStartHour(s && !s.deleted ? (s.dayStartHour ?? null) : null),
    error: () => {},
  });
  return () => sub.unsubscribe();
}
