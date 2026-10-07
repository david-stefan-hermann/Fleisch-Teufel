/**
 * Thin uPlot wrapper: responsive width, theme-aware colors (CSS custom properties, re-read on
 * light/dark switches), one y-axis only, live legend that doubles as hover tooltip (values of the
 * hovered day), and a visually hidden data table for screen readers.
 */
import { useEffect, useRef, useState } from 'react';
import uPlot, { type AlignedData, type Options, type Series } from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  label: string;
  /** CSS custom property name, e.g. `--protein`. */
  color: string;
  kind?: 'line' | 'bars' | 'points' | 'step';
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

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setDark(mq.matches);
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  return dark;
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
  const dark = usePrefersDark();
  const xFrom = xRange?.[0];
  const xTo = xRange?.[1];

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ink = cssVar('--muted-foreground', el);
    const grid = cssVar('--border', el);
    const s: Series[] = [
      { label: 'Datum', value: (_u, v) => (v == null ? '–' : dateLong.format(new Date(v * 1000))) },
      ...series.map((cfg): Series => {
        const color = cssVar(cfg.color, el);
        const base: Series = {
          label: cfg.label,
          stroke: color,
          width: cfg.width ?? 2,
          dash: cfg.dash,
          spanGaps: cfg.kind !== 'bars',
          value: (_u, v) => (v == null ? '–' : (cfg.format?.(v) ?? String(Math.round(v)))),
          points: {
            show: cfg.kind === 'points',
            size: 7,
            stroke: color,
            fill: cssVar('--card', el),
            width: 2,
          },
        };
        if (cfg.kind === 'bars')
          return {
            ...base,
            fill: color,
            width: 0,
            paths: uPlot.paths.bars!({ size: [0.6, 24], radius: 0.25, gap: 2 }),
            points: { show: false },
          };
        if (cfg.kind === 'points') return { ...base, width: 0, paths: () => null };
        if (cfg.kind === 'step') return { ...base, paths: uPlot.paths.stepped!({ align: 1 }) };
        return base;
      }),
    ];
    const opts: Options = {
      width: el.clientWidth,
      height,
      series: s,
      cursor: { drag: { x: false, y: false }, points: { size: 8 } },
      legend: { live: true },
      scales: {
        x:
          xFrom && xTo
            ? { time: true, range: (): [number, number] => [xOf(xFrom) - 43_200, xOf(xTo) + 43_200] }
            : { time: true },
        y: yRange ? { range: (_u, min, max) => [yRange[0] ?? min, yRange[1] ?? max] } : {},
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
    plot.current = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [data, series, height, dark, yRange, xFrom, xTo]);

  const xs = data[0] as number[];
  return (
    <figure className="ft-chart">
      <div ref={wrap} role="img" aria-label={title} className="w-full" />
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Datum</th>
            {series.map((s) => (
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
                {series.map((s, si) => {
                  const v = (data[si + 1] as (number | null)[])[i];
                  return <td key={s.label}>{v == null ? '–' : (s.format?.(v) ?? Math.round(v))}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

/** ISO date → uPlot x (seconds, local noon to avoid DST edge cases). */
export function xOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getTime() / 1000;
}
