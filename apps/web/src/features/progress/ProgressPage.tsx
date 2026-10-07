import { addDays, bmi, dayId, linearTrend, movingAverage, round, type WeightEntry } from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Scale, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Chart, xOf, type ChartSeries } from '@/components/Chart';
import { NumberField } from '@/components/NumberField';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';
import { useSettings, useToday, useWeights } from '@/hooks/data';
import { fmt1, fmtDate } from '@/lib/format';

const RANGES = [
  { id: '7', label: '7 T', days: 7 },
  { id: '30', label: '30 T', days: 30 },
  { id: '90', label: '90 T', days: 90 },
  { id: 'all', label: 'Alle', days: null },
] as const;

const kg = (v: number) => `${fmt1(v)} kg`;

export function ProgressPage() {
  const search = useSearch({ from: '/authed/progress' });
  const navigate = useNavigate({ from: '/progress' });
  const today = useToday();
  const db = useDb();
  const weights = useWeights();
  const settings = useSettings();
  const range = RANGES.find((r) => r.id === search.range) ?? RANGES[1];
  const [editing, setEditing] = useState<WeightEntry | null>(null);
  const logOpen = search.log === true || editing !== null;
  const setLogOpen = (open: boolean) => {
    if (!open) setEditing(null);
    void navigate({ search: (s) => ({ ...s, log: open ? true : undefined }), replace: true });
  };

  const from = range.days ? addDays(today, -range.days + 1) : (weights?.[0]?.date ?? today);
  const visible = useMemo(() => (weights ?? []).filter((w) => w.date >= from), [weights, from]);
  const latest = weights?.at(-1);
  const avg = useMemo(() => movingAverage(weights ?? [], 7), [weights]);
  const trend30 = useMemo(
    () => linearTrend((weights ?? []).filter((w) => w.date >= addDays(today, -29))),
    [weights, today],
  );
  const target = settings?.targetWeightKg ?? null;

  const { data, series } = useMemo(() => {
    const xs = visible.map((w) => xOf(w.date));
    const avgByDate = new Map(avg.map((p) => [p.date, p.kg]));
    const s: ChartSeries[] = [
      { label: 'Gewicht', color: '--muted-foreground', kind: 'points', format: kg },
      { label: '7-Tage-Mittel', color: '--primary', kind: 'line', width: 2.5, format: kg },
    ];
    const d: (number | null)[][] = [
      visible.map((w) => w.kg),
      visible.map((w) => round(avgByDate.get(w.date) ?? w.kg, 2)),
    ];
    if (target !== null) {
      s.push({ label: 'Ziel', color: '--good', kind: 'line', dash: [6, 6], width: 1.5, format: kg });
      d.push(visible.map(() => target));
    }
    return { data: [xs, ...d] as [number[], ...(number | null)[][]], series: s };
  }, [visible, avg, target]);

  const change = (days: number) => {
    if (!weights || weights.length < 2 || !latest) return null;
    const ref = [...weights].reverse().find((w) => w.date <= addDays(latest.date, -days));
    return ref ? round(latest.kg - ref.kg, 1) : null;
  };
  const weekly = trend30 ? round(trend30.slopePerDay * 7, 2) : null;

  return (
    <Page
      title="Fortschritt"
      actions={
        <Button variant="ghost" size="icon" onClick={() => setLogOpen(true)} aria-label="Gewicht eintragen">
          <Plus aria-hidden />
        </Button>
      }
    >
      {weights && weights.length === 0 ? (
        <EmptyState icon={<Scale />} title="Noch kein Gewicht eingetragen">
          <p>Wiege dich am besten morgens nach dem Aufstehen – der Trend zählt, nicht der einzelne Wert.</p>
          <Button className="mt-4" onClick={() => setLogOpen(true)}>
            Gewicht eintragen
          </Button>
        </EmptyState>
      ) : (
        <>
          <Section>
            <dl className="tabular grid grid-cols-3 gap-2 p-4 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">Aktuell</dt>
                <dd className="text-xl font-bold">{latest ? kg(latest.kg) : '–'}</dd>
                {latest && <dd className="text-[11px] text-muted-foreground">{fmtDate(latest.date)}</dd>}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Trend / Woche</dt>
                <dd className="text-xl font-bold">
                  {weekly === null ? '–' : `${weekly > 0 ? '+' : ''}${fmt1(weekly)}`}
                </dd>
                <dd className="text-[11px] text-muted-foreground">letzte 30 Tage</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {target !== null ? 'Bis zum Ziel' : '30 Tage'}
                </dt>
                <dd className="text-xl font-bold">
                  {target !== null && latest
                    ? kg(round(latest.kg - target, 1))
                    : change(30) === null
                      ? '–'
                      : `${change(30)! > 0 ? '+' : ''}${fmt1(change(30)!)}`}
                </dd>
                {target !== null && <dd className="text-[11px] text-muted-foreground">Ziel {kg(target)}</dd>}
              </div>
            </dl>
            {settings?.heightCm && latest && (
              <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
                BMI {fmt1(bmi(latest.kg, settings.heightCm))}
              </p>
            )}
          </Section>

          <Section
            title="Gewichtsverlauf"
            action={
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={range.id}
                onValueChange={(v) =>
                  v && void navigate({ search: (s) => ({ ...s, range: v }), replace: true })
                }
              >
                {RANGES.map((r) => (
                  <ToggleGroupItem key={r.id} value={r.id} className="px-2 text-xs">
                    {r.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            }
          >
            <div className="px-2 pb-3">
              {visible.length > 0 ? (
                <Chart
                  xRange={[from, today]}
                  data={data}
                  series={series}
                  title={`Gewicht der letzten ${range.days ?? 'gesamten'} Tage mit 7-Tage-Mittel`}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Keine Werte in diesem Zeitraum.</p>
              )}
            </div>
          </Section>

          <Section title="Einträge">
            <ul className="divide-y divide-border/70 pb-1">
              {[...(weights ?? [])]
                .reverse()
                .slice(0, 60)
                .map((w, i, arr) => {
                  const prev = arr[i + 1];
                  const diff = prev ? round(w.kg - prev.kg, 1) : null;
                  return (
                    <li key={w.id} className="flex items-center gap-2 pr-2">
                      <button
                        type="button"
                        onClick={() => setEditing(w)}
                        className="tabular flex min-h-12 flex-1 items-center justify-between px-4 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                      >
                        <span>{fmtDate(w.date)}</span>
                        <span>
                          <span className="font-semibold">{kg(w.kg)}</span>
                          {diff !== null && diff !== 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {diff > 0 ? '+' : ''}
                              {fmt1(diff)}
                            </span>
                          )}
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Eintrag vom ${fmtDate(w.date)} löschen`}
                        onClick={async () => {
                          await deleteRecord(db, 'weightEntries', w.id);
                          toast('Gewicht gelöscht', {
                            action: {
                              label: 'Rückgängig',
                              onClick: () => void restoreRecord(db, 'weightEntries', w.id),
                            },
                          });
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
            </ul>
          </Section>
        </>
      )}
      <WeightDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        today={today}
        entry={editing}
        last={latest?.kg ?? null}
      />
    </Page>
  );
}

function WeightDialog({
  open,
  onOpenChange,
  today,
  entry,
  last,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  today: string;
  entry: WeightEntry | null;
  last: number | null;
}) {
  const db = useDb();
  const [date, setDate] = useState(entry?.date ?? today);
  const [value, setValue] = useState<number | null>(entry?.kg ?? last);
  const [prevKey, setPrevKey] = useState('');
  // Re-initialize when opened, when editing another entry, or once the last weight has loaded.
  const key = `${open}-${entry?.id ?? ''}-${last ?? ''}`;
  if (key !== prevKey) {
    setPrevKey(key);
    setDate(entry?.date ?? today);
    setValue(entry?.kg ?? last);
  }
  const valid = value !== null && value >= 20 && value <= 400;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? 'Gewicht ändern' : 'Gewicht eintragen'}</DialogTitle>
          <DialogDescription>
            Ein Wert pro Tag – ein neuer Eintrag ersetzt den des gleichen Tages.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="w-date">Datum</Label>
            <Input
              id="w-date"
              type="date"
              value={date}
              max={today}
              disabled={!!entry}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <NumberField
            label="Gewicht"
            unit="kg"
            value={value}
            onValueChange={setValue}
            error={value !== null && !valid ? 'Zwischen 20 und 400 kg.' : null}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              await saveRecord(db, 'weightEntries', { id: dayId.weight(date), date, kg: round(value!, 2) });
              toast.success(`${fmt1(value!)} kg gespeichert`);
              onOpenChange(false);
            }}
          >
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
