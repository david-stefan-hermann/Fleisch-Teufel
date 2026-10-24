import { dayId, goalForDate, SETTINGS_ID, uniformWeek, type DayTarget, type Settings } from '@ft/shared';
import type { UserDb } from '@/db/dexie';
import { saveRecord } from '@/db/write';

/**
 * Persists the onboarding result: profile, weight and a goal valid from today. Running the
 * calculator again keeps what it did not ask about: a weight that is only the prefilled last entry
 * is not written as today's measurement, and the micronutrient targets of the goal valid so far
 * carry over.
 */
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
  const { updatedAt: _u, deleted: _d, ...settings } = base;
  await saveRecord(db, 'settings', {
    ...settings,
    ...profile,
    id: SETTINGS_ID,
    onboardedAt: base.onboardedAt ?? Date.now(),
  });
  const todays = await db.weightEntries.get(dayId.weight(today));
  const latest = (await db.weightEntries.filter((w) => !w.deleted).sortBy('date')).at(-1);
  const known = todays && !todays.deleted ? todays.kg : latest?.kg;
  if (known !== weightKg)
    await saveRecord(db, 'weightEntries', { id: dayId.weight(today), date: today, kg: weightKg });
  const current = goalForDate(await db.goals.toArray(), today);
  await saveRecord(db, 'goals', {
    id: dayId.goal(today),
    validFrom: today,
    days: uniformWeek(target),
    micros: current?.micros ?? {},
  });
}
