/**
 * The meals of a day on this device: reading them (`buildDayMeals` in shared holds the rules), choosing
 * where the next entries go, and the changes a person makes to a meal.
 */
import {
  buildDayMeals,
  dayId,
  EXTRA_MEAL_NAME,
  newMealEatenAt,
  nextMealName,
  SETTINGS_ID,
  slotForNewMeal,
  uuidv7,
  DEFAULT_MEAL_NAMES,
  type DayMeal,
  type DiaryMeal,
  type FoodEntry,
  type ISODate,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { saveRecord, patchRecord, upsertRecord } from './write';

/** Where the next entries go. `{ date, meal }` alone still means the old slot. */
export interface LogTarget {
  date: ISODate;
  meal: number;
  diaryMealId?: string | null;
  /** Written with the first entry when the meal has no record yet. */
  create?: { name: string; eatenAt: number } | null;
}

/** A meal as a link or a form names it: `dm` is its id, or `new` for the next meal of the day. */
export interface MealRef {
  date: ISODate;
  meal: number;
  dm?: string;
  /** The name of a new meal, instead of the next automatic one. */
  name?: string;
}

/** The meal a page logs into, as its URL and its picker hold it. */
export type MealPick = Pick<MealRef, 'meal' | 'dm'>;

/** What a meal picker shows: the meals of the day, the one picked and the one that would come next. */
export interface MealChoice {
  meals: DayMeal[];
  current: {
    /** The id of the meal, `new` for the next meal of the day. */
    id: string;
    name: string;
    slot: number;
    /** Null while the meal has no entry yet. */
    eatenAt: number | null;
  };
  next: { name: string; slot: number };
}

/** What an entry was attached to before a move, for "Rückgängig". */
export type EntryMealPlace = Pick<FoodEntry, 'id' | 'meal' | 'diaryMealId'>;

async function mealNames(db: UserDb) {
  const settings = await db.settings.get(SETTINGS_ID);
  const standard = settings?.mealNames ?? [...DEFAULT_MEAL_NAMES];
  return { standard, unrecorded: settings?.legacyMealNames ?? standard };
}

export async function readDay(db: UserDb, date: ISODate): Promise<DayMeal[]> {
  const [entries, records, names] = await Promise.all([
    db.foodEntries.where('date').equals(date).toArray(),
    db.diaryMeals.where('date').equals(date).toArray(),
    mealNames(db),
  ]);
  return buildDayMeals({ date, entries, records, names: names.unrecorded });
}

/** The meal an entry without a meal of its own joins at `at` (see `buildDayMeals`). */
function mealOfSlot(day: readonly DayMeal[], slot: number, at: number): DayMeal | undefined {
  const ofSlot = day.filter((m) => m.slot === slot).sort((a, b) => a.eatenAt - b.eatenAt);
  const recorded = ofSlot.filter((m) => !m.virtual);
  const from = recorded.length > 0 ? recorded : ofSlot;
  return from.filter((m) => m.eatenAt <= at).at(-1) ?? from[0];
}

/** The next automatic meal of a day: its name and the index its entries write. */
export async function readNextMeal(db: UserDb, date: ISODate): Promise<MealChoice['next']> {
  const [day, { standard }] = await Promise.all([readDay(db, date), mealNames(db)]);
  const name = nextMealName(standard, day);
  return { name, slot: slotForNewMeal(name, standard, day) };
}

/** Resolves a picked meal the way `prepareMealTarget` will, for showing it. */
export async function readMealChoice(
  db: UserDb,
  { date, meal, dm }: MealRef,
  at = Date.now(),
): Promise<MealChoice> {
  const [meals, next, { unrecorded }] = await Promise.all([
    readDay(db, date),
    readNextMeal(db, date),
    mealNames(db),
  ]);
  const shownMeal = (m: DayMeal): MealChoice['current'] => ({
    id: m.id,
    name: m.name,
    slot: m.slot,
    eatenAt: m.eatenAt,
  });
  if (dm === 'new') return { meals, next, current: { id: 'new', ...next, eatenAt: null } };
  const shown = dm ? meals.find((m) => m.id === dm) : undefined;
  if (shown) return { meals, next, current: shownMeal(shown) };
  const record = dm ? await db.diaryMeals.get(dm) : undefined;
  if (record) {
    const { id, name, slot, eatenAt } = record;
    return { meals, next, current: { id, name, slot, eatenAt } };
  }
  const slot = (dm ? unrecordedSlot(dm) : null) ?? meal;
  const joined = mealOfSlot(meals, slot, at);
  if (joined) return { meals, next, current: shownMeal(joined) };
  const current = {
    id: dayId.diaryMeal(date, slot),
    name: unrecorded[slot] ?? EXTRA_MEAL_NAME,
    slot,
    eatenAt: null,
  };
  return { meals, next, current };
}

/** Settles the target before the write transaction starts: it may only wait for IndexedDB. */
export async function prepareMealTarget(db: UserDb, ref: MealRef, at = Date.now()): Promise<LogTarget> {
  const { date, meal, dm } = ref;
  if (!dm) return { date, meal, diaryMealId: null };
  const day = await readDay(db, date);
  if (dm === 'new') {
    const { standard } = await mealNames(db);
    const name = ref.name?.trim() || nextMealName(standard, day);
    return {
      date,
      meal: slotForNewMeal(name, standard, day),
      diaryMealId: uuidv7(),
      create: { name, eatenAt: newMealEatenAt(date, name, standard, at) },
    };
  }
  const shown = day.find((m) => m.id === dm);
  // A meal without a record stays without one: its entries find it through their index.
  if (shown)
    return { date, meal: shown.slot, diaryMealId: shown.virtual && unrecordedSlot(dm) !== null ? null : dm };
  const record = await db.diaryMeals.get(dm);
  if (record) return { date, meal: record.slot, diaryMealId: record.id };
  return { date, meal: unrecordedSlot(dm) ?? meal, diaryMealId: null };
}

/** The id of the meal a target writes into. */
export function mealIdOf(target: Pick<LogTarget, 'date' | 'meal' | 'diaryMealId'>): string {
  return target.diaryMealId ?? dayId.diaryMeal(target.date, target.meal);
}

/** The index in a `dm:<date>:<index>` id; null for any other id. */
function unrecordedSlot(id: string): number | null {
  const match = /^dm:[^:]+:(\d)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** Inside the write transaction: creates the meal of the target if needed, gives the entry's fields. */
export async function applyLogTarget(
  db: UserDb,
  target: LogTarget,
): Promise<{ meal: number; diaryMealId: string | null }> {
  const diaryMealId = target.diaryMealId ?? null;
  if (diaryMealId && target.create && !(await db.diaryMeals.get(diaryMealId))) {
    await saveRecord(db, 'diaryMeals', {
      id: diaryMealId,
      date: target.date,
      name: target.create.name,
      eatenAt: target.create.eatenAt,
      slot: target.meal,
      timeEdited: false,
    });
  }
  return { meal: target.meal, diaryMealId };
}

function recordOf(meal: DayMeal): Omit<DiaryMeal, 'updatedAt' | 'deleted'> {
  const { id, date, name, eatenAt, slot, timeEdited } = meal;
  return { id, date, name, eatenAt, slot, timeEdited };
}

/** Writes down a meal that exists only through its entries, so its name and time stay as they are. */
async function keepMeal(db: UserDb, meal: DayMeal): Promise<void> {
  if (unrecordedSlot(meal.id) !== null && !(await db.diaryMeals.get(meal.id))) {
    await saveRecord(db, 'diaryMeals', recordOf(meal));
  }
}

/** Moves entries into a meal of their day. Returns where the moved ones were. */
export async function moveEntriesToDiaryMeal(
  db: UserDb,
  ids: readonly string[],
  target: DayMeal,
): Promise<EntryMealPlace[]> {
  return db.transaction('rw', [db.foodEntries, db.diaryMeals, db.settings, db.outbox], async () => {
    const day = await readDay(db, target.date);
    const moved: EntryMealPlace[] = [];
    for (const id of ids) {
      const prev = await db.foodEntries.get(id);
      if (!prev || prev.deleted) continue;
      if (prev.meal === target.slot && prev.diaryMealId === target.id) continue;
      const source = day.find((m) => m.entries.some((e) => e.id === id));
      if (source?.id === target.id) continue;
      if (source) await keepMeal(db, source);
      await keepMeal(db, target);
      moved.push({ id, meal: prev.meal, diaryMealId: prev.diaryMealId ?? null });
      await patchRecord(db, 'foodEntries', id, { meal: target.slot, diaryMealId: target.id });
    }
    return moved;
  });
}

/**
 * Inside the write transaction of an edited entry whose meal was changed in its form: both meals keep
 * their name and time like after a drag. Gives the entry's new fields.
 */
export async function placeMovedEntry(
  db: UserDb,
  id: string,
  target: LogTarget,
): Promise<{ meal: number; diaryMealId: string | null }> {
  const day = await readDay(db, target.date);
  const source = day.find((m) => m.entries.some((e) => e.id === id));
  const into = day.find((m) => m.id === mealIdOf(target));
  if (source) await keepMeal(db, source);
  if (!into) return applyLogTarget(db, target);
  await keepMeal(db, into);
  return { meal: into.slot, diaryMealId: into.id };
}

/** "Rückgängig" of a move. */
export async function restoreEntryMeals(db: UserDb, places: readonly EntryMealPlace[]): Promise<void> {
  await db.transaction('rw', [db.foodEntries, db.outbox], async () => {
    for (const { id, meal, diaryMealId } of places) {
      const prev = await db.foodEntries.get(id);
      if (prev && !prev.deleted) await patchRecord(db, 'foodEntries', id, { meal, diaryMealId });
    }
  });
}

export async function renameDiaryMeal(db: UserDb, meal: DayMeal, name: string): Promise<void> {
  await upsertRecord(db, 'diaryMeals', meal.id, (prev) => ({
    ...(prev ?? recordOf(meal)),
    name: name.trim(),
  }));
}

/** Sets the time of a meal. `timeEdited` is false only when undoing the first change. */
export async function setDiaryMealTime(
  db: UserDb,
  meal: DayMeal,
  eatenAt: number,
  timeEdited = true,
): Promise<void> {
  await upsertRecord(db, 'diaryMeals', meal.id, (prev) => ({
    ...(prev ?? recordOf(meal)),
    eatenAt,
    timeEdited,
  }));
}
