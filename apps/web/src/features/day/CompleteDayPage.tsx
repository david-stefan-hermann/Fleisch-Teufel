import {
  bodyProfile,
  dailyDeltaForWeeklyRate,
  dayId,
  fiveWeekForecast,
  get,
  N,
  round,
  tdee,
} from '@ft/shared';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { saveRecord } from '@/db/write';
import { useCurrentWeight, useDayNote, useDaySummary, useSettings } from '@/hooks/data';
import { fmt0, fmt1, fmtDayLong } from '@/lib/format';

/** "Tag abschließen" (feature #10): 5-week forecast if every day were like this one. */
export function CompleteDayPage() {
  const { date } = useParams({ from: '/authed/day/$date/complete' });
  const db = useDb();
  const navigate = useNavigate();
  const summary = useDaySummary(date);
  const settings = useSettings();
  const note = useDayNote(date);
  const weight = useCurrentWeight(date);
  if (!summary || !settings || note === undefined)
    return (
      <Page title="Tag abschließen" back withTabBar={false}>
        {null}
      </Page>
    );

  const eaten = get(summary.food, N.kcal);
  const credited = settings.addExerciseCalories ? summary.exerciseKcal : 0;
  const net = eaten - credited;
  // Maintenance from the profile and this day's weight. Only without a complete profile the goal
  // minus the planned daily delta stands in (wrong once the goal was clamped or edited by hand).
  const profile = bodyProfile(settings, weight, date);
  const maintenance = profile
    ? Math.round(tdee(profile, settings.activityLevel))
    : summary.targets.kcal - dailyDeltaForWeeklyRate(settings.weeklyRateKg);
  const forecast =
    weight !== undefined
      ? fiveWeekForecast({ currentWeightKg: weight, netKcal: net, maintenanceKcal: maintenance })
      : null;
  const empty = summary.entryCount === 0;

  async function complete(done: boolean) {
    await saveRecord(db, 'dayNotes', {
      id: dayId.note(date),
      date,
      note: note?.note ?? '',
      completedAt: done ? Date.now() : null,
    });
    if (done) toast.success('Tag abgeschlossen');
    await navigate({ to: '/', search: { date } });
  }

  return (
    <Page title="Tag abschließen" back withTabBar={false}>
      <p className="mb-4 text-sm text-muted-foreground">{fmtDayLong(date)}</p>
      <Section>
        <dl className="tabular grid grid-cols-3 gap-2 p-4 text-center">
          <div>
            <dt className="text-xs text-muted-foreground">Gegessen</dt>
            <dd className="text-lg font-semibold">{fmt0(eaten)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Training</dt>
            <dd className="text-lg font-semibold">−{fmt0(credited)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ziel</dt>
            <dd className="text-lg font-semibold">{fmt0(summary.targets.kcal)}</dd>
          </div>
        </dl>
      </Section>

      {empty ? (
        <Section>
          <p className="p-4 text-sm text-muted-foreground">
            An diesem Tag ist noch nichts eingetragen, die Prognose wäre nicht aussagekräftig.
          </p>
        </Section>
      ) : forecast ? (
        <Section>
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            {forecast.deltaKg <= 0 ? (
              <TrendingDown className="size-8 text-good" aria-hidden />
            ) : (
              <TrendingUp className="size-8 text-warn" aria-hidden />
            )}
            <p className="text-sm text-muted-foreground text-balance">
              Wenn jeder Tag so wäre wie heute, würdest du in 5 Wochen etwa so viel wiegen:
            </p>
            <p className="tabular text-4xl font-bold">{fmt1(forecast.kg)} kg</p>
            <p className="tabular text-sm text-muted-foreground">
              {forecast.deltaKg <= 0 ? '' : '+'}
              {fmt1(round(forecast.deltaKg, 1))} kg gegenüber {fmt1(weight!)} kg
            </p>
            <p className="mt-2 text-xs text-muted-foreground text-pretty">
              Grob gerechnet: (netto {fmt0(net)} − Erhaltungsbedarf {fmt0(maintenance)} kcal) × 35 Tage ÷ 7700
              kcal/kg. Wasser und Verdauung lassen die Waage täglich schwanken.
              {!profile &&
                ' Der Erhaltungsbedarf ist aus dem Ziel geschätzt; genauer wird es mit vollständigem Profil.'}
            </p>
          </div>
        </Section>
      ) : (
        <Section>
          <p className="p-4 text-sm text-muted-foreground">
            Für die Prognose fehlt dein Gewicht.{' '}
            <Link to="/progress" search={{ log: true }} className="text-primary underline">
              Gewicht eintragen
            </Link>
          </p>
        </Section>
      )}

      {note?.completedAt ? (
        <Button variant="outline" size="lg" className="w-full" onClick={() => void complete(false)}>
          Tag wieder öffnen
        </Button>
      ) : (
        <Button size="lg" className="w-full" onClick={() => void complete(true)}>
          <CheckCircle2 aria-hidden /> Tag abschließen
        </Button>
      )}
    </Page>
  );
}
