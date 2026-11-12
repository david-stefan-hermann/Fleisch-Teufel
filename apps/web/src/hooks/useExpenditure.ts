import {
  addDays,
  dailyRows,
  estimateExpenditure,
  EXPENDITURE_WINDOW_DAYS,
  isCompleteDay,
  SETTINGS_ID,
  type ExpenditureEstimate,
  type ExpenditureMissing,
  type ISODate,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import { useToday } from '@/hooks/data';

export interface ExpenditureState {
  estimate: ExpenditureEstimate | null;
  /** Why there is no estimate (null with one). */
  reason: ExpenditureMissing | null;
  /** Complete days and weigh-ins in the window (what is still missing when there is no estimate). */
  completeDays: number;
  weighIns: number;
}

/**
 * The data-based expenditure for the window ending on `date` (`estimateExpenditure` over the last
 * `EXPENDITURE_WINDOW_DAYS` diary days, closed days included; the running day only once closed).
 * Training and steps count as the settings credit them. Undefined while loading.
 */
export function useExpenditure(date: ISODate): ExpenditureState | undefined {
  const db = useDb();
  const today = useToday();
  return useLiveQuery(async () => {
    const from = addDays(date, -(EXPENDITURE_WINDOW_DAYS - 1));
    const inWindow = <T extends { date: string; deleted: boolean }>(list: T[]) =>
      list.filter((x) => !x.deleted && x.date >= from && x.date <= date);
    const [entries, exercises, weights, goals, notes, settings] = await Promise.all([
      db.foodEntries
        .where('date')
        .between(from, date, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.exerciseEntries
        .where('date')
        .between(from, date, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.weightEntries.filter((w) => !w.deleted).toArray(),
      db.goals.filter((g) => !g.deleted).toArray(),
      db.dayNotes
        .where('date')
        .between(from, date, true, true)
        .filter((n) => !n.deleted)
        .toArray(),
      db.settings.get(SETTINGS_ID),
    ]);
    const rows = dailyRows({ from, to: date, entries, exercises, weights, goals, notes });
    const result = estimateExpenditure({
      rows,
      weights,
      creditExercise: settings?.addExerciseCalories !== false,
      creditSteps: settings?.addStepsCalories !== false,
      today,
    });
    return {
      estimate: result.value,
      reason: result.reason,
      completeDays: rows.filter((r) => isCompleteDay(r, { today })).length,
      weighIns: inWindow(weights).length,
    };
  }, [db, date, today]);
}
