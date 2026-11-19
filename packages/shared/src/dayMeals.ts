/**
 * The meals of a day, built when a day is read. Entries of days from before meals had times keep
 * `diaryMealId: null` and form one meal per `meal` index that exists only here (id `dm:<date>:<index>`).
 * Pure: no clock and no database, times are read in the device's time zone.
 */
import { addDays, parseISODate, toISODate, type ISODate } from './dates.js';
import { dayId, type DiaryMeal, type FoodEntry } from './schemas.js';

/** A new meal starts when the last entry is older than this. */
export const NEW_MEAL_GAP_MS = 30 * 60_000;
export const EXTRA_MEAL_NAME = 'Weitere Mahlzeit';
/** Until this hour a time after midnight can still belong to the evening before. */
export const NIGHT_END_HOUR = 5;

/** Hour and minute a meal gets when nothing says when it was eaten, by its position. */
const TYPICAL_TIMES = [
  [8, 0],
  [12, 30],
  [18, 30],
  [15, 30],
] as const;
const TYPICAL_EXTRA_TIME = [21, 0] as const;

export interface DayMeal<P = unknown> {
  id: string;
  date: ISODate;
  name: string;
  eatenAt: number;
  slot: number;
  /** No record yet (`dm:<date>:<slot>`), or a record that has not arrived. */
  virtual: boolean;
  /** The person set the time. */
  timeEdited: boolean;
  /** Eaten after midnight, on the calendar day after `date`. */
  night: boolean;
  entries: FoodEntry[];
  pending: P[];
}

/** Something waiting to become entries of a meal (an analysis in the queue). */
export interface PendingMealItem<P> {
  value: P;
  meal: number;
  /** Queued for this meal; null: found through `meal` like an entry without a meal. */
  diaryMealId: string | null;
  /** Name and time of a meal the item will create with its first entry. */
  name?: string | null;
  eatenAt?: number | null;
  at: number;
}

export interface BuildDayMealsInput<P> {
  date: ISODate;
  /** All entries of the day, tombstones included: they keep the time of a meal without a record. */
  entries: readonly FoodEntry[];
  records: readonly DiaryMeal[];
  pending?: readonly PendingMealItem<P>[];
  /** Names of meals without a record: `legacyMealNames ?? mealNames`. */
  names: readonly string[];
}

const fold = (name: string) => name.trim().toLocaleLowerCase('de');

/** Whether a moment belongs to the day: on its calendar day or in the night after it. */
function fitsDay(date: ISODate, at: number): boolean {
  const d = new Date(at);
  const day = toISODate(d);
  return day === date || (day === addDays(date, 1) && d.getHours() < NIGHT_END_HOUR);
}

export function isNightOf(date: ISODate, eatenAt: number): boolean {
  const d = new Date(eatenAt);
  return toISODate(d) === addDays(date, 1) && d.getHours() < NIGHT_END_HOUR;
}

export function canBeNight(hour: number): boolean {
  return hour < NIGHT_END_HOUR;
}

export function eatenAtOf(date: ISODate, hour: number, minute: number, night = false): number {
  const d = parseISODate(night ? addDays(date, 1) : date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
}

export function typicalEatenAt(date: ISODate, position: number): number {
  const [hour, minute] = TYPICAL_TIMES[position] ?? TYPICAL_EXTRA_TIME;
  return eatenAtOf(date, hour, minute);
}

/** The time of a new meal: now while logging on that day, else the typical time of its name. */
export function newMealEatenAt(date: ISODate, name: string, names: readonly string[], at: number): number {
  if (fitsDay(date, at)) return at;
  return typicalEatenAt(
    date,
    names.findIndex((n) => fold(n) === fold(name)),
  );
}

/** The first of the standard names the day does not have yet. */
export function nextMealName(names: readonly string[], day: readonly { name: string }[]): string {
  const taken = new Set(day.map((m) => fold(m.name)));
  return names.find((n) => !taken.has(fold(n))) ?? EXTRA_MEAL_NAME;
}

/** The index a new meal writes into `foodEntries.meal`: its name's, else the first free one, else the last. */
export function slotForNewMeal(
  name: string,
  names: readonly string[],
  day: readonly { slot: number }[],
): number {
  const taken = new Set(day.map((m) => m.slot));
  const own = names.findIndex((n) => fold(n) === fold(name));
  if (own >= 0 && !taken.has(own)) return own;
  const free = names.findIndex((_, slot) => !taken.has(slot));
  return free >= 0 ? free : names.length - 1;
}

export function entryMealKey(e: Pick<FoodEntry, 'date' | 'meal' | 'diaryMealId'>): string {
  return e.diaryMealId ?? dayId.diaryMeal(e.date, e.meal);
}

/** Minutes since the start of the day; the night after it counts behind 23:59. */
function minuteOfDay(meal: { eatenAt: number; night: boolean }): number {
  const d = new Date(meal.eatenAt);
  return d.getHours() * 60 + d.getMinutes() + (meal.night ? 24 * 60 : 0);
}

/** The meal of another day that fits best: the same name, else the nearest time. */
export function closestMeal<M extends { name: string; eatenAt: number; night: boolean }>(
  target: { name: string; eatenAt: number; night: boolean },
  meals: readonly M[],
): M | undefined {
  const named = meals.filter((m) => fold(m.name) === fold(target.name));
  const minute = minuteOfDay(target);
  let best: M | undefined;
  for (const m of named.length ? named : meals) {
    if (!best || Math.abs(minuteOfDay(m) - minute) < Math.abs(minuteOfDay(best) - minute)) best = m;
  }
  return best;
}

interface Draft<P> extends DayMeal<P> {
  /** Times of entries that say when a meal without a record began. */
  times: number[];
}

/**
 * A day from before meals had times keeps the order of its four slots until the person sets a time
 * there or a new meal joins it. Everything else follows the clock.
 */
export function usesSlotOrder(meals: readonly Pick<DayMeal, 'id' | 'timeEdited'>[]): boolean {
  return meals.every((m) => m.id.startsWith('dm:') && !m.timeEdited);
}

export function buildDayMeals<P = unknown>(input: BuildDayMealsInput<P>): DayMeal<P>[] {
  const { date, names } = input;
  const records = input.records.filter((r) => r.date === date);
  const byId = new Map(records.map((r) => [r.id, r]));
  const drafts = new Map<string, Draft<P>>();

  const draftOf = (id: string, make: () => Omit<Draft<P>, 'entries' | 'pending' | 'times' | 'night'>) => {
    let d = drafts.get(id);
    if (!d) {
      const made = make();
      d = { ...made, night: false, entries: [], pending: [], times: [] };
      drafts.set(id, d);
    }
    return d;
  };
  const ofRecord = (r: DiaryMeal) =>
    draftOf(r.id, () => ({
      id: r.id,
      date,
      name: r.name,
      eatenAt: r.eatenAt,
      slot: r.slot,
      virtual: false,
      timeEdited: r.timeEdited,
    }));
  const unrecorded = (id: string, slot: number, name?: string | null, eatenAt?: number | null) =>
    draftOf(id, () => ({
      id,
      date,
      name: name ?? names[slot] ?? EXTRA_MEAL_NAME,
      eatenAt: eatenAt ?? Number.NaN,
      slot,
      virtual: true,
      timeEdited: false,
    }));

  /** The meal of an index for something that names no meal of its own. */
  const bySlot = (slot: number, at: number) => {
    const live = records.filter((r) => !r.deleted && r.slot === slot).sort((a, b) => a.eatenAt - b.eatenAt);
    const before = live.filter((r) => r.eatenAt <= at).at(-1);
    const found = before ?? live[0];
    return found ? ofRecord(found) : unrecorded(dayId.diaryMeal(date, slot), slot);
  };

  const place = (
    ref: string | null,
    slot: number,
    at: number,
    name?: string | null,
    eatenAt?: number | null,
  ) => {
    if (!ref) return bySlot(slot, at);
    const record = byId.get(ref);
    if (record) return record.slot === slot ? ofRecord(record) : bySlot(slot, at);
    return unrecorded(ref, slot, name, eatenAt);
  };

  const dayEntries = input.entries.filter((e) => e.date === date);
  const live = dayEntries
    .filter((e) => !e.deleted)
    .sort((a, b) => a.loggedAt - b.loggedAt || a.id.localeCompare(b.id));
  for (const e of live) {
    const meal = place(e.diaryMealId ?? null, e.meal, e.loggedAt);
    meal.entries.push(e);
    meal.times.push(e.loggedAt);
  }
  for (const p of input.pending ?? []) {
    place(p.diaryMealId, p.meal, p.at, p.name, p.eatenAt).pending.push(p.value);
  }

  const meals = [...drafts.values()].map(({ times, ...meal }): DayMeal<P> => {
    let eatenAt = meal.eatenAt;
    if (meal.virtual && Number.isNaN(eatenAt)) {
      // Deleted entries count: removing the first entry must not move the meal.
      const old = meal.id.startsWith('dm:')
        ? dayEntries.filter((e) => e.meal === meal.slot && !e.diaryMealId).map((e) => e.loggedAt)
        : [];
      const fitting = [...old, ...times].filter((at) => fitsDay(date, at));
      eatenAt = fitting.length ? Math.min(...fitting) : typicalEatenAt(date, meal.slot);
    }
    return { ...meal, eatenAt, night: isNightOf(date, eatenAt) };
  });

  const slotOrder = usesSlotOrder(meals);
  return meals.sort(
    (a, b) => (slotOrder ? 0 : a.eatenAt - b.eatenAt) || a.slot - b.slot || a.id.localeCompare(b.id),
  );
}
