import {
  dayId,
  DEFAULT_MACRO_PLAN,
  goalForDate,
  macrosForPlan,
  uniformWeek,
  type DayTarget,
  type Goal,
  type Settings,
} from '@ft/shared';
import type { UserDb } from '@/db/dexie';
import { saveRecord } from '@/db/write';

/**
 * Sets a new daily kcal target from today on ("Ziel auf X kcal setzen" after the data-based
 * expenditure). Weekdays that differ today keep their pattern (each day is scaled so the week's
 * average becomes `kcal`); the macros follow the person's plan and weight, the micronutrient
 * targets of the goal valid so far carry over.
 */
export async function applyTargetKcal(
  db: UserDb,
  input: {
    kcal: number;
    weightKg: number;
    settings: Pick<Settings, 'macroPlan'>;
    goals: readonly Goal[];
    today: string;
  },
): Promise<void> {
  const { kcal, weightKg, settings, goals, today } = input;
  const current = goalForDate(goals, today);
  const plan = settings.macroPlan ?? DEFAULT_MACRO_PLAN;
  const withMacros = (dayKcal: number): DayTarget => {
    const m = macrosForPlan(dayKcal, weightKg, plan);
    return { kcal: dayKcal, proteinG: m.proteinG, fatG: m.fatG, carbsG: m.carbsG };
  };
  const avg = current ? current.days.reduce((s, d) => s + d.kcal, 0) / current.days.length : 0;
  const days =
    current && avg > 0 && current.days.some((d) => d.kcal !== current.days[0]!.kcal)
      ? current.days.map((d) => withMacros(Math.round((d.kcal * kcal) / avg / 10) * 10))
      : uniformWeek(withMacros(kcal));
  await saveRecord(db, 'goals', {
    id: dayId.goal(today),
    validFrom: today,
    days,
    micros: current?.micros ?? {},
  });
}
