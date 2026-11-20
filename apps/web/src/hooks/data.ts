import {
  isStepsEntry,
  isStraySteps,
  dateRange,
  SETTINGS_ID,
  stripMark,
  summarizeDay,
  today as todayOf,
  weightForDay,
  type DaySummary,
  type ExerciseEntry,
  type FoodEntry,
  type Goal,
  type ISODate,
  type Settings,
  type StripMark,
  type WeightEntry,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useDb } from '@/app/session';
import { readClipboard, type AnyClipboard } from '@/db/clipboard';
import { readDay, readMealChoice, type DiaryDayMeal, type MealChoice } from '@/db/diaryMeals';
import { resolveFlowMeal } from '@/lib/logFlow';
import { openPastDays } from '@/db/notes';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { daySuggestions, type MealSuggestions } from '@/db/suggestions';
import { trainingHistory, type TrainingHistory } from '@/db/trainingSuggestions';

export { DEFAULT_SETTINGS };

/** Current calendar day; rolls over at midnight and when the app returns to the foreground. */
export function useToday(): ISODate {
  const [d, setD] = useState(() => todayOf());
  useEffect(() => {
    const update = () => setD(todayOf());
    const id = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return d;
}

/** `undefined` while loading. */
export function useSettings(): Settings | undefined {
  const db = useDb();
  return useLiveQuery(async () => (await db.settings.get(SETTINGS_ID)) ?? DEFAULT_SETTINGS, [db]);
}

export function useGoals(): Goal[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.goals.filter((g) => !g.deleted).sortBy('validFrom'), [db]);
}

export function useDayEntries(date: ISODate): FoodEntry[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () =>
      db.foodEntries
        .where('date')
        .equals(date)
        .filter((e) => !e.deleted)
        .sortBy('loggedAt'),
    [db, date],
  );
}

/** The meals of a day, in the order the diary shows them, with the analyses waiting in each. */
export function useDayMeals(date: ISODate): DiaryDayMeal[] | undefined {
  const db = useDb();
  return useLiveQuery(() => readDay(db, date), [db, date]);
}

/** The meals a page can log into on a day, and what its `meal` and `dm` stand for. */
export function useMealChoice(date: ISODate, meal: number, dm?: string): MealChoice | undefined {
  const db = useDb();
  // `dm: 'new'` is the meal the running logging flow already began, like when logging (`resolveFlowMeal`).
  return useLiveQuery(
    async () => readMealChoice(db, await resolveFlowMeal(db, { date, meal, dm })),
    [db, date, meal, dm],
  );
}

export function useDayExercises(date: ISODate): ExerciseEntry[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () =>
      db.exerciseEntries
        .where('date')
        .equals(date)
        // A stray steps copy (refused by the server, dropped by the next sync) never shows.
        .filter((e) => !e.deleted && !isStraySteps(e))
        .sortBy('loggedAt'),
    [db, date],
  );
}

/** "Zuletzt & häufig" of the trainings for a date and the last values per sport (`trainingHistory`). */
export function useTrainingHistory(date: ISODate, withLogged = false): TrainingHistory | undefined {
  const db = useDb();
  return useLiveQuery(() => trainingHistory(db, date, { withLogged }), [db, date, withLogged]);
}

export function useWeights(): WeightEntry[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.weightEntries.filter((w) => !w.deleted).sortBy('date'), [db]);
}

/** The weight valid on a date: the last one logged up to it, before the first entry the earliest one. */
export function useCurrentWeight(date: ISODate): number | undefined {
  const weights = useWeights();
  if (!weights) return undefined;
  return weightForDay(weights, date);
}

export function useDayNote(date: ISODate) {
  const db = useDb();
  return useLiveQuery(async () => (await db.dayNotes.get(`n:${date}`)) ?? null, [db, date]);
}

/** Days before `before` with entries and without "Tag abgeschlossen" (`openPastDays`). */
export function useOpenPastDays(before: ISODate) {
  const db = useDb();
  return useLiveQuery(() => openPastDays(db, before), [db, before]);
}

export function useDaySummary(date: ISODate): DaySummary | undefined {
  const entries = useDayEntries(date);
  const exercises = useDayExercises(date);
  const goals = useGoals();
  const settings = useSettings();
  if (!entries || !exercises || !goals || !settings) return undefined;
  return summarizeDay({ date, entries, exercises, goals, settings });
}

/**
 * What the week strip draws for each day in [from, to]: food, training (steps alone are none) and
 * whether the day kept its budget (`stripMark`). One live query for entries and trainings.
 */
export function useStripMarks(from: ISODate, to: ISODate): Map<ISODate, StripMark> | undefined {
  const db = useDb();
  const goals = useGoals();
  const settings = useSettings();
  const lists = useLiveQuery(async () => {
    const [entries, exercises] = await Promise.all([
      db.foodEntries
        .where('date')
        .between(from, to, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.exerciseEntries
        .where('date')
        .between(from, to, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
    ]);
    return { entries, exercises };
  }, [db, from, to]);
  if (!lists || !goals || !settings) return undefined;
  const marks = new Map<ISODate, StripMark>();
  for (const date of dateRange(from, to)) {
    const summary = summarizeDay({ date, ...lists, goals, settings });
    const training = lists.exercises.some((e) => e.date === date && !isStepsEntry(e));
    marks.set(date, stripMark(summary, training));
  }
  return marks;
}

/** Name and photo of saved meals by id (also deleted ones: diary groups keep showing them). */
export function useMealInfo(
  ids: (string | null)[],
): Map<string, { name: string; photoId: string | null }> | undefined {
  const db = useDb();
  const key = [...new Set(ids.filter((id): id is string => !!id))].sort().join(',');
  return useLiveQuery(async () => {
    const list = key ? await db.meals.bulkGet(key.split(',')) : [];
    return new Map(list.filter((m) => !!m).map((m) => [m.id, { name: m.name, photoId: m.photoId ?? null }]));
  }, [db, key]);
}

/**
 * "Zuletzt hier" of every diary meal of a day (`db/suggestions.ts`, one live query for all cards): per
 * meal id (`NEXT_MEAL_KEY` for the card of a day without meals) the suggestions and the meal of the
 * day before that "Wie gestern" copies. Undefined while loading.
 */
export function useDaySuggestions(date: ISODate): Map<string, MealSuggestions> | undefined {
  const db = useDb();
  return useLiveQuery(() => daySuggestions(db, date), [db, date]);
}

/** The diary clipboard on this device (`db/clipboard.ts`); null when empty, undefined while loading. */
export function useClipboard(): AnyClipboard | null | undefined {
  const db = useDb();
  return useLiveQuery(() => readClipboard(db), [db]);
}
