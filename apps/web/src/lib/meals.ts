import { addDays, entryMealKey, idSchema, NEW_MEAL_GAP_MS, today as todayOf, type ISODate } from '@ft/shared';
import type { MealChoice, MealPick } from '@/db/diaryMeals';
import { fmtTime } from '@/lib/format';

/** What `logTargetFor` needs of a diary entry. */
export interface LoggedFood {
  date: ISODate;
  meal: number;
  diaryMealId?: string | null;
  loggedAt: number;
  deleted?: boolean;
}
/** What `logTargetFor` needs of an analysis that still waits (it stands in its meal as a row). */
export interface WaitingFood {
  date: ISODate;
  meal: number;
  diaryMealId?: string | null;
  createdAt: number;
}

/**
 * Day and meal for the next entry when no meal was chosen (the "+" of the tab bar; the "+" of a
 * meal always wins and never comes here).
 *
 * Someone who logs a meal piece by piece stays in it: up to `NEW_MEAL_GAP_MS` after the last entry
 * the next one goes into the same meal (also when that entry was moved meanwhile: the meal it is in
 * now counts), later a new meal begins. Over midnight the same holds for an entry made before
 * midnight for that day: the late snack still belongs to yesterday. On another day than today the
 * last entry made for that day counts, so that adding to a past day does not start a meal each time.
 */
export function logTargetFor({
  shownDate,
  today,
  now,
  entries,
  pending = [],
  newMealSlot = 0,
}: {
  /** The day the diary shows (or the page the "+" was tapped on). */
  shownDate: ISODate;
  today: ISODate;
  /** Epoch ms. */
  now: number;
  /** Diary entries of today, yesterday and the shown day. */
  entries: readonly LoggedFood[];
  pending?: readonly WaitingFood[];
  /** The index a new meal of the shown day would write. */
  newMealSlot?: number;
}): { date: ISODate; meal: number; dm: string } {
  const yesterday = addDays(today, -1);
  // Today: made for today, or made yesterday for yesterday (not: added to yesterday today).
  const counts = (date: ISODate, at: number) =>
    shownDate === today
      ? date === today || (date === yesterday && todayOf(new Date(at)) === yesterday)
      : date === shownDate;
  const last = [
    ...entries.filter((e) => !e.deleted).map((e) => ({ ...e, at: e.loggedAt })),
    ...pending.map((p) => ({ ...p, at: p.createdAt })),
  ]
    // A minute of slack for the clock of another device; anything later is not "just now".
    .filter((c) => counts(c.date, c.at) && c.at <= now + 60_000)
    .sort((a, b) => b.at - a.at)[0];
  if (last && now - last.at <= NEW_MEAL_GAP_MS)
    return {
      date: last.date,
      meal: last.meal,
      dm: entryMealKey({ date: last.date, meal: last.meal, diaryMealId: last.diaryMealId ?? null }),
    };
  return { date: shownDate, meal: newMealSlot, dm: 'new' };
}

/** The `dm` search param: `new` or the id of a meal. Anything else leaves the link with its `meal` index. */
export const dmParam = (v: unknown): string | undefined =>
  idSchema.safeParse(v).success ? (v as string) : undefined;

/** One row of a meal list: what it says and what picking it means. */
export interface MealOption {
  value: string;
  name: string;
  detail: string;
  pick: MealPick;
}

/** The rows of a meal picker: the meals of the day (and the target when it is none of them), then a new one. */
export function mealOptions(choice: MealChoice): { meals: MealOption[]; next: MealOption } {
  const { current, next } = choice;
  const meals = choice.meals.map((m): MealOption => ({
    value: m.id,
    name: m.name,
    detail: fmtTime(m.eatenAt),
    pick: { meal: m.slot, dm: m.id },
  }));
  if (current.id !== 'new' && !meals.some((m) => m.value === current.id))
    meals.push({
      value: current.id,
      name: current.name,
      detail: current.eatenAt === null ? 'Neu' : fmtTime(current.eatenAt),
      pick: { meal: current.slot, dm: current.id },
    });
  return {
    meals,
    next: { value: 'new', name: 'Neue Mahlzeit', detail: next.name, pick: { meal: next.slot, dm: 'new' } },
  };
}
