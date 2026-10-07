import { dayId, SETTINGS_ID, uniformWeek, type DayTarget, type Settings } from '@ft/shared';
import type { UserDb } from '@/db/dexie';
import { saveRecord } from '@/db/write';

/** Persists the onboarding result: profile, today's weight and a goal valid from today. */
export async function saveOnboarding(
  db: UserDb,
  input: {
    base: Settings;
    profile: Pick<
      Settings,
      'sex' | 'birthDate' | 'heightCm' | 'activityLevel' | 'targetWeightKg' | 'weeklyRateKg' | 'macroPlan'
    >;
    weightKg: number;
    target: DayTarget;
    today: string;
  },
): Promise<void> {
  const { base, profile, weightKg, target, today } = input;
  await saveRecord(db, 'settings', {
    ...base,
    ...profile,
    id: SETTINGS_ID,
    onboardedAt: base.onboardedAt ?? Date.now(),
  });
  await saveRecord(db, 'weightEntries', { id: dayId.weight(today), date: today, kg: weightKg });
  const existing = await db.goals.get(dayId.goal(today));
  await saveRecord(db, 'goals', {
    id: dayId.goal(today),
    validFrom: today,
    days: uniformWeek(target),
    micros: existing?.micros ?? {},
  });
}
