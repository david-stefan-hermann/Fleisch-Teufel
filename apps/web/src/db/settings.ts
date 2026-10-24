import { DEFAULT_MEAL_NAMES, SETTINGS_ID, type Settings } from '@ft/shared';
import type { UserDb } from './dexie';
import { saveRecord } from './write';

/** What the app assumes before the person saved anything (`updatedAt: 0` marks "no record yet"). */
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
  macroPlan: null,
};

/**
 * The one way to change settings: only the given fields, on top of the current record (or the
 * defaults when there is none yet), read inside the write transaction. A page that saved the whole
 * copy it loaded would overwrite what another device changed meanwhile (meal names, plan).
 */
export async function saveSettings(
  db: UserDb,
  patch: Partial<Omit<Settings, 'id' | 'updatedAt' | 'deleted'>>,
): Promise<Settings> {
  return db.transaction('rw', [db.settings, db.outbox], async () => {
    const prev = await db.settings.get(SETTINGS_ID);
    const { updatedAt: _u, deleted: _d, ...base } = prev ?? DEFAULT_SETTINGS;
    return saveRecord(db, 'settings', { ...base, ...patch, id: SETTINGS_ID });
  });
}
