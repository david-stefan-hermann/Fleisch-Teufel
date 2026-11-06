import { addDays, today as todayOf, type ISODate } from '@ft/shared';

/** Meal slot that fits the current time: breakfast < 10:30, lunch < 15:00, dinner < 21:00, else snacks. */
export function defaultMealForNow(now = new Date()): number {
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < 10 * 60 + 30) return 0;
  if (m < 15 * 60) return 1;
  if (m < 21 * 60) return 2;
  return 3;
}

/** How long after an entry the next one goes into the same meal without asking. */
export const STICKY_MEAL_MS = 20 * 60_000;

/** What `logTargetFor` needs of a diary entry. */
export interface LoggedFood {
  date: ISODate;
  meal: number;
  loggedAt: number;
  deleted?: boolean;
}
/** What `logTargetFor` needs of an analysis that still waits (it stands in its meal as a row). */
export interface WaitingFood {
  date: ISODate;
  meal: number;
  createdAt: number;
}

/**
 * Day and meal for the next entry when no meal was chosen (the "+" of the tab bar; the "+" of a
 * meal always wins and never comes here).
 *
 * Someone who logs a meal piece by piece stays in it: when the last entry made today is younger than
 * `STICKY_MEAL_MS`, the next one goes into the same meal, whatever the clock says (also when that
 * entry was moved to another meal meanwhile: the meal it is in now counts). Over midnight the same
 * holds for an entry made before midnight for that day: the late snack still belongs to yesterday.
 * Otherwise the meal follows the time of day. Looking at a past day changes nothing of this: there
 * the shown day and the time of day decide, and entries added later to a past day never stick.
 */
export function logTargetFor({
  shownDate,
  today,
  now,
  entries,
  pending = [],
}: {
  /** The day the diary shows (or the page the "+" was tapped on). */
  shownDate: ISODate;
  today: ISODate;
  /** Epoch ms. */
  now: number;
  /** Diary entries of today and yesterday. */
  entries: readonly LoggedFood[];
  pending?: readonly WaitingFood[];
}): { date: ISODate; meal: number } {
  const byClock = defaultMealForNow(new Date(now));
  if (shownDate !== today) return { date: shownDate, meal: byClock };
  const yesterday = addDays(today, -1);
  // Made for today, or made yesterday for yesterday (not: added to yesterday today).
  const counts = (date: ISODate, at: number) =>
    date === today || (date === yesterday && todayOf(new Date(at)) === yesterday);
  const last = [
    ...entries.filter((e) => !e.deleted).map((e) => ({ date: e.date, meal: e.meal, at: e.loggedAt })),
    ...pending.map((p) => ({ date: p.date, meal: p.meal, at: p.createdAt })),
  ]
    // A minute of slack for the clock of another device; anything later is not "just now".
    .filter((c) => counts(c.date, c.at) && c.at <= now + 60_000)
    .sort((a, b) => b.at - a.at)[0];
  if (last && now - last.at < STICKY_MEAL_MS) return { date: last.date, meal: last.meal };
  return { date: today, meal: byClock };
}
