import { addDays } from '@ft/shared';
import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { Slider } from '@/components/ui/slider';
import { fmt1, fmt2, fmtDayMonthShort, fmtDayShort, NO_VALUE } from '@/lib/format';
import {
  dayView,
  EXPECTED_MARGIN_KG,
  tickStep,
  type DayValue,
  type ForecastChartModel,
} from './forecastChart';

const HEIGHT = 220;
const PAD = { left: 36, right: 10, top: 10, bottom: 24 };
/** Weigh-ins and 7-day mean after the chosen day. */
const LATER_OPACITY = 0.3;

const kg = (v: number) => `${fmt2(v)} kg`;
const kg1 = (v: number) => `${fmt1(v)} kg`;

/**
 * The weight chart with forecasts (mockup v2, variant AB): behind the data the band of what was
 * expected for each day, and the forecast of the chosen day as a straight line with its band. A
 * day is chosen with the slider or by touching the chart (horizontal moves scrub, vertical ones
 * scroll the page). Drawn as SVG: the plain chart (uPlot) has no touch scrubbing.
 */
export function ForecastChart({
  model,
  selected,
  onSelect,
  title,
}: {
  model: ForecastChartModel;
  /** Index into `model.dates`. */
  selected: number;
  onSelect: (index: number) => void;
  title: string;
}) {
  const [width, setWidth] = useState(358);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.current.observe(el);
  }, []);

  const last = model.dates.length - 1;
  const span = Math.max(1, last + model.aheadDays);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const [y0, y1] = model.yRange;
  // Half a day of air on both ends, so no point sits on the axis labels.
  const sx = (i: number) => PAD.left + ((i + 0.5) / (span + 1)) * plotW;
  const sy = (v: number) => PAD.top + ((y1 - v) / (y1 - y0)) * plotH;
  const path = (pts: readonly DayValue[]) =>
    pts.map((p, k) => `${k ? 'L' : 'M'}${sx(p.i).toFixed(1)},${sy(p.kg).toFixed(1)}`).join('');
  const area = (pts: readonly { i: number; lo: number; hi: number }[]) =>
    pts.length < 2
      ? ''
      : path(pts.map((p) => ({ i: p.i, kg: p.hi }))) +
        [...pts]
          .reverse()
          .map((p) => `L${sx(p.i).toFixed(1)},${sy(p.lo).toFixed(1)}`)
          .join('') +
        'Z';

  const view = dayView(model, selected);
  const sel = view.index;
  // Expectation band in pieces where days have one.
  const pieces: { i: number; lo: number; hi: number }[][] = [];
  let piece: { i: number; lo: number; hi: number }[] = [];
  model.expected.forEach((e, i) => {
    if (e) piece.push({ i, lo: e.lo - EXPECTED_MARGIN_KG, hi: e.hi + EXPECTED_MARGIN_KG });
    else if (piece.length) {
      pieces.push(piece);
      piece = [];
    }
  });
  if (piece.length) pieces.push(piece);
  // The faded mean begins at the last weigh-in up to the chosen day, so the line has no gap.
  const meanBefore = model.means.filter((m) => m.i <= sel);
  const joint = meanBefore.at(-1)?.i ?? -1;
  const meanAfter = model.means.filter((m) => m.i >= joint && (m.i > sel || m.i === joint));

  const yTicks: number[] = [];
  const step = tickStep(y1 - y0);
  for (let v = y0; v <= y1 + 1e-9; v += step) yTicks.push(Math.round(v * 10) / 10);
  const dayStep = span <= 16 ? 3 : span <= 30 ? 7 : span <= 60 ? 14 : span <= 120 ? 30 : 60;
  const xTicks: number[] = [];
  for (let i = last; i >= 0; i -= dayStep) xTicks.push(i);
  for (let i = last + dayStep; i <= span; i += dayStep) xTicks.push(i);

  const dragging = useRef(false);
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((x - PAD.left) / plotW) * (span + 1) - 0.5);
    const next = Math.max(0, Math.min(last, i));
    if (next !== sel) onSelect(next);
  };

  const f = view.forecast;
  const isToday = sel === last;
  const expected = model.expected[sel];
  return (
    <figure className="ft-chart" ref={measure}>
      <svg
        role="img"
        aria-label={title}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block touch-pan-y select-none"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => dragging.current && pick(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(v)} y2={sy(v)} stroke="var(--border)" />
            <text
              x={PAD.left - 6}
              y={sy(v) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--muted-foreground)"
            >
              {v.toLocaleString('de-DE')}
            </text>
          </g>
        ))}
        {xTicks.map((i) => {
          const x = sx(i);
          // A label would reach into the y labels: left out.
          if (x < PAD.left + 18) return null;
          const anchor = x > width - PAD.right - 22 ? 'end' : 'middle';
          return (
            <text
              key={i}
              x={anchor === 'end' ? width - 2 : x}
              y={HEIGHT - 6}
              textAnchor={anchor}
              fontSize={11}
              fill="var(--muted-foreground)"
            >
              {fmtDayMonthShort(addDays(model.dates[0]!, i))}
            </text>
          );
        })}
        {pieces.map((p) => (
          <path key={p[0]!.i} d={area(p)} fill="var(--forecast)" fillOpacity={0.12} />
        ))}
        {view.band.length > 1 && <path d={area(view.band)} fill="var(--forecast)" fillOpacity={0.2} />}
        {model.target !== null && (
          <line
            x1={PAD.left}
            x2={sx(last)}
            y1={sy(model.target)}
            y2={sy(model.target)}
            stroke="var(--good)"
            strokeWidth={1.5}
            strokeDasharray="6 6"
          />
        )}
        <g fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d={path(meanAfter)} stroke="var(--primary)" strokeWidth={2.5} opacity={LATER_OPACITY} />
          <path d={path(meanBefore)} stroke="var(--primary)" strokeWidth={2.5} />
          {view.line.length > 1 && <path d={path(view.line)} stroke="var(--forecast)" strokeWidth={2} />}
        </g>
        {model.weights.map((w) => (
          <circle
            key={w.i}
            cx={sx(w.i)}
            cy={sy(w.kg)}
            r={3}
            fill="var(--card)"
            stroke="var(--muted-foreground)"
            strokeWidth={1.8}
            opacity={w.i > sel ? LATER_OPACITY : 1}
          />
        ))}
        <line
          x1={sx(sel)}
          x2={sx(sel)}
          y1={PAD.top}
          y2={HEIGHT - PAD.bottom}
          stroke="var(--muted-foreground)"
          strokeDasharray="3 3"
        />
        {f && <circle cx={sx(sel)} cy={sy(f.startKg)} r={4.5} fill="var(--primary)" />}
      </svg>
      <div className="px-3 pt-3 pb-1">
        <Slider
          aria-label="Tag der Prognose"
          aria-valuetext={fmtDayShort(view.date)}
          min={0}
          max={last}
          step={1}
          value={[sel]}
          onValueChange={([i]) => i !== undefined && i !== sel && onSelect(i)}
        />
      </div>
      <figcaption className="tabular px-2 pt-2 text-sm" data-testid="forecast-legend">
        <p className="font-semibold">
          {isToday ? `Heute, ${fmtDayShort(view.date)}` : fmtDayShort(view.date)}
        </p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <LegendRow swatch={<Line color="var(--primary)" />} label="7-Tage-Mittel">
            {model.meanOn[sel] != null ? kg(model.meanOn[sel]!) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Band opacity={0.35} />} label="Erwartet">
            {expected ? `${fmt1(expected.lo)} bis ${kg1(expected.hi)}` : NO_VALUE}
          </LegendRow>
          <LegendRow
            swatch={<Line color="var(--forecast)" />}
            label={
              isToday
                ? `Prognose für ${fmtDayMonthShort(addDays(view.date, model.aheadDays))}`
                : 'Prognose für heute'
            }
          >
            {view.prognosis ? kg1(view.prognosis.kg) : NO_VALUE}
          </LegendRow>
        </dl>
      </figcaption>
      <ScreenReaderTable model={model} title={title} />
    </figure>
  );
}

function LegendRow({
  swatch,
  label,
  children,
}: {
  swatch: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {swatch}
        {label}
      </dt>
      <dd className="font-semibold">{children}</dd>
    </>
  );
}

function Line({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: color }} />;
}

function Band({ opacity }: { opacity: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-3.5 rounded-sm"
      style={{ background: 'var(--forecast)', opacity }}
    />
  );
}

/** The last 60 days as a table for screen readers. */
function ScreenReaderTable({ model, title }: { model: ForecastChartModel; title: string }) {
  const first = Math.max(0, model.dates.length - 60);
  return (
    // sr-only alone still lets the wide table stretch the page sideways on a small screen.
    <div className="relative max-w-full overflow-hidden">
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Datum</th>
            <th>7-Tage-Mittel</th>
            <th>Erwartet</th>
            <th>Prognose</th>
          </tr>
        </thead>
        <tbody>
          {model.dates.slice(first).map((d, k) => {
            const i = first + k;
            const v = dayView(model, i).prognosis;
            const e = model.expected[i];
            return (
              <tr key={d}>
                <td>{fmtDayShort(d)}</td>
                <td>{model.meanOn[i] != null ? kg(model.meanOn[i]!) : NO_VALUE}</td>
                <td>{e ? `${fmt1(e.lo)} bis ${kg1(e.hi)}` : NO_VALUE}</td>
                <td>{v ? `${kg1(v.kg)} für ${fmtDayMonthShort(v.date)}` : NO_VALUE}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
