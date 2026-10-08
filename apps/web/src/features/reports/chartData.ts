import { energyBreakdown, get, N, type DailyRow } from '@ft/shared';
import type { ChartSeries } from '@/components/Chart';
import { xOf } from '@/lib/time';
import { fmt0, fmt1 } from '@/lib/format';

export type Metric = 'kcal' | 'macros' | 'weight' | 'fiber' | 'sugar' | 'satFat' | 'salt';

export const METRICS: { id: Metric; label: string }[] = [
  { id: 'kcal', label: 'Kalorien' },
  { id: 'macros', label: 'Makronährstoffe' },
  { id: 'weight', label: 'Gewicht' },
  { id: 'fiber', label: 'Ballaststoffe' },
  { id: 'sugar', label: 'Zucker' },
  { id: 'satFat', label: 'Gesättigte Fettsäuren' },
  { id: 'salt', label: 'Salz' },
];
const MICRO_KEY = { fiber: N.fiber, sugar: N.sugar, satFat: N.satFat, salt: N.salt } as const;

const g = (v: number) => `${fmt1(v)} g`;
const k = (v: number) => `${fmt0(v)} kcal`;

/** Series of the kcal chart (stable identity, so the chart only swaps its data). */
const KCAL_SERIES: ChartSeries[] = [
  // Cumulative from 0, highest first: total (fat on top), protein + carbs, protein.
  { label: 'Fett', color: '--fat', kind: 'bars', legend: false },
  { label: 'Kohlenhydrate', color: '--carbs', kind: 'bars', legend: false, gapAbove: true },
  { label: 'Protein', color: '--protein', kind: 'bars', legend: false, gapAbove: true },
  { label: 'Ohne Makros', color: '--bar-neutral', kind: 'bars', legend: false },
  { label: 'Gegessen', color: '--muted-foreground', kind: 'legend', format: k },
  { label: 'Ziel inkl. Training', color: '--foreground', kind: 'step', dash: [4, 4], width: 1.5, format: k },
];

export type ChartData = [number[], ...(number | null)[][]];

/**
 * Data of the report chart. Calories: each bar is as high as the eaten kcal and split by the
 * macros' energy shares (protein at the bottom, then carbs, then fat), like the split bar of the
 * overview; a day without macros is one grey bar. "Gegessen" carries the real kcal into the legend.
 */
export function buildChart(
  rows: DailyRow[],
  metric: Metric,
): { data: ChartData; series: ChartSeries[]; hasData: boolean } {
  const xs = rows.map((r) => xOf(r.date));
  const v = (fn: (r: DailyRow) => number) => rows.map((r) => (r.logged ? fn(r) : null));
  if (metric === 'kcal') {
    const parts = rows.map((r) => {
      if (!r.logged) return null;
      const kcal = get(r.nutrients, N.kcal);
      const { protein, carbs, fat } = energyBreakdown(r.nutrients).macros;
      const has = protein.share + carbs.share + fat.share > 0;
      return { kcal, has, p: kcal * protein.share, pc: kcal * (protein.share + carbs.share) };
    });
    const seg = (fn: (x: NonNullable<(typeof parts)[number]>) => number | null) =>
      parts.map((x) => (x && x.has ? fn(x) : null));
    return {
      data: [
        xs,
        seg((x) => x.kcal),
        seg((x) => (x.pc > 0 ? x.pc : null)),
        seg((x) => (x.p > 0 ? x.p : null)),
        parts.map((x) => (x && !x.has ? x.kcal : null)),
        parts.map((x) => x?.kcal ?? null),
        rows.map((r) => r.targetKcal + r.exerciseKcal),
      ],
      series: KCAL_SERIES,
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
