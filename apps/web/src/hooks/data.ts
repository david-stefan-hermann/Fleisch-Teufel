import {
  DEFAULT_MEAL_NAMES,
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

export const DEFAULT_SETTINGS: Settings = {
  id: SETTINGS_ID,
  updatedAt: 0,
  deleted: false,
  sex: null,
  birthDate: null,
  heightCm: null,
  activityLevel: 'light',
  targetWeightKg: null,
  weeklyRateKg: -0.5,
  mealNames: [...DEFAULT_MEAL_NAMES],
  addExerciseCalories: true,
  onboardedAt: null,
};

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

export function useCurrentWeight(date: ISODate): number | undefined {
  const weights = useWeights();
  return weights ? weightOn(weights, date) : undefined;
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
