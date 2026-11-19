/**
 * The meals of a day on this device: reading them (`buildDayMeals` in shared holds the rules), choosing
 * where the next entries go, and the changes a person makes to a meal.
 */
import {
  buildDayMeals,
  dayId,
  EXTRA_MEAL_NAME,
  MAX_CUSTOM_MEAL_NAMES,
  newMealEatenAt,
  nextMealName,
  sameMealName,
  SETTINGS_ID,
  slotForNewMeal,
  uuidv7,
  DEFAULT_MEAL_NAMES,
  type DayMeal,
  type DiaryMeal,
  type FoodEntry,
  type ISODate,
  type PendingMealItem,
  type Settings,
} from '@ft/shared';
import type { AiQueueItem, UserDb } from './dexie';
import { DEFAULT_SETTINGS, saveSettings } from './settings';
import { saveRecord, patchRecord, upsertRecord } from './write';

/** A meal of a day on this device: the analyses that still wait stand in it. */
export type DiaryDayMeal = DayMeal<AiQueueItem>;

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

/**
 * An analysis that shows as a row of its meal: not analysed yet, or analysed and its logging failed.
 * It lives on this device only and counts in no sum.
 */
export function isWaitingAnalysis(item: AiQueueItem): boolean {
  return !item.result || (!!item.deferred && item.status === 'failed');
}

/** An analysis at the meal it was queued for. */
function queuedAt(item: AiQueueItem, meal: number, picked: string | null): PendingMealItem<AiQueueItem> {
  const begins = picked !== null && picked === item.diaryMealId ? item.newMeal : undefined;
  return {
    value: item,
    meal,
    diaryMealId: picked,
    name: begins?.name ?? null,
    eatenAt: begins?.eatenAt ?? null,
    at: item.createdAt,
  };
}

/** A waiting analysis in the meal it will be logged into: a choice in its review goes first. */
function waitingIn(item: AiQueueItem): PendingMealItem<AiQueueItem> {
  const picked = item.draft?.diaryMealId ?? item.diaryMealId ?? null;
  return queuedAt(item, item.draft?.meal ?? item.meal, picked === 'new' ? null : picked);
}

const queueOfDay = (db: UserDb, date: ISODate, keep: (item: AiQueueItem) => boolean) =>
  db.aiQueue.filter((i) => i.date === date && keep(i)).sortBy('createdAt');

async function buildDay(
  db: UserDb,
  date: ISODate,
  pending: readonly PendingMealItem<AiQueueItem>[],
): Promise<DiaryDayMeal[]> {
  const [entries, records, names] = await Promise.all([
    db.foodEntries.where('date').equals(date).toArray(),
    db.diaryMeals.where('date').equals(date).toArray(),
    mealNames(db),
  ]);
  return buildDayMeals({ date, entries, records, pending, names: names.unrecorded });
}

/** The meals of a day as the diary shows them. */
export async function readDay(db: UserDb, date: ISODate): Promise<DiaryDayMeal[]> {
  return buildDay(db, date, (await queueOfDay(db, date, isWaitingAnalysis)).map(waitingIn));
}

/**
 * The meals a new entry can go to or must not collide with: the diary's, and the meal an analysis
 * in its review began. That one has no row in the diary, but its name and index are taken.
 */
async function readPlannedDay(db: UserDb, date: ISODate): Promise<DiaryDayMeal[]> {
  const items = await queueOfDay(db, date, (i) => isWaitingAnalysis(i) || !!i.newMeal);
  const pending = items.map((i) =>
    isWaitingAnalysis(i) ? waitingIn(i) : queuedAt(i, i.meal, i.diaryMealId ?? null),
  );
  return buildDay(db, date, pending);
}

/** Name and time of a meal that so far exists only through an analysis waiting for it. */
function queuedNewMeal(meal: DiaryDayMeal): { name: string; eatenAt: number } | null {
  if (!meal.virtual) return null;
  const begins = meal.pending.find((i) => i.diaryMealId === meal.id && i.newMeal)?.newMeal;
  return begins ? { name: begins.name, eatenAt: begins.eatenAt } : null;
}

/** The meal an entry without a meal of its own joins at `at` (see `buildDayMeals`). */
function mealOfSlot(day: readonly DayMeal[], slot: number, at: number): DayMeal | undefined {
  const ofSlot = day
    // A meal known only by its id takes nothing that names just an index.
    .filter((m) => m.slot === slot && (!m.virtual || unrecordedSlot(m.id) !== null))
    .sort((a, b) => a.eatenAt - b.eatenAt);
  const recorded = ofSlot.filter((m) => !m.virtual);
  const from = recorded.length > 0 ? recorded : ofSlot;
  return from.filter((m) => m.eatenAt <= at).at(-1) ?? from[0];
}

/** The next automatic meal of a day: its name and the index its entries write. */
export async function readNextMeal(db: UserDb, date: ISODate): Promise<MealChoice['next']> {
  const [day, { standard }] = await Promise.all([readPlannedDay(db, date), mealNames(db)]);
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
    readPlannedDay(db, date),
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
  const day = await readPlannedDay(db, date);
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
  if (shown?.virtual && unrecordedSlot(dm) !== null) return { date, meal: shown.slot, diaryMealId: null };
  if (shown) {
    // Whoever logs first into a meal an analysis began writes its record.
    const create = queuedNewMeal(shown);
    return { date, meal: shown.slot, diaryMealId: dm, ...(create && { create }) };
  }
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

/**
 * Writes down a meal that exists only through its entries or a waiting analysis, so its name and
 * time stay as they are.
 */
async function keepMeal(db: UserDb, meal: DiaryDayMeal): Promise<void> {
  const unrecorded = unrecordedSlot(meal.id) !== null || queuedNewMeal(meal) !== null;
  if (unrecorded && !(await db.diaryMeals.get(meal.id))) {
    await saveRecord(db, 'diaryMeals', recordOf(meal));
  }
}

/** Moves entries into a meal of their day. Returns where the moved ones were. */
export async function moveEntriesToDiaryMeal(
  db: UserDb,
  ids: readonly string[],
  target: DiaryDayMeal,
): Promise<EntryMealPlace[]> {
  return db.transaction('rw', [db.foodEntries, db.diaryMeals, db.settings, db.outbox], async () => {
    // The queue is outside this transaction, and only the entries matter here.
    const day = await buildDay(db, target.date, []);
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
  // The caller's transaction does not hold the queue; a meal only an analysis knows has `target.create`.
  const day = await buildDay(db, target.date, []);
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

/** The names a meal can be given besides the four standard ones, without repeating any of those. */
export function ownMealNames(settings: Pick<Settings, 'mealNames' | 'customMealNames'>): string[] {
  const own: string[] = [];
  for (const name of settings.customMealNames ?? []) {
    const taken = [...settings.mealNames, EXTRA_MEAL_NAME, ...own];
    if (!taken.some((n) => sameMealName(n, name))) own.push(name);
  }
  return own;
}

/**
 * Names a meal and keeps a new name for the picker, in one transaction. `listed` is false when the
 * list of own names is full: the meal has its name all the same.
 */
export async function chooseMealName(
  db: UserDb,
  meal: DayMeal,
  chosen: string,
): Promise<{ listed: boolean }> {
  const name = chosen.trim();
  return db.transaction('rw', [db.diaryMeals, db.settings, db.outbox], async () => {
    const current = (await db.diaryMeals.get(meal.id))?.name ?? meal.name;
    if (current !== name) await renameDiaryMeal(db, meal, name);
    const settings = (await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTINGS;
    const own = ownMealNames(settings);
    const known = [...settings.mealNames, EXTRA_MEAL_NAME, ...own].some((n) => sameMealName(n, name));
    if (known) return { listed: true };
    if (own.length >= MAX_CUSTOM_MEAL_NAMES) return { listed: false };
    await saveSettings(db, { customMealNames: [...own, name] });
    return { listed: true };
  });
}

/** Takes a name out of the picker. Meals that carry it keep it. */
export async function removeOwnMealName(db: UserDb, name: string): Promise<void> {
  await db.transaction('rw', [db.settings, db.outbox], async () => {
    const settings = (await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTINGS;
    const own = ownMealNames(settings);
    await saveSettings(db, { customMealNames: own.filter((n) => !sameMealName(n, name)) });
  });
}

/**
 * Renames the four standard meals for meals to come. Meals without a record read their name from the
 * settings, so the names from before the first rename stay with them.
 */
export async function saveStandardMealNames(db: UserDb, names: readonly string[]): Promise<void> {
  await db.transaction('rw', [db.settings, db.outbox], async () => {
    const settings = (await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTINGS;
    const mealNames = names.map((n) => n.trim());
    if (mealNames.every((n, i) => n === settings.mealNames[i])) return;
    await saveSettings(db, {
      mealNames,
      legacyMealNames: settings.legacyMealNames ?? settings.mealNames,
    });
  });
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
