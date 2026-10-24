import {
  addDays,
  dailyRows,
  estimateExpenditure,
  EXPENDITURE_WINDOW_DAYS,
  isCompleteDay,
  type ExpenditureEstimate,
  type ISODate,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';

export interface ExpenditureState {
  estimate: ExpenditureEstimate | null;
  /** Complete days and weigh-ins in the window (what is still missing when there is no estimate). */
  completeDays: number;
  weighIns: number;
}

/**
 * The data-based expenditure for the window ending on `date` (`estimateExpenditure` over the last
 * `EXPENDITURE_WINDOW_DAYS` diary days, closed days included). Undefined while loading.
 */
export function useExpenditure(date: ISODate): ExpenditureState | undefined {
  const db = useDb();
  return useLiveQuery(async () => {
    const from = addDays(date, -(EXPENDITURE_WINDOW_DAYS - 1));
    const inWindow = <T extends { date: string; deleted: boolean }>(list: T[]) =>
      list.filter((x) => !x.deleted && x.date >= from && x.date <= date);
    const [entries, exercises, weights, goals, notes] = await Promise.all([
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
    ]);
    const rows = dailyRows({ from, to: date, entries, exercises, weights, goals, notes });
    return {
      estimate: estimateExpenditure({ rows, weights }),
      completeDays: rows.filter(isCompleteDay).length,
      weighIns: inWindow(weights).length,
    };
  }, [db, date]);
}
