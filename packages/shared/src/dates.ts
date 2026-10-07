/**
 * Calendar-date helpers. A diary day is a plain local calendar date string `YYYY-MM-DD`
 * (no time zone), so a day logged in Berlin stays the same day when viewed elsewhere.
 * Weekday indices are ISO-like: 0 = Monday … 6 = Sunday.
 */

export type ISODate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): value is ISODate {
  if (!ISO_DATE.test(value)) return false;
  const d = parseISODate(value);
  return toISODate(d) === value;
}

/** Local calendar date of a JS Date. */
export function toISODate(date: Date): ISODate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parses `YYYY-MM-DD` as local midnight (noon would also work; midnight keeps comparisons simple). */
export function parseISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function today(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from `a` to `b` (b − a), DST-safe. */
export function diffDays(a: ISODate, b: ISODate): number {
  const ua = Date.UTC(...splitDate(a));
  const ub = Date.UTC(...splitDate(b));
  return Math.round((ub - ua) / 86_400_000);
}

function splitDate(value: ISODate): [number, number, number] {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return [y, m - 1, d];
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: ISODate): number {
  return (parseISODate(date).getDay() + 6) % 7;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekdayIndex(date));
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: ISODate): ISODate {
  const d = parseISODate(startOfMonth(date));
  d.setMonth(d.getMonth() + 1, 0);
  return toISODate(d);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** Age in full years on `on`. */
export function ageOn(birthDate: ISODate, on: ISODate): number {
  const [by, bm, bd] = splitDate(birthDate);
  const [y, m, d] = splitDate(on);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export const WEEKDAYS_SHORT_DE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const WEEKDAYS_LONG_DE = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;
