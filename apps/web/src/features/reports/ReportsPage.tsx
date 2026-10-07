import {
  addDays,
  dailyRows,
  endOfMonth,
  get,
  N,
  periodStats,
  startOfMonth,
  startOfWeek,
  targetsForDate,
  type DailyRow,
} from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Chart, xOf, type ChartSeries } from '@/components/Chart';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useGoals, useSettings, useToday } from '@/hooks/data';
import { fmt0, fmt1, fmtDate, fmtMonth, NO_VALUE } from '@/lib/format';
import { dailyCsv, downloadText, entriesCsv, exerciseCsv, weightsCsv } from './export';

type Range = 'week' | 'month' | '90';
type Metric = 'kcal' | 'macros' | 'weight' | 'fiber' | 'sugar' | 'satFat' | 'salt';

const METRICS: { id: Metric; label: string }[] = [
  { id: 'kcal', label: 'Kalorien' },
  { id: 'macros', label: 'Makronährstoffe' },
  { id: 'weight', label: 'Gewicht' },
  { id: 'fiber', label: 'Ballaststoffe' },
  { id: 'sugar', label: 'Zucker' },
  { id: 'satFat', label: 'Gesättigte Fettsäuren' },
  { id: 'salt', label: 'Salz' },
];
const MICRO_KEY = { fiber: N.fiber, sugar: N.sugar, satFat: N.satFat, salt: N.salt } as const;

function period(
  range: Range,
  end: string,
): { from: string; to: string; label: string; prev: string; next: string } {
  if (range === 'week') {
    const from = startOfWeek(end);
    const to = addDays(from, 6);
    return {
      from,
      to,
      label: `${fmtDate(from)} bis ${fmtDate(to)}`,
      prev: addDays(from, -1),
      next: addDays(to, 7),
    };
  }
  if (range === 'month') {
    const from = startOfMonth(end);
    const to = endOfMonth(end);
    return { from, to, label: fmtMonth(from), prev: addDays(from, -1), next: endOfMonth(addDays(to, 1)) };
  }
  const from = addDays(end, -89);
  return {
    from,
    to: end,
    label: `${fmtDate(from)} bis ${fmtDate(end)}`,
    prev: addDays(end, -90),
    next: addDays(end, 90),
  };
}

const g = (v: number) => `${fmt1(v)} g`;
const k = (v: number) => `${fmt0(v)} kcal`;

export function ReportsPage() {
  const search = useSearch({ from: '/authed/reports' });
  const navigate = useNavigate({ from: '/reports' });
  const today = useToday();
  const db = useDb();
  const goals = useGoals();
  const settings = useSettings();
  const range = (['week', 'month', '90'].includes(search.range ?? '') ? search.range : 'week') as Range;
  const metric = (METRICS.some((m) => m.id === search.metric) ? search.metric : 'kcal') as Metric;
  const p = period(range, search.end ?? today);
  const isCurrent = p.to >= today;

  const data = useLiveQuery(async () => {
    const [entries, exercises, weights] = await Promise.all([
      db.foodEntries
        .where('date')
        .between(p.from, p.to, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.exerciseEntries
        .where('date')
        .between(p.from, p.to, true, true)
        .filter((e) => !e.deleted)
        .toArray(),
      db.weightEntries.filter((w) => !w.deleted).toArray(),
    ]);
    return { entries, exercises, weights };
  }, [db, p.from, p.to]);

  const rows: DailyRow[] | null = useMemo(() => {
    if (!data || !goals) return null;
    // Only up to today: future days would count as "not logged".
    const to = p.to > today ? today : p.to;
    if (to < p.from) return [];
    return dailyRows({
      from: p.from,
      to,
      entries: data.entries,
      exercises: data.exercises,
      weights: data.weights,
      goals,
    });
  }, [data, goals, p.from, p.to, today]);
  const stats = rows ? periodStats(rows) : null;

  const chart = useMemo(() => (rows ? buildChart(rows, metric) : null), [rows, metric]);
  const set = (patch: Partial<{ range: string; end: string; metric: string }>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true });

  return (
    <Page title="Berichte">
      <div className="mb-4 grid gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={range}
          onValueChange={(v) => v && set({ range: v, end: undefined as never })}
          className="w-full"
        >
          <ToggleGroupItem value="week" className="flex-1">
            Woche
          </ToggleGroupItem>
          <ToggleGroupItem value="month" className="flex-1">
            Monat
          </ToggleGroupItem>
          <ToggleGroupItem value="90" className="flex-1">
            90 Tage
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Vorheriger Zeitraum"
            onClick={() => set({ end: p.prev })}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="font-medium">{p.label}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Nächster Zeitraum"
            disabled={isCurrent}
            onClick={() => set({ end: p.next > today ? today : p.next })}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      {stats && (
        <Section>
          <dl className="tabular grid grid-cols-2 gap-x-2 gap-y-4 p-4 pb-3.5 text-center">
            <Stat
              label="Ø kcal"
              value={stats.loggedDays ? fmt0(stats.avg.kcal) : NO_VALUE}
              sub={`Ziel Ø ${fmt0(stats.avgTargetKcal)}`}
            />
            <Stat
              label="Tage erfasst"
              value={`${stats.loggedDays}/${stats.days}`}
              sub={`${stats.daysUnderGoal} im Ziel`}
            />
            <Stat
              label="Gewicht"
              value={
                stats.weightChange === null
                  ? NO_VALUE
                  : `${stats.weightChange > 0 ? '+' : ''}${fmt1(stats.weightChange)} kg`
              }
              sub={stats.weightEnd !== null ? `${fmt1(stats.weightEnd)} kg` : 'keine Werte'}
            />
            <Stat
              label="Training"
              value={`${fmt0(stats.totalExerciseMinutes)} Min.`}
              sub={k(stats.totalExerciseKcal)}
            />
          </dl>
          {stats.loggedDays > 0 && (
            <NutrientBreakdown
              variant="day"
              className="mx-4 border-t border-border/70 pt-3.5"
              title="Ø pro Tag"
              nutrients={stats.avgNutrients}
              targets={{ ...stats.avgTargets, micros: targetsForDate(goals ?? [], p.to).micros }}
            />
          )}
          <p className="px-4 pt-2.5 pb-3 text-xs text-muted-foreground">
            Durchschnitte nur über Tage mit Einträgen.
          </p>
        </Section>
      )}

      <Section
        title={
          <div className="grid gap-1.5">
            <Label htmlFor="metric" className="sr-only">
              Kennzahl
            </Label>
            <Select value={metric} onValueChange={(v) => set({ metric: v })}>
              <SelectTrigger id="metric" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        <div className="px-2 pb-3">
          {chart && chart.hasData ? (
            <Chart
              xRange={[p.from, p.to]}
              data={chart.data}
              series={chart.series}
              title={`${METRICS.find((m) => m.id === metric)!.label} ${p.label}`}
              yRange={[0, null]}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">Keine Daten in diesem Zeitraum.</p>
          )}
        </div>
      </Section>

      <ExportSection
        from={p.from}
        to={p.to > today ? today : p.to}
        rows={rows}
        mealNames={settings?.mealNames ?? []}
      />
    </Page>
  );
}

function buildChart(
  rows: DailyRow[],
  metric: Metric,
): { data: [number[], ...(number | null)[][]]; series: ChartSeries[]; hasData: boolean } {
  const xs = rows.map((r) => xOf(r.date));
  const v = (fn: (r: DailyRow) => number) => rows.map((r) => (r.logged ? fn(r) : null));
  if (metric === 'kcal') {
    return {
      data: [xs, v((r) => get(r.nutrients, N.kcal)), rows.map((r) => r.targetKcal + r.exerciseKcal)],
      series: [
        { label: 'Gegessen', color: '--primary', kind: 'bars', format: k },
        {
          label: 'Ziel inkl. Training',
          color: '--foreground',
          kind: 'step',
          dash: [4, 4],
          width: 1.5,
          format: k,
        },
      ],
      hasData: rows.some((r) => r.logged),
    };
  }
  if (metric === 'macros') {
    return {
      data: [
        xs,
        v((r) => get(r.nutrients, N.protein)),
        v((r) => get(r.nutrients, N.carbs)),
        v((r) => get(r.nutrients, N.fat)),
      ],
      series: [
        { label: 'Protein', color: '--protein', format: g },
        { label: 'Kohlenhydrate', color: '--carbs', format: g },
        { label: 'Fett', color: '--fat', format: g },
      ],
      hasData: rows.some((r) => r.logged),
    };
  }
  if (metric === 'weight') {
    return {
      data: [xs, rows.map((r) => r.weightKg)],
      series: [{ label: 'Gewicht', color: '--primary', kind: 'line', format: (x) => `${fmt1(x)} kg` }],
      hasData: rows.some((r) => r.weightKg !== null),
    };
  }
  const key = MICRO_KEY[metric];
  return {
    data: [xs, v((r) => get(r.nutrients, key))],
    series: [
      { label: METRICS.find((m) => m.id === metric)!.label, color: '--primary', kind: 'bars', format: g },
    ],
    hasData: rows.some((r) => r.logged),
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-lg font-semibold">{value}</dd>
      {sub && <dd className="truncate text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function ExportSection({
  from,
  to,
  rows,
  mealNames,
}: {
  from: string;
  to: string;
  rows: DailyRow[] | null;
  mealNames: string[];
}) {
  const db = useDb();
  const [scope, setScope] = useState<'period' | 'all'>('period');
  const [dialect, setDialect] = useState<'excel-de' | 'standard'>('excel-de');
  const suffix = scope === 'all' ? 'gesamt' : `${from}_${to}`;

  async function run(kind: 'entries' | 'daily' | 'weights' | 'exercise') {
    const inRange = <T extends { date: string; deleted: boolean }>(list: T[]) =>
      list.filter((x) => !x.deleted && (scope === 'all' || (x.date >= from && x.date <= to)));
    let csv: string;
    if (kind === 'entries') csv = entriesCsv(inRange(await db.foodEntries.toArray()), mealNames, dialect);
    else if (kind === 'weights') csv = weightsCsv(inRange(await db.weightEntries.toArray()), dialect);
    else if (kind === 'exercise') csv = exerciseCsv(inRange(await db.exerciseEntries.toArray()), dialect);
    else {
      let r = rows ?? [];
      if (scope === 'all') {
        const entries = await db.foodEntries.filter((e) => !e.deleted).toArray();
        const first = entries.reduce((m, e) => (e.date < m ? e.date : m), to);
        r = dailyRows({
          from: first,
          to,
          entries,
          exercises: await db.exerciseEntries.filter((e) => !e.deleted).toArray(),
          weights: await db.weightEntries.filter((w) => !w.deleted).toArray(),
          goals: await db.goals.filter((x) => !x.deleted).toArray(),
        });
      }
      csv = dailyCsv(r, dialect);
    }
    const name = { entries: 'eintraege', daily: 'tage', weights: 'gewicht', exercise: 'training' }[kind];
    downloadText(`fleisch-teufel_${name}_${suffix}.csv`, csv);
    toast.success('CSV erstellt');
  }

  return (
    <Section title="Export (CSV)">
      <div className="grid gap-3 px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={scope}
            onValueChange={(v) => v && setScope(v as typeof scope)}
          >
            <ToggleGroupItem value="period" className="flex-1">
              Zeitraum
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="flex-1">
              Alles
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={dialect}
            onValueChange={(v) => v && setDialect(v as typeof dialect)}
          >
            <ToggleGroupItem value="excel-de" className="flex-1" title="Semikolon, Dezimalkomma">
              Excel
            </ToggleGroupItem>
            <ToggleGroupItem value="standard" className="flex-1" title="Komma, Dezimalpunkt">
              Standard
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void run('entries')}>
            <Download aria-hidden /> Einträge
          </Button>
          <Button variant="outline" onClick={() => void run('daily')}>
            <Download aria-hidden /> Tageswerte
          </Button>
          <Button variant="outline" onClick={() => void run('weights')}>
            <Download aria-hidden /> Gewicht
          </Button>
          <Button variant="outline" onClick={() => void run('exercise')}>
            <Download aria-hidden /> Training
          </Button>
        </div>
      </div>
    </Section>
  );
}
