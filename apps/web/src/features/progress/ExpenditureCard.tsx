import {
  addDays,
  bodyProfile,
  EXPENDITURE_MIN_DAYS,
  EXPENDITURE_MIN_WEIGH_INS,
  goalForDate,
  targetFromExpenditure,
  tdee,
  type Goal,
  type ISODate,
  type Settings,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { applyTargetKcal } from '@/features/goals/applyTargetKcal';
import { useExpenditure } from '@/hooks/useExpenditure';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmt2, fmtDate } from '@/lib/format';

/** A suggestion smaller than this is noise, not a reason to change the goal. */
const SUGGEST_FROM_KCAL = 100;
const DISMISS_KEY = 'expenditure.dismissedUntil';
const DISMISS_DAYS = 7;

/**
 * "Bedarf aus deinen Daten" on the progress page: the expenditure estimated from what was eaten
 * and how the weight trend moved (`estimateExpenditure`), next to the formula value, and an
 * optional suggestion for the kcal target that the person applies or puts off for a week. The
 * goal never changes by itself.
 */
export function ExpenditureCard({
  today,
  settings,
  goals,
  weightKg,
}: {
  today: ISODate;
  settings: Settings;
  goals: Goal[];
  weightKg: number | null;
}) {
  const db = useDb();
  const state = useExpenditure(today);
  const dismissedUntil = useLiveQuery(
    async () => ((await db.kv.get(DISMISS_KEY))?.value as string | undefined) ?? null,
    [db],
  );
  const { busy, run } = useSubmitting();
  if (!state || dismissedUntil === undefined) return null;
  const est = state.estimate;
  const profile = bodyProfile(settings, weightKg, today);
  const formula = profile ? Math.round(tdee(profile, settings.activityLevel)) : null;
  const goal = goalForDate(goals, today);
  const currentAvg = goal ? Math.round(goal.days.reduce((s, d) => s + d.kcal, 0) / goal.days.length) : null;
  const suggested = est ? targetFromExpenditure(est.kcal, settings.weeklyRateKg, settings.sex) : null;
  const diff = suggested !== null && currentAvg !== null ? suggested - currentAvg : 0;
  const dismissed = dismissedUntil !== null && dismissedUntil > today;
  const showSuggestion = suggested !== null && Math.abs(diff) >= SUGGEST_FROM_KCAL && !dismissed;

  async function apply() {
    if (suggested === null || weightKg === null) return;
    await applyTargetKcal(db, { kcal: suggested, weightKg, settings, goals, today });
    toast.success(`Ziel ab heute ${fmt0(suggested)} kcal`, {
      description: 'Makros nach deinem Plan. Unter „Ziele“ kannst du alles nachjustieren.',
    });
  }

  async function later() {
    await db.kv.put({ key: DISMISS_KEY, value: addDays(today, DISMISS_DAYS) });
  }

  return (
    <Section title="Bedarf aus deinen Daten">
      {est ? (
        <div className="grid gap-2 px-4 pb-4">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="tabular text-3xl font-bold">{fmt0(est.kcal)}</span>
            <span className="text-sm text-muted-foreground">kcal am Tag, ohne Training</span>
            {formula !== null && (
              <span className="tabular text-sm text-muted-foreground">· Formel {fmt0(formula)} kcal</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            Aus Ø {fmt0(est.intakeAvg)} kcal gegessen
            {est.exerciseAvg > 0 ? ` und Ø ${fmt0(est.exerciseAvg)} kcal Training` : ''}, Gewichtstrend{' '}
            {est.weeklyTrendKg > 0 ? '+' : ''}
            {fmt2(est.weeklyTrendKg)} kg pro Woche, {fmt0(est.days)} vollständige Tage und{' '}
            {fmt0(est.weighIns)} Wiegungen seit {fmtDate(est.from)}.
            {est.confidence === 'medium' ? ' Wird mit jedem vollständigen Tag und Wiegen genauer.' : ''}
          </p>
          {showSuggestion ? (
            <div className="grid gap-2 rounded-xl bg-muted p-3 text-sm">
              <p className="text-pretty">
                Mit deinem Tempo ({settings.weeklyRateKg > 0 ? '+' : ''}
                {fmt2(settings.weeklyRateKg)} kg pro Woche) passen{' '}
                <strong className="tabular">{fmt0(suggested)} kcal</strong> am Tag. Dein Ziel liegt bei{' '}
                {fmt0(currentAvg!)} kcal.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || weightKg === null} onClick={() => void run(apply)}>
                  Ziel auf {fmt0(suggested)} kcal setzen
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void later()}>
                  Später
                </Button>
              </div>
            </div>
          ) : suggested !== null && currentAvg !== null && Math.abs(diff) < SUGGEST_FROM_KCAL ? (
            <p className="text-xs text-muted-foreground">Dein Ziel ({fmt0(currentAvg)} kcal) passt dazu.</p>
          ) : null}
        </div>
      ) : (
        <p className="px-4 pb-4 text-sm text-muted-foreground text-pretty">
          Nach {EXPENDITURE_MIN_DAYS} vollständig erfassten Tagen (mindestens zwei Mahlzeiten oder „Tag
          abschließen“) und {EXPENDITURE_MIN_WEIGH_INS} Wiegungen in drei Wochen steht hier dein
          Erhaltungsbedarf aus Essen und Gewichtstrend statt aus der Formel. Bisher:{' '}
          {fmt0(state.completeDays)} Tage, {fmt0(state.weighIns)} Wiegungen.
        </p>
      )}
    </Section>
  );
}
