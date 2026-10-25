/**
 * "Zuletzt hier": what a diary meal usually gets, from the diary itself. A food or a group (saved
 * meal, named group) logged in this meal index lately scores by how often and how recently it was
 * logged, the same weekday a little higher (the Sunday breakfast). One tap logs it again with the
 * last amount (`logSuggestion`). Shown under every diary meal, without what the meal already has.
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import {
  addDays,
  diffDays,
  groupDiaryEntries,
  photoIdsOf,
  type DiaryRow,
  type FoodEntry,
  type MealItem,
} from '@ft/shared';
import type { UserDb } from './dexie';
import { diaryParts, entriesToMealItems, logParts } from './entries';

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

/** "Zuletzt hier" of one diary meal: the suggestions and the kcal of the same meal yesterday (0: nothing). */
export interface MealSuggestions {
  suggestions: MealSuggestion[];
  yesterdayKcal: number;
}

/**
 * Suggestions for every diary meal of a date (by meal index), best first, from one read of the diary.
 * Earlier days count; what is already in the meal on `date` is left out before cutting to `limit`
 * (the next best moves up), and so are quick adds and estimated foods (no food id).
 */
export async function daySuggestions(
  db: UserDb,
  date: string,
  limit = 4,
): Promise<Map<number, MealSuggestions>> {
  const from = addDays(date, -SUGGESTION_DAYS);
  const yesterday = addDays(date, -1);
  const all = (
    await db.foodEntries
      .where('date')
      .between(from, date, true, true)
      .filter((e) => !e.deleted)
      .toArray()
  ).sort((a, b) => a.loggedAt - b.loggedAt);
  const byMeal = new Map<number, FoodEntry[]>();
  for (const e of all) (byMeal.get(e.meal) ?? byMeal.set(e.meal, []).get(e.meal)!).push(e);
  const out = new Map<number, MealSuggestions>();
  for (const [meal, entries] of byMeal) {
    const today = entries.filter((e) => e.date === date);
    const logged = new Set(groupDiaryEntries(today).map(suggestionKey));
    const suggestions = await rank(
      db,
      entries.filter((e) => e.date < date),
      date,
      logged,
      limit,
    );
    const yesterdayKcal = entries
      .filter((e) => e.date === yesterday)
      .reduce((s, e) => s + (e.nutrients.ENERCC ?? 0), 0);
    out.set(meal, { suggestions, yesterdayKcal });
  }
  return out;
}

/** Suggestions for one diary meal on a date (see `daySuggestions`). */
export async function mealSuggestions(
  db: UserDb,
  date: string,
  meal: number,
  limit = 4,
): Promise<MealSuggestion[]> {
  return (await daySuggestions(db, date, limit)).get(meal)?.suggestions ?? [];
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
          items: entriesToMealItems([e]),
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
export async function logSuggestion(
  db: UserDb,
  s: MealSuggestion,
  target: { date: string; meal: number },
): Promise<string[]> {
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
  from: { date: string; meal: number },
  to: { date: string; meal: number },
): Promise<string[]> {
  const entries = await db.foodEntries
    .where('[date+meal]')
    .equals([from.date, from.meal])
    .filter((e) => !e.deleted)
    .sortBy('loggedAt');
  return logParts(db, diaryParts(entries), to);
}
