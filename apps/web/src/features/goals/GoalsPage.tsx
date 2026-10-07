import {
  dayId,
  FALLBACK_TARGET,
  goalForDate,
  kcalFromMacros,
  MICRO_DEFAULTS,
  microTarget,
  N,
  uniformWeek,
  WEEKDAYS_LONG_DE,
  WEEKDAYS_SHORT_DE,
  type DayTarget,
  type Goal,
  type MicroKey,
} from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { Calculator, History } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { saveRecord } from '@/db/write';
import { useGoals, useToday } from '@/hooks/data';
import { fmt0, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const MICRO_ROWS: { key: MicroKey; label: string }[] = [
  { key: N.fiber, label: 'Ballaststoffe (mind.)' },
  { key: N.sugar, label: 'Zucker (max.)' },
  { key: N.satFat, label: 'Ges. Fettsäuren (max.)' },
  { key: N.salt, label: 'Salz (max.)' },
];

/** Macro goals in grams, per weekday (feature #6), with history via `validFrom`. */
export function GoalsPage() {
  const today = useToday();
  const goals = useGoals();
  if (!goals) return null;
  return <GoalsForm goals={goals} today={today} />;
}

function GoalsForm({ goals, today }: { goals: Goal[]; today: string }) {
  const db = useDb();
  const current = goalForDate(goals, today);
  const [days, setDays] = useState<DayTarget[]>(() =>
    (current?.days ?? uniformWeek(FALLBACK_TARGET)).map((x) => ({ ...x })),
  );
  const [perDay, setPerDay] = useState(() => days.some((x) => JSON.stringify(x) !== JSON.stringify(days[0])));
  const [selected, setSelected] = useState(0);
  const [micros, setMicros] = useState<Partial<Record<MicroKey, number | null>>>(current?.micros ?? {});

  const idx = perDay ? selected : 0;
  const day = days[idx]!;
  const setDay = (patch: Partial<DayTarget>) =>
    setDays((ds) => ds.map((d, i) => (perDay ? (i === idx ? { ...d, ...patch } : d) : { ...d, ...patch })));
  const macroKcal = kcalFromMacros(day);

  async function save() {
    await saveRecord(db, 'goals', {
      id: dayId.goal(today),
      validFrom: today,
      days: perDay ? days : uniformWeek(days[0]!),
      micros,
    });
    toast.success('Ziele gespeichert – gelten ab heute');
  }

  return (
    <Page
      title="Ziele"
      back="/more"
      withTabBar={false}
      actions={
        <Button variant="ghost" size="icon" asChild>
          <Link to="/onboarding" aria-label="Neu berechnen">
            <Calculator aria-hidden />
          </Link>
        </Button>
      }
    >
      <Section>
        <div className="flex items-center justify-between gap-3 p-4">
          <Label htmlFor="per-day" className="flex-1">
            Unterschiedliche Ziele je Wochentag
            <span className="block text-xs font-normal text-muted-foreground">
              z. B. mehr Kalorien an Trainings- oder Wochenendtagen
            </span>
          </Label>
          <Switch id="per-day" checked={perDay} onCheckedChange={setPerDay} />
        </div>
        {perDay && (
          <div className="grid grid-cols-7 gap-1 px-4 pb-4" role="tablist" aria-label="Wochentag">
            {WEEKDAYS_SHORT_DE.map((w, i) => (
              <button
                key={w}
                type="button"
                role="tab"
                aria-selected={selected === i}
                aria-label={WEEKDAYS_LONG_DE[i]}
                onClick={() => setSelected(i)}
                className={cn(
                  'flex h-14 flex-col items-center justify-center rounded-lg border text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  selected === i ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                <span>{w}</span>
                <span className="tabular font-semibold">{fmt0(days[i]!.kcal)}</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title={perDay ? WEEKDAYS_LONG_DE[idx] : 'Jeden Tag'}>
        <div className="grid gap-3 px-4 pb-4">
          <NumberField
            label="Kalorien"
            unit="kcal"
            value={day.kcal}
            onValueChange={(v) => setDay({ kcal: v ?? 0 })}
            integer
          />
          <div className="grid grid-cols-3 gap-3">
            <NumberField
              label="Protein"
              unit="g"
              value={day.proteinG}
              onValueChange={(v) => setDay({ proteinG: v ?? 0 })}
              integer
            />
            <NumberField
              label="Kohlenh."
              unit="g"
              value={day.carbsG}
              onValueChange={(v) => setDay({ carbsG: v ?? 0 })}
              integer
            />
            <NumberField
              label="Fett"
              unit="g"
              value={day.fatG}
              onValueChange={(v) => setDay({ fatG: v ?? 0 })}
              integer
            />
          </div>
          <p
            className={cn(
              'text-xs',
              Math.abs(macroKcal - day.kcal) > 50 ? 'text-warn' : 'text-muted-foreground',
            )}
          >
            Makros ergeben {fmt0(macroKcal)} kcal
            {day.kcal > 0 &&
              ` · ${fmt0(((day.proteinG * 4) / day.kcal) * 100)} % Protein, ${fmt0(((day.carbsG * 4) / day.kcal) * 100)} % KH, ${fmt0(((day.fatG * 9) / day.kcal) * 100)} % Fett`}
            {Math.abs(macroKcal - day.kcal) > 50 && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => setDay({ kcal: Math.round(macroKcal) })}
                >
                  Kalorien anpassen
                </button>
              </>
            )}
          </p>
          {perDay && (
            <Button variant="outline" size="sm" onClick={() => setDays(days.map(() => ({ ...day })))}>
              Für alle Tage übernehmen
            </Button>
          )}
        </div>
      </Section>

      <Section title="Nährstoff-Ziele">
        <div className="grid gap-3 px-4 pb-4">
          <p className="text-xs text-muted-foreground">
            Leer lassen für DGE-Empfehlungen (abhängig vom Kalorienziel).
          </p>
          <div className="grid grid-cols-2 gap-3">
            {MICRO_ROWS.map((m) => (
              <NumberField
                key={m.key}
                label={m.label}
                unit="g"
                value={micros[m.key] ?? null}
                onValueChange={(v) => setMicros({ ...micros, [m.key]: v })}
                placeholder={String(microTarget(m.key, day.kcal))}
                hint={micros[m.key] == null ? MICRO_DEFAULTS[m.key].source.split(':')[0] : undefined}
              />
            ))}
          </div>
        </div>
      </Section>

      <Button size="lg" className="w-full" onClick={() => void save()}>
        Ziele speichern
      </Button>

      {goals && goals.length > 0 && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <History className="size-4" aria-hidden /> Verlauf
            </span>
          }
          className="mt-4"
        >
          <ul className="divide-y divide-border/70 pb-1">
            {[...goals].reverse().map((g) => (
              <li key={g.id} className="tabular flex justify-between px-4 py-2 text-sm">
                <span>ab {fmtDate(g.validFrom)}</span>
                <span className="text-muted-foreground">
                  {new Set(g.days.map((d) => d.kcal)).size > 1
                    ? `${fmt0(Math.min(...g.days.map((d) => d.kcal)))}–${fmt0(Math.max(...g.days.map((d) => d.kcal)))} kcal`
                    : `${fmt0(g.days[0]!.kcal)} kcal`}
                </span>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            Vergangene Tage werden immer mit dem damals gültigen Ziel bewertet.
          </p>
        </Section>
      )}
    </Page>
  );
}
