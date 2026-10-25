import {
  SETTINGS_ID,
  summarizeDay,
  today as todayOf,
  weightOn,
  type DaySummary,
  type ExerciseEntry,
  type FoodEntry,
  type Goal,
  type ISODate,
  type Settings,
  type WeightEntry,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useDb } from '@/app/session';
import { readClipboard, type Clipboard } from '@/db/clipboard';
import type { AiQueueItem } from '@/db/dexie';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { daySuggestions, type MealSuggestions } from '@/db/suggestions';

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

export function useDayExercises(date: ISODate): ExerciseEntry[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () =>
      db.exerciseEntries
        .where('date')
        .equals(date)
        .filter((e) => !e.deleted)
        .sortBy('loggedAt'),
    [db, date],
  );
}

export function useWeights(): WeightEntry[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.weightEntries.filter((w) => !w.deleted).sortBy('date'), [db]);
}

/** The weight valid on a date: the last one logged up to it, before the first entry the earliest one. */
export function useCurrentWeight(date: ISODate): number | undefined {
  const weights = useWeights();
  if (!weights) return undefined;
  return weightOn(weights, date) ?? weights.find((w) => !w.deleted)?.kg;
}

export function useDayNote(date: ISODate) {
  const db = useDb();
  return useLiveQuery(async () => (await db.dayNotes.get(`n:${date}`)) ?? null, [db, date]);
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
 * Photos of a day that are not analysed yet (waiting for a connection, running, failed): the
 * placeholder rows of the diary. They live on this device only and count in no sum.
 */
export function usePendingAnalyses(date: ISODate): AiQueueItem[] | undefined {
  const db = useDb();
  return useLiveQuery(
    // Not analysed yet, or analysed but its logging failed (shows "Wiederholen" like a failed analysis).
    () =>
      db.aiQueue
        .filter((i) => i.date === date && (!i.result || (!!i.deferred && i.status === 'failed')))
        .sortBy('createdAt'),
    [db, date],
  );
}

/** Dates in [from, to] that have at least one diary entry (week strip dots). */
export function useLoggedDates(from: ISODate, to: ISODate): Set<string> | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const list = await db.foodEntries
      .where('date')
      .between(from, to, true, true)
      .filter((e) => !e.deleted)
      .toArray();
    return new Set(list.map((e) => e.date));
  }, [db, from, to]);
}

/** Days in [from, to] with at least one training (blue dot in the week strip). */
export function useTrainedDates(from: ISODate, to: ISODate): Set<string> | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const list = await db.exerciseEntries
      .where('date')
      .between(from, to, true, true)
      .filter((e) => !e.deleted)
      .toArray();
    return new Set(list.map((e) => e.date));
  }, [db, from, to]);
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
 * meal index the suggestions and the kcal of the same meal yesterday. Undefined while loading.
 */
export function useDaySuggestions(date: ISODate): Map<number, MealSuggestions> | undefined {
  const db = useDb();
  return useLiveQuery(() => daySuggestions(db, date), [db, date]);
}

/** The diary clipboard on this device (`db/clipboard.ts`); null when empty, undefined while loading. */
export function useClipboard(): Clipboard | null | undefined {
  const db = useDb();
  return useLiveQuery(() => readClipboard(db), [db]);
}
