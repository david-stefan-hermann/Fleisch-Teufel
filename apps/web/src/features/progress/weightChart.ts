import {
  addDays,
  dateRange,
  forecastAt,
  round,
  type DayForecast,
  type ISODate,
  type WeightPoint,
} from '@ft/shared';
import type { ChartRay, ChartSeries } from '@/components/Chart';
import { fmt2 } from '@/lib/format';
import { xOf } from '@/lib/time';

/** At most this many forecast rays; with more days every n-th one, the newest always. */
export const MAX_RAYS = 120;

const kg = (v: number) => `${fmt2(v)} kg`;

export interface WeightChart {
  data: [number[], ...(number | null)[][]];
  series: ChartSeries[];
  yRange: [number, number] | undefined;
  /** Undefined without forecasts (the chart then looks as before they existed). */
  rays: ChartRay[] | undefined;
  xRange: [ISODate, ISODate];
}

/** Every n-th forecast so that at most `max` remain, always with the newest. */
export function thinForecasts(list: readonly DayForecast[], max = MAX_RAYS): DayForecast[] {
  if (list.length <= max) return [...list];
  const step = Math.ceil(list.length / max);
  const keep = (list.length - 1) % step;
  return list.filter((_, i) => i % step === keep);
}

/**
 * Data of the weight chart: weigh-ins, their 7-day mean and the target. With forecasts the x values
 * are every day from `from` to today (each day gets a cursor position and so its ray), a legend
 * series names the forecast weight `horizon` days later, and the x range reaches that far.
 */
export function weightChart(params: {
  /** Weigh-ins of the period, ascending. */
  visible: readonly WeightPoint[];
  /** 7-day mean at every weigh-in (any dates). */
  avg: readonly WeightPoint[];
  target: number | null;
  from: ISODate;
  today: ISODate;
  /** The forecasts of the single days; empty or undefined while off. */
  forecasts?: readonly DayForecast[];
  horizon: number;
}): WeightChart {
  const { visible, target, from, today, horizon } = params;
  const avgByDate = new Map(params.avg.map((p) => [p.date, p.kg]));
  const forecasts = thinForecasts((params.forecasts ?? []).filter((f) => f.date >= from && f.date <= today));
  const withRays = forecasts.length > 0;
  const series: ChartSeries[] = [
    { label: 'Gewicht', color: '--muted-foreground', kind: 'points', format: kg },
    { label: '7-Tage-Mittel', color: '--primary', kind: 'line', width: 2.5, format: kg },
  ];
  let dates: ISODate[];
  let weight: (number | null)[];
  if (withRays) {
    dates = dateRange(from, today);
    const byDate = new Map(visible.map((w) => [w.date, w.kg]));
    weight = dates.map((d) => byDate.get(d) ?? null);
  } else {
    dates = visible.map((w) => w.date);
    weight = visible.map((w) => w.kg);
  }
  const data: (number | null)[][] = [
    weight,
    weight.map((v, i) => (v === null ? null : round(avgByDate.get(dates[i]!) ?? v, 2))),
  ];
  if (target !== null) {
    series.push({ label: 'Ziel', color: '--good', kind: 'line', dash: [6, 6], width: 1.5, format: kg });
    data.push(dates.map(() => target));
  }
  let rays: ChartRay[] | undefined;
  if (withRays) {
    rays = forecasts.map((f) => ({
      from: f.date,
      to: addDays(f.date, horizon),
      y0: f.startKg,
      y1: forecastAt(f, horizon).kg,
    }));
    const end = new Map(rays.map((r) => [r.from, round(r.y1, 2)]));
    series.push({
      label: `Prognose +${horizon} T`,
      color: '--primary',
      kind: 'legend',
      cursorPoint: false,
      format: kg,
    });
    data.push(dates.map((d) => end.get(d) ?? null));
  }
  // All values equal (one weigh-in): uPlot would span 50 to 150 kg; ±2 kg around the value instead.
  const values = [
    ...data.flat().filter((v): v is number => v !== null),
    ...(rays ?? []).flatMap((r) => [r.y0, r.y1]),
  ];
  const flat = values.length > 0 && Math.max(...values) - Math.min(...values) < 0.001;
  return {
    data: [dates.map(xOf), ...data],
    series,
    yRange: flat ? [values[0]! - 2, values[0]! + 2] : undefined,
    rays,
    xRange: [from, withRays ? addDays(today, horizon) : today],
  };
}
