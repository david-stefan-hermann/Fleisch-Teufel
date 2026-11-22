import {
  addDays,
  dailyRows,
  EXPENDITURE_WINDOW_DAYS,
  forecastHistory,
  SETTINGS_ID,
  type DayForecast,
  type ISODate,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import { mealRecordsFor } from '@/db/diaryMeals';
import { useToday } from '@/hooks/data';

const NONE: DayForecast[] = [];

/**
 * The forecast each day of [from, today] would have made (`forecastHistory`): the diary from
 * `EXPENDITURE_WINDOW_DAYS` before `from` up to today, training and steps as the settings credit them.
 * Reads nothing while `enabled` is off (then an empty list). Undefined while loading.
 */
export function useForecastHistory(from: ISODate, enabled: boolean): DayForecast[] | undefined {
  const db = useDb();
  const today = useToday();
  return useLiveQuery(async () => {
    if (!enabled || from > today) return NONE;
    const start = addDays(from, -(EXPENDITURE_WINDOW_DAYS - 1));
    const [entries, exercises, weights, goals, notes, settings] = await Promise.all([
      db.foodEntries
        .where('date')
        .between(start, today, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.exerciseEntries
        .where('date')
        .between(start, today, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.weightEntries.filter((w) => !w.deleted).toArray(),
      db.goals.filter((g) => !g.deleted).toArray(),
      db.dayNotes
        .where('date')
        .between(start, today, true, true)
        .filter((n) => !n.deleted)
        .toArray(),
      db.settings.get(SETTINGS_ID),
    ]);
    const diaryMeals = await mealRecordsFor(db, start, today, entries);
    const rows = dailyRows({ from: start, to: today, entries, diaryMeals, exercises, weights, goals, notes });
    return forecastHistory({
      rows,
      weights,
      from,
      to: today,
      settings,
      creditExercise: settings?.addExerciseCalories !== false,
      creditSteps: settings?.addStepsCalories !== false,
    });
  }, [db, from, today, enabled]);
}
