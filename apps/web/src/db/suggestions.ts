/**
 * "Zuletzt hier": what a diary meal usually gets, from the diary itself. A food or a group (saved
 * meal, named group) logged in this meal index lately scores by how often and how recently it was
 * logged, the same weekday a little higher (the Sunday breakfast). One tap logs it again with the
 * last amount (`logSuggestion`).
 *
 * Free of `@/` aliases on purpose (the API test suite imports `db/*`).
 */
import { addDays, diffDays, groupDiaryEntries, photoIdsOf, type FoodEntry, type MealItem } from '@ft/shared';
import type { UserDb } from './dexie';
import { entriesToMealItems, logItems } from './entries';

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

/**
 * Suggestions for a diary meal on a date, best first. Entries of `date` itself are left out (they are
 * what is being logged right now); quick adds and estimated foods (no food id) too.
 */
export async function mealSuggestions(
  db: UserDb,
  date: string,
  meal: number,
  limit = 4,
): Promise<MealSuggestion[]> {
  const from = addDays(date, -SUGGESTION_DAYS);
  const entries = (
    await db.foodEntries
      .where('date')
      .between(from, date, true, false)
      .filter((e) => !e.deleted && e.meal === meal)
      .toArray()
  ).sort((a, b) => a.loggedAt - b.loggedAt);
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
      if (row.kind === 'entry') {
        const e = row.entry;
        if (!e.foodId || e.source === 'quick') continue;
        bump(`food:${e.foodId}`, e, () => ({
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
      const key = row.mealId ? `meal:${row.mealId}` : row.groupName ? `group:${row.groupName}` : null;
      if (!key) continue;
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
  if (s.kind === 'food') return logItems(db, s.items, target);
  return logItems(db, s.items, target, {
    mealId: s.mealId,
    groupName: s.groupName ?? (s.mealId ? null : s.name),
    aiAnalysisId: s.aiAnalysisId,
    photoIds: s.photoIds,
  });
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
  const ids: string[] = [];
  await db.transaction('rw', [db.foodEntries, db.outbox], async () => {
    for (const row of groupDiaryEntries(entries)) {
      if (row.kind === 'entry') ids.push(...(await logItems(db, [row.entry], to)));
      else {
        const first = row.entries[0]!;
        ids.push(
          ...(await logItems(db, row.entries, to, {
            mealId: row.mealId,
            groupName: row.groupName ?? (row.mealId ? null : 'Meal'),
            aiAnalysisId: first.aiAnalysisId,
            photoIds: photoIdsOf(first),
          })),
        );
      }
    }
  });
  return ids;
}
