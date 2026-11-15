import {
  bodyProfile,
  calorieGoal,
  goalForDate,
  goalKindOf,
  macrosForPlan,
  weeklyRateForGoal,
  type ISODate,
} from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { useCurrentWeight, useGoals, useSettings } from '@/hooks/data';
import { useExpenditure } from '@/hooks/useExpenditure';
import { fmt0, NO_VALUE } from '@/lib/format';
import { initialPlan } from './goalPlan';

const DISMISS_KEY = 'goalRecalc.dismissed';

/**
 * "Neue Bedarfsrechnung" once in today's diary for people who set up their goal before the four
 * goals existed (`goalKind` null): the current target next to the one the new calculation gives,
 * and a link to run it. X hides it on this device; finishing the onboarding sets `goalKind`, which
 * hides it on every device. Nothing changes by itself.
 */
export function RecalcGoalCard({ today }: { today: ISODate }) {
  const db = useDb();
  const settings = useSettings();
  const goals = useGoals();
  const weight = useCurrentWeight(today);
  const expenditure = useExpenditure(today);
  const dismissed = useLiveQuery(async () => (await db.kv.get(DISMISS_KEY))?.value === true, [db]);
  if (!settings || !goals || dismissed !== false || expenditure === undefined) return null;
  if (settings.onboardedAt === null || settings.goalKind !== null) return null;

  const current = goalForDate(goals, today)?.days[0] ?? null;
  const profile = bodyProfile(settings, weight, today);
  const kind = goalKindOf(settings);
  const next =
    profile && weight !== undefined
      ? (() => {
          const g = calorieGoal(profile, settings.activityLevel, weeklyRateForGoal(kind, weight), {
            expenditureKcal: expenditure.estimate?.kcal ?? null,
          });
          return macrosForPlan(g.kcal, weight, initialPlan(settings, kind, true));
        })()
      : null;
  const line = (t: { kcal: number; proteinG: number } | null) =>
    t ? `${fmt0(t.kcal)} kcal · ${fmt0(t.proteinG)} g Eiweiß` : NO_VALUE;

  return (
    <Section
      title="Neue Bedarfsrechnung"
      action={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Neue Bedarfsrechnung ausblenden"
          onClick={() => void db.kv.put({ key: DISMISS_KEY, value: true })}
        >
          <X aria-hidden />
        </Button>
      }
    >
      <div className="grid gap-3 px-4 pb-4">
        {(current || next) && (
          <dl className="tabular grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Bisher</dt>
              <dd className="font-medium">{line(current)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Neu</dt>
              <dd className="font-semibold text-primary">{line(next)}</dd>
            </div>
          </dl>
        )}
        <Button asChild size="sm" className="justify-self-start">
          <Link to="/onboarding">Ziel neu berechnen</Link>
        </Button>
      </div>
    </Section>
  );
}
