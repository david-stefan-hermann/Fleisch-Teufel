import { addDays, dateRange, diffDays, startOfWeek, type ISODate } from '@ft/shared';
import type { WeekStripPref } from '@/lib/appearance';

/**
 * The seven days of the week strip around `date`. `week`: Monday to Sunday. `recent`: windows anchored
 * at today, five days before it, today and tomorrow; a day further away lies in the window moved by a
 * multiple of 7 days, so a tap on a day of the strip never moves it.
 */
export function stripDays(date: ISODate, today: ISODate, mode: WeekStripPref): ISODate[] {
  if (mode === 'week') {
    const monday = startOfWeek(date);
    return dateRange(monday, addDays(monday, 6));
  }
  const end0 = addDays(today, 1);
  const k = Math.floor(diffDays(date, end0) / 7);
  const end = addDays(end0, -7 * k);
  return dateRange(addDays(end, -6), end);
}
