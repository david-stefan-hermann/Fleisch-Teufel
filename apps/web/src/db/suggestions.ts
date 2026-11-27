/**
 * "Zuletzt hier": what a diary meal usually gets, from the diary itself. A food or a group (saved
 * meal, named group) logged lately in meals of the same name scores by how often and how recently it
 * was logged, the same weekday a little higher (the Sunday breakfast). One tap logs it again with the
 * last amount (`logSuggestion`). Shown under every diary meal, without what the meal already has.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import {
  addDays,
  buildDayMeals,
  closestMeal,
  DEFAULT_MEAL_NAMES,
  diffDays,
  groupDiaryEntries,
  isNightOf,
  newMealEatenAt,
  photoIdsOf,
  sameMealName,
  SETTINGS_ID,
  type DayMeal,
  type DiaryRow,
  type FoodEntry,
  type ISODate,
  type MealItem,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { readDay, readNextMeal, type LogTarget } from './diaryMeals';
import { diaryParts, entriesToMealItems, entryToItem, logParts } from './entries';

/** How far back the diary is read. */
export const SUGGESTION_DAYS = 60;
/** Weight halves every 14 days: last week's dinner counts about twice as much as the one 3 weeks ago. */
const HALF_LIFE_DAYS = 14;
const SAME_WEEKDAY_BONUS = 1.5;

export interface MealSuggestion {
  /** `food:<foodId>`, `meal:<mealId>` or `group:<name>`: tells repeated logs of the same thing apart. */
  key: string;
  kind: 'food' | 'group';
  name: string;
  brand: string | null;
  /** What gets logged: the entries of the last occurrence (one for a food). */
  items: MealItem[];
  /** Group fields of the last occurrence (null for a food). */
  mealId: string | null;
  groupName: string | null;
  aiAnalysisId: string | null;
  photoIds: string[];
  /** Times it was logged in this meal within `SUGGESTION_DAYS`. */
  count: number;
  score: number;
  /** When it was logged last. */
  lastDate: string;
}

const weight = (ageDays: number, sameWeekday: boolean) =>
  0.5 ** (ageDays / HALF_LIFE_DAYS) * (sameWeekday ? SAME_WEEKDAY_BONUS : 1);

const weekday = (date: string) => new Date(`${date}T12:00:00`).getDay();

/** What tells repeated logs of the same thing apart; null for rows that are never suggested. */
function suggestionKey(row: DiaryRow): string | null {
  if (row.kind === 'entry') {
    const e = row.entry;
    // Quick adds and estimated foods (no food id) are no food to log again.
    return e.foodId && e.source !== 'quick' ? `food:${e.foodId}` : null;
  }
  return row.mealId ? `meal:${row.mealId}` : row.groupName ? `group:${row.groupName}` : null;
}

/** Key of the card of a day without meals in the result of `daySuggestions`. */
export const NEXT_MEAL_KEY = 'new';

/** The meal of the day before that "Wie gestern" would copy. */
export interface YesterdayMeal {
  id: string;
  date: ISODate;
  name: string;
  eatenAt: number;
  kcal: number;
}

/** "Zuletzt hier" of one diary meal: the suggestions and the meal of the day before that fits it. */
export interface MealSuggestions {
  suggestions: MealSuggestion[];
  yesterday: YesterdayMeal | null;
}

/**
 * What tells meals apart for their history: the name, where a standard name and the one it had
 * before the first rename count as one (a rename keeps the history).
 */
function historyKeyOf(standard: readonly string[], legacy: readonly string[] | null) {
  return (name: string): string => {
    const own = standard.findIndex((n) => sameMealName(n, name));
    const old = own >= 0 ? own : (legacy?.findIndex((n) => sameMealName(n, name)) ?? -1);
    return old >= 0 ? `#${old}` : `=${name.trim().toLocaleLowerCase('de')}`;
  };
}

const kcalOf = (entries: readonly FoodEntry[]) => entries.reduce((s, e) => s + (e.nutrients.ENERCC ?? 0), 0);

/**
 * Suggestions for every diary meal of a date (keyed by meal id, the card of a day without meals by
 * `NEXT_MEAL_KEY`), best first, from one read of the diary. Earlier days count, through the meals of
 * the same name; what the meal already has on `date` is left out before cutting to `limit` (the next
 * best moves up), and so are quick adds and estimated foods (no food id). "Wie gestern" is the meal
 * of the day before with the same name, else the one nearest in time (`closestMeal`).
 */
export async function daySuggestions(
  db: UserDb,
  date: ISODate,
  limit = 4,
  at = Date.now(),
): Promise<Map<string, MealSuggestions>> {
  const from = addDays(date, -SUGGESTION_DAYS);
  const before = addDays(date, -1);
  const [entries, records, settings, today, next] = await Promise.all([
    // Tombstones too: they keep the time of a meal without a record.
    db.foodEntries.where('date').between(from, before, true, true).toArray(),
    db.diaryMeals.where('date').between(from, before, true, true).toArray(),
    db.settings.get(SETTINGS_ID),
    readDay(db, date),
    readNextMeal(db, date),
  ]);
  const standard = settings?.mealNames ?? [...DEFAULT_MEAL_NAMES];
  const legacy = settings?.legacyMealNames ?? null;
  const dayStartHour = settings?.dayStartHour ?? null;
  const keyOf = historyKeyOf(standard, legacy);

  const byDate = new Map<string, FoodEntry[]>();
  for (const e of entries) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  const history = new Map<string, FoodEntry[]>();
  let yesterdayMeals: DayMeal[] = [];
  for (const [day, dayEntries] of byDate) {
    const meals = buildDayMeals({
      date: day,
      entries: dayEntries,
      // All of them: an entry can name a meal of another day (`buildDayMeals` takes the day's own).
      records,
      names: legacy ?? standard,
      dayStartHour,
    });
    if (day === before) yesterdayMeals = meals;
    for (const m of meals) {
      const key = keyOf(m.name);
      (history.get(key) ?? history.set(key, []).get(key)!).push(...m.entries);
    }
  }
  for (const list of history.values()) list.sort((a, b) => a.loggedAt - b.loggedAt);

  const yesterdayFor = (name: string, eatenAt: number): YesterdayMeal | null => {
    const found = closestMeal(
      { name: keyOf(name), eatenAt, night: isNightOf(date, eatenAt) },
      yesterdayMeals.map((meal) => ({ ...meal, name: keyOf(meal.name), meal })),
    )?.meal;
    return found
      ? { id: found.id, date: before, name: found.name, eatenAt: found.eatenAt, kcal: kcalOf(found.entries) }
      : null;
  };
  const forMeal = async (name: string, eatenAt: number, has: readonly FoodEntry[]) => ({
    suggestions: await rank(
      db,
      history.get(keyOf(name)) ?? [],
      date,
      new Set(groupDiaryEntries([...has]).map(suggestionKey)),
      limit,
    ),
    yesterday: yesterdayFor(name, eatenAt),
  });

  const out = new Map<string, MealSuggestions>();
  for (const m of today) out.set(m.id, await forMeal(m.name, m.eatenAt, m.entries));
  out.set(
    NEXT_MEAL_KEY,
    await forMeal(next.name, newMealEatenAt(date, next.name, standard, at, dayStartHour), []),
  );
  return out;
}

/** Suggestions for one diary meal on a date, by its id (see `daySuggestions`). */
export async function mealSuggestions(
  db: UserDb,
  date: ISODate,
  mealId: string,
  limit = 4,
): Promise<MealSuggestion[]> {
  return (await daySuggestions(db, date, limit)).get(mealId)?.suggestions ?? [];
}

/** Scores the rows of one meal's earlier days (`entries` sorted by `loggedAt`). */
async function rank(
  db: UserDb,
  entries: readonly FoodEntry[],
  date: string,
  exclude: ReadonlySet<string | null>,
  limit: number,
): Promise<MealSuggestion[]> {
  const wd = weekday(date);
  const byKey = new Map<string, MealSuggestion>();
  const bump = (
    key: string,
    e: FoodEntry,
    build: () => Omit<MealSuggestion, 'key' | 'count' | 'score' | 'lastDate'>,
  ) => {
    const w = weight(diffDays(e.date, date), weekday(e.date) === wd);
    const have = byKey.get(key);
    if (!have) byKey.set(key, { key, ...build(), count: 1, score: w, lastDate: e.date });
    else {
      have.count++;
      have.score += w;
      // The latest occurrence decides what gets logged (amounts, ingredients, photos).
      if (e.date >= have.lastDate) Object.assign(have, build(), { lastDate: e.date });
    }
  };
  // Grouped per day, so a saved meal logged twice on one day counts twice.
  const byDate = new Map<string, FoodEntry[]>();
  for (const e of entries) (byDate.get(e.date) ?? byDate.set(e.date, []).get(e.date)!).push(e);
  for (const dayEntries of byDate.values()) {
    for (const row of groupDiaryEntries(dayEntries)) {
      const key = suggestionKey(row);
      if (!key || exclude.has(key)) continue;
      if (row.kind === 'entry') {
        const e = row.entry;
        bump(key, e, () => ({
          kind: 'food',
          name: e.name,
          brand: e.brand,
          items: [entryToItem(e)],
          mealId: null,
          groupName: null,
          aiAnalysisId: null,
          photoIds: [],
        }));
        continue;
      }
      const first = row.entries[0]!;
      bump(key, first, () => ({
        kind: 'group',
        name: row.groupName ?? '',
        brand: null,
        items: entriesToMealItems(row.entries),
        mealId: row.mealId,
        groupName: row.groupName,
        aiAnalysisId: first.aiAnalysisId,
        photoIds: photoIdsOf(first),
      }));
    }
  }
  const list = [...byKey.values()].sort((a, b) => b.score - a.score || b.lastDate.localeCompare(a.lastDate));
  // A saved meal's name comes from the meal (a group without own name has none yet).
  for (const s of list) {
    if (s.kind === 'group' && !s.name && s.mealId) s.name = (await db.meals.get(s.mealId))?.name ?? 'Meal';
  }
  return list.filter((s) => s.name).slice(0, limit);
}

/** Logs a suggestion into a diary meal (a group as a new group, a food as a plain entry); returns the ids. */
export async function logSuggestion(db: UserDb, s: MealSuggestion, target: LogTarget): Promise<string[]> {
  return logParts(
    db,
    [
      {
        kind: s.kind === 'food' ? 'entry' : 'group',
        items: s.items,
        mealId: s.mealId,
        groupName: s.groupName ?? (s.mealId ? null : s.name),
        aiAnalysisId: s.aiAnalysisId,
        photoIds: s.photoIds,
      },
    ],
    target,
  );
}

/**
 * Copies a whole diary meal of another day into a meal ("Wie gestern"): groups stay groups (same saved
 * meal, name, analysis, photos), single entries stay single. Returns the ids of the new entries.
 */
export async function copyMealFromDay(
  db: UserDb,
  from: { date: ISODate; id: string },
  target: LogTarget,
): Promise<string[]> {
  const meal = (await readDay(db, from.date)).find((m) => m.id === from.id);
  return logParts(db, diaryParts(meal?.entries ?? []), target);
}
