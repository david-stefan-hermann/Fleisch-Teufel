/**
 * The meals of a day on this device: reading them (`buildDayMeals` in shared holds the rules), choosing
 * where the next entries go, and the changes a person makes to a meal.
 */
import {
  buildDayMeals,
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

/** Settles the target before the write transaction starts: it may only wait for IndexedDB. */
export async function prepareMealTarget(db: UserDb, ref: MealRef, at: number): Promise<LogTarget> {
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
