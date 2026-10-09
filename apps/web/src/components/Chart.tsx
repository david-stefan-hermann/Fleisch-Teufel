/**
 * Thin uPlot wrapper: responsive width, theme-aware colors (CSS custom properties, re-read on
 * light/dark switches), one y-axis only, live legend that doubles as hover tooltip (values of the
 * hovered day), and a visually hidden data table for screen readers.
 *
 * The plot is built once per series structure, height and theme; new data (another period) goes
 * in with `setData`, so switching periods does not flash a fresh chart.
 *
 * Stacked bars: uPlot does not stack, so the caller passes cumulative series, highest first, all
 * drawn from 0 (the lower ones cover the higher ones). Inner segments set `gapAbove` for the 2 px
 * surface gap and square tops; segment series usually set `legend: false`, and a `kind: 'legend'`
 * series carries the real value into the legend.
 */
import { useEffect, useRef } from 'react';
import uPlot, { type AlignedData, type Options, type Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useAppearance } from '@/lib/appearance';
import { NO_VALUE } from '@/lib/format';
import { xOf } from '@/lib/time';

export { xOf };

export interface ChartSeries {
  label: string;
  /** CSS custom property name, e.g. `--protein`. */
  color: string;
  /** 'legend': no mark, only a legend entry and value (e.g. the total of stacked bars). */
  kind?: 'line' | 'bars' | 'points' | 'step' | 'legend';
  /** false: no legend row, no screen reader column, no cursor point (stack segments). */
  legend?: false;
  /** Bars only: inner stack segment with a square top and a 2 px surface gap above it. */
  gapAbove?: boolean;
  dash?: number[];
  width?: number;
  /** Value formatter for legend/tooltip. */
  format?: (v: number) => string;
}

interface ChartProps {
  /** x in seconds (uPlot convention), then one array per series. */
  data: AlignedData;
  series: ChartSeries[];
  height?: number;
  yLabel?: string;
  /** Accessible summary of what the chart shows. */
  title: string;
  yRange?: [number | null, number | null];
  /** Fixed x-range [from, to] as ISO dates (keeps the period visible with few points). */
  xRange?: [string, string];
}

function cssVar(name: string, el: Element): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || '#888';
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dateLong = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function Chart({ data, series, height = 220, title, yRange, xRange }: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  // Colors are read from CSS variables: rebuild when the app theme changes.
  const dark = useAppearance().mode === 'dark';
  // Latest props for the long-lived plot (formatters, ranges, data at build time).
  const latest = useRef({ data, series, yRange, xRange });
  useEffect(() => {
    latest.current = { data, series, yRange, xRange };
  });
  // Rebuild only when the series change in shape or style, not for new values or ranges.
  const structure = JSON.stringify(series.map(({ format: _format, ...rest }) => rest));
  const hasYRange = yRange !== undefined;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const cfgs = latest.current.series;
    const ink = cssVar('--muted-foreground', el);
    const grid = cssVar('--border', el);
    const surface = cssVar('--card', el);
    const s: Series[] = [
      { label: 'Datum', value: (_u, v) => (v == null ? NO_VALUE : dateLong.format(new Date(v * 1000))) },
      ...cfgs.map((cfg, i): Series => {
        const color = cssVar(cfg.color, el);
        const base: Series = {
          label: cfg.label,
          stroke: color,
          width: cfg.width ?? 2,
          dash: cfg.dash,
          spanGaps: cfg.kind !== 'bars',
          value: (_u, v) => {
            const format = latest.current.series[i]?.format;
            return v == null ? NO_VALUE : (format?.(v) ?? String(Math.round(v)));
          },
          points: {
            show: cfg.kind === 'points',
            size: 7,
            stroke: color,
            fill: surface,
            width: 2,
          },
        };
        if (cfg.kind === 'bars')
          return {
            ...base,
            fill: color,
            width: 0,
            paths: uPlot.paths.bars!({
              size: [BAR_FACTOR, BAR_MAX],
              radius: cfg.gapAbove ? 0 : 0.25,
              gap: 2,
            }),
            points: { show: false },
          };
        if (cfg.kind === 'points') return { ...base, width: 0, paths: () => null };
        if (cfg.kind === 'legend') return { ...base, paths: () => null, points: { show: false } };
        if (cfg.kind === 'step') return { ...base, paths: uPlot.paths.stepped!({ align: 1 }) };
        return base;
      }),
    ];
    const opts: Options = {
      width: el.clientWidth,
      height,
      series: s,
      cursor: {
        drag: { x: false, y: false },
        points: { size: 8 },
      },
      legend: { live: true },
      hooks: {
        // Without hover the legend shows the most recent values instead of dashes.
        setCursor: [
          (u) => {
            if (u.cursor.idx == null) u.setLegend({ idx: lastIndex(u.data) });
          },
        ],
        ready: [
          (u) => {
            // Stack segments have no legend row (and so cannot be hidden by a click on one) and no
            // cursor point; the legend-only total marks the top of the stack instead.
            const rows = u.root.querySelectorAll<HTMLElement>('.u-legend .u-series');
            const pts = u.root.querySelectorAll<HTMLElement>('.u-cursor-pt');
            cfgs.forEach((cfg, i) => {
              if (cfg.legend !== false) return;
              if (rows[i + 1]) rows[i + 1]!.style.display = 'none';
              if (pts.length === cfgs.length) pts[i]!.style.display = 'none';
            });
            u.setLegend({ idx: lastIndex(u.data) });
          },
        ],
        drawSeries: [(u, si) => cfgs[si - 1]?.gapAbove && drawGapAbove(u, si, surface)],
      },
      scales: {
        x: {
          time: true,
          range: (_u, min, max): [number, number] => {
            const r = latest.current.xRange;
            return r ? [xOf(r[0]) - 43_200, xOf(r[1]) + 43_200] : [min, max];
          },
        },
        y: hasYRange
          ? {
              range: (_u, min, max): [number, number] => {
                const r = latest.current.yRange;
                return [r?.[0] ?? min, r?.[1] ?? max];
              },
            }
          : {},
      },
      axes: [
        {
          stroke: ink,
          grid: { show: false },
          ticks: { stroke: grid, size: 4 },
          values: (_u, ticks) => ticks.map((t) => dateFmt.format(new Date(t * 1000))),
          font: '11px Inter Variable, system-ui',
        },
        {
          stroke: ink,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          size: 44,
          font: '11px Inter Variable, system-ui',
          values: (_u, ticks) => ticks.map((t) => t.toLocaleString('de-DE')),
        },
      ],
    };
    plot.current?.destroy();
    plot.current = new uPlot(opts, latest.current.data, el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [structure, height, dark, hasYRange]);

  // New values (another period, a new entry) update the existing plot.
  useEffect(() => {
    const u = plot.current;
    if (!u || u.data === data) return;
    u.setData(data);
    u.setLegend({ idx: lastIndex(data) });
  }, [data]);

  const xs = data[0] as number[];
  const tableSeries = series.map((s, si) => ({ s, si })).filter(({ s }) => s.legend !== false);
  return (
    <figure className="ft-chart">
      <div ref={wrap} role="img" aria-label={title} className="w-full" />
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Datum</th>
            {tableSeries.map(({ s }) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xs.slice(-60).map((x, i0) => {
            const i = xs.length - Math.min(60, xs.length) + i0;
            return (
              <tr key={x}>
                <td>{dateLong.format(new Date(x * 1000))}</td>
                {tableSeries.map(({ s, si }) => {
                  const v = (data[si + 1] as (number | null)[])[i];
                  return <td key={s.label}>{v == null ? NO_VALUE : (s.format?.(v) ?? Math.round(v))}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

const BAR_FACTOR = 0.6;
const BAR_MAX = 24;
/** Height of the surface gap between stacked bar segments (CSS px). */
const STACK_GAP = 2;

/** Paints the surface gap on top of every bar of a stack segment (after the segment is drawn). */
function drawGapAbove(u: uPlot, si: number, surface: string) {
  const xs = u.data[0] as number[];
  const ys = u.data[si] as (number | null)[];
  const ratio = window.devicePixelRatio || 1;
  const step =
    xs.length > 1 ? Math.abs(u.valToPos(xs[1]!, 'x', true) - u.valToPos(xs[0]!, 'x', true)) : u.bbox.width;
  // A touch wider than the bar: the overhang lands on the card and is invisible.
  const w = Math.min(BAR_MAX * ratio, step * BAR_FACTOR) + 2 * ratio;
  const ctx = u.ctx;
  ctx.save();
  ctx.fillStyle = surface;
  ys.forEach((v, i) => {
    if (v == null || v <= 0) return;
    const x = u.valToPos(xs[i]!, 'x', true);
    const y = u.valToPos(v, 'y', true);
    ctx.fillRect(x - w / 2, y - (STACK_GAP * ratio) / 2, w, STACK_GAP * ratio);
  });
  ctx.restore();
}

/** Index of the newest x that has at least one non-null value. */
function lastIndex(data: AlignedData): number {
  const n = (data[0] as number[]).length;
  for (let i = n - 1; i >= 0; i--) {
    if (data.slice(1).some((s) => (s as (number | null)[])[i] != null)) return i;
  }
  return Math.max(0, n - 1);
}
