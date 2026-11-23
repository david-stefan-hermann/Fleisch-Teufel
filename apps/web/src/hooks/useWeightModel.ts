import {
  bodyProfile,
  buildWeightModel,
  creditOf,
  dailyRows,
  modelDays,
  SETTINGS_ID,
  tdee,
  type ModelDay,
  type WeightModel,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import { mealRecordsFor } from '@/db/diaryMeals';
import { useToday } from '@/hooks/data';

export interface WeightModels {
  days: ModelDay[];
  /** Null with fewer than two weigh-ins. */
  models: { kcal: WeightModel; trend: WeightModel | null } | null;
}

const NONE: WeightModels = { days: [], models: null };

/**
 * The weight model with calories and the one without (`buildWeightModel`), from the first weigh-in to today:
 * weigh-ins and the net kcal of complete days, training and steps as the settings credit them. The maintenance
 * starts at the formula on the first weigh-in. Reads nothing while `enabled` is off; undefined while loading.
 */
export function useWeightModel(enabled: boolean): WeightModels | undefined {
  const db = useDb();
  const today = useToday();
  return useLiveQuery(async () => {
    if (!enabled) return NONE;
    const weights = (await db.weightEntries.filter((w) => !w.deleted).toArray()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const start = weights[0]?.date;
    if (!start || start > today) return NONE;
    const [entries, exercises, goals, notes, settings] = await Promise.all([
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
    const days = modelDays({ rows, weights, from: start, to: today, credit: creditOf(settings) });
    const profile = settings ? bodyProfile(settings, weights[0]!.kg, start) : null;
    const formula = profile && settings ? Math.round(tdee(profile, settings.activityLevel)) : undefined;
    const kcal = buildWeightModel({ days, mode: 'kcal', startMaintenance: formula });
    if (!kcal) return { days, models: null };
    return { days, models: { kcal, trend: buildWeightModel({ days, mode: 'trend' }) } };
  }, [db, today, enabled]);
}
