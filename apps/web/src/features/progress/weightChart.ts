import {
  addDays,
  dateRange,
  diffDays,
  expectedRange,
  forecastSpread,
  round,
  simulateForecast,
  type DayForecast,
  type ISODate,
  type WeightPoint,
} from '@ft/shared';
import type { ChartOverlay, ChartSeries } from '@/components/Chart';
import { fmt1, fmt2, fmtDayMonthShort } from '@/lib/format';
import { xOf } from '@/lib/time';

/** Days the forecast of today reaches ahead. */
export const FORECAST_AHEAD_DAYS = 14;
/** The expectation band is drawn this much wider on both sides (else the forecasts of calm weeks make a hairline). */
const EXPECTED_MARGIN_KG = 0.1;
/** Weigh-ins and 7-day mean after the chosen day. */
const LATER_OPACITY = 0.3;

const kg = (v: number) => `${fmt2(v)} kg`;

export interface WeightChart {
  data: [number[], ...(number | null)[][]];
  /** The ISO date of every x value. */
  dates: ISODate[];
  series: ChartSeries[];
  yRange: [number, number] | undefined;
  /** Undefined without forecasts (the chart then looks as before they existed). */
  overlay: ChartOverlay | undefined;
  xRange: [ISODate, ISODate];
  /** Index of the chosen day (the legend shows it); undefined without forecasts. */
  legendIndex: number | undefined;
}

/**
 * Data of the weight chart: weigh-ins, their 7-day mean and the target. With forecasts every day from
 * `from` to today is an x value, the band of what the 14 days before each day expected for it lies
 * behind the data, and the chosen day (default today) shows its forecast as a simulated course with
 * its 80 % band up to today (today's 14 days ahead); what came after the chosen day is faded.
 */
export function weightChart(params: {
  /** Weigh-ins of the period, ascending. */
  visible: readonly WeightPoint[];
  /** 7-day mean at every weigh-in (any dates). */
  avg: readonly WeightPoint[];
  target: number | null;
  from: ISODate;
  today: ISODate;
  /** The forecasts of the single days (also of the 14 days before `from`); empty or undefined while off. */
  forecasts?: readonly DayForecast[];
  /** The chosen day; undefined or outside the period: today. */
  selected?: ISODate;
}): WeightChart {
  const { visible, target, from, today } = params;
  const avgByDate = new Map(params.avg.map((p) => [p.date, p.kg]));
  const byDate = new Map((params.forecasts ?? []).map((f) => [f.date, f]));
  const withForecasts = (params.forecasts ?? []).some((f) => f.date >= from && f.date <= today);
  const series: ChartSeries[] = [
    { label: 'Gewicht', color: '--muted-foreground', kind: 'points', format: kg },
    { label: '7-Tage-Mittel', color: '--primary', kind: 'line', width: 2.5, format: kg },
  ];
  if (!withForecasts) {
    const dates = visible.map((w) => w.date);
    const data: (number | null)[][] = [
      visible.map((w) => w.kg),
      visible.map((w) => round(avgByDate.get(w.date) ?? w.kg, 2)),
    ];
    if (target !== null) {
      series.push(targetSeries());
      data.push(dates.map(() => target));
    }
    return {
      data: [dates.map(xOf), ...data],
      dates,
      series,
      yRange: flatRange(data.flat()),
      overlay: undefined,
      xRange: [from, today],
      legendIndex: undefined,
    };
  }

  const dates = dateRange(from, today);
  const sel =
    params.selected && params.selected >= from && params.selected <= today ? params.selected : today;
  const selIdx = dates.indexOf(sel);
  const byWeigh = new Map(visible.map((w) => [w.date, w.kg]));
  const weight = dates.map((d) => byWeigh.get(d) ?? null);
  const mean = weight.map((v, i) => (v === null ? null : round(avgByDate.get(dates[i]!) ?? v, 2)));
  // The faded mean starts at the last weigh-in up to the chosen day, so the line has no gap.
  let joint = -1;
  for (let i = 0; i <= selIdx; i++) if (mean[i] !== null) joint = i;
  const data: (number | null)[][] = [
    weight.map((v, i) => (i <= selIdx ? v : null)),
    mean.map((v, i) => (i <= selIdx ? v : null)),
  ];
  if (target !== null) {
    series.push(targetSeries());
    data.push(dates.map(() => target));
  }
  series.push(
    {
      label: 'Gewicht danach',
      color: '--muted-foreground',
      kind: 'points',
      legend: false,
      opacity: LATER_OPACITY,
    },
    {
      label: '7-Tage-Mittel danach',
      color: '--primary',
      kind: 'line',
      width: 2.5,
      legend: false,
      opacity: LATER_OPACITY,
    },
  );
  data.push(
    weight.map((v, i) => (i > selIdx ? v : null)),
    mean.map((v, i) => (i > selIdx || (i === joint && joint >= 0) ? v : null)),
  );

  // What was expected for each day, and what each day forecast (for today; today for 14 days ahead).
  const expected = dates.map((d) => expectedRange(byDate, d));
  const ahead = (d: ISODate) => (d === today ? FORECAST_AHEAD_DAYS : diffDays(d, today));
  const end = (d: ISODate) => {
    const f = byDate.get(d);
    return f ? round(f.startKg + f.slopePerDay * ahead(d), 2) : null;
  };
  series.push(
    {
      label: 'Erwartet',
      color: '--primary',
      kind: 'legend',
      cursorPoint: false,
      format: (_v, i) => {
        const e = expected[i];
        return e ? `${fmt1(e.lo)} bis ${fmt1(e.hi)} kg` : '';
      },
    },
    {
      label: 'Prognose',
      color: '--primary',
      kind: 'legend',
      cursorPoint: false,
      format: (v, i) =>
        `${fmt1(v)} kg für ${dates[i] === today ? fmtDayMonthShort(addDays(today, FORECAST_AHEAD_DAYS)) : 'heute'}`,
    },
  );
  data.push(
    expected.map((e) => (e ? round(e.lo, 2) : null)),
    dates.map(end),
  );

  const overlay: ChartOverlay = { bands: [], lines: [] };
  // The expectation band, in pieces where days have one.
  let piece: { x: string; lo: number; hi: number }[] = [];
  const flush = () => {
    if (piece.length > 1) overlay.bands!.push({ points: piece, color: '--primary', opacity: 0.12 });
    piece = [];
  };
  expected.forEach((e, i) => {
    if (e) piece.push({ x: dates[i]!, lo: e.lo - EXPECTED_MARGIN_KG, hi: e.hi + EXPECTED_MARGIN_KG });
    else flush();
  });
  flush();
  const f = byDate.get(sel);
  if (f) {
    const days = ahead(sel);
    const course = simulateForecast(f, days);
    const points = course.map((_, h) => {
      const mid = f.startKg + f.slopePerDay * h;
      const spread = forecastSpread(f, h);
      return { x: addDays(sel, h), lo: mid - spread, hi: mid + spread };
    });
    overlay.bands!.push({ points, color: '--primary', opacity: 0.2 });
    overlay.lines!.push({
      points: course.map((y, h) => ({ x: addDays(sel, h), y })),
      color: '--primary',
      width: 2,
      opacity: 0.7,
    });
  }
  overlay.marker = { x: sel, y: f?.startKg ?? null, color: '--primary' };

  return {
    data: [dates.map(xOf), ...data],
    dates,
    series,
    yRange: flatRange([
      ...data.flat(),
      ...overlay.bands!.flatMap((b) => b.points.flatMap((p) => [p.lo, p.hi])),
    ]),
    overlay,
    xRange: [from, addDays(today, FORECAST_AHEAD_DAYS)],
    legendIndex: selIdx,
  };
}

function targetSeries(): ChartSeries {
  return { label: 'Ziel', color: '--good', kind: 'line', dash: [6, 6], width: 1.5, format: kg };
}

/** All values equal (one weigh-in): uPlot would span 50 to 150 kg; ±2 kg around the value instead. */
function flatRange(all: (number | null)[]): [number, number] | undefined {
  const values = all.filter((v): v is number => v !== null);
  const flat = values.length > 0 && Math.max(...values) - Math.min(...values) < 0.001;
  return flat ? [values[0]! - 2, values[0]! + 2] : undefined;
}
