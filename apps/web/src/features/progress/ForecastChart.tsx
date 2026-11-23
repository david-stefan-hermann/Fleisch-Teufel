import { addDays, BAND_Z } from '@ft/shared';
import { useCallback, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { fmt1, fmtDayMonthShort, fmtDayShort, fmtKcal, fmtPercent, NO_VALUE } from '@/lib/format';
import { curvePath, dayView, tickStep, weighInHalf, type ForecastChartModel } from './forecastChart';

const HEIGHT = 220;
const KCAL_HEIGHT = 84;
const PAD = { left: 36, right: 10, top: 10, bottom: 24 };
/** Level after the chosen day; weigh-ins after it are a little stronger. */
const LATER_OPACITY = 0.3;
const LATER_WEIGH_OPACITY = 0.35;

const kg1 = (v: number) => `${fmt1(v)} kg`;
const range = ([lo, hi]: readonly [number, number]) => `${fmt1(lo)} bis ${kg1(hi)}`;
const factorText = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/**
 * The forecast chart (mockup v9): weigh-ins, the level of the weight model, and the forecast of the chosen day
 * up to the right edge as a lightly smoothed curve in a smooth band (inner: the curve, outer: a weigh-in, 80 %
 * after the back-test); dashed the forecast without calories. Below it the calories the model ran on. A day is
 * chosen by touching the chart (horizontal moves scrub, vertical ones scroll the page) or with the arrow keys.
 * Drawn as SVG: uPlot has no touch scrubbing.
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
  const clipId = useId();

  const last = model.dates.length - 1;
  const span = Math.max(1, last + model.aheadDays);
  const plotW = width - PAD.left - PAD.right;
  const [y0, y1] = model.yRange;
  const [k0, k1] = model.kcalRange;
  // Half a day of air on both ends, so no point sits on the axis labels.
  const sx = (i: number) => PAD.left + ((i + 0.5) / (span + 1)) * plotW;
  const sy = (v: number) => PAD.top + ((y1 - v) / (y1 - y0)) * (HEIGHT - PAD.top - PAD.bottom);
  const ky = (v: number) => PAD.top + ((k1 - v) / (k1 - k0)) * (KCAL_HEIGHT - PAD.top - PAD.bottom);
  const curve = <T extends { i: number }>(pts: readonly T[], y: (p: T) => number, ys = sy) =>
    curvePath(pts.map((p) => [sx(p.i), ys(y(p))] as const));
  const area = (pts: readonly { i: number; lo: number; hi: number }[]) =>
    pts.length < 2
      ? ''
      : curvePath(pts.map((p) => [sx(p.i), sy(p.hi)] as const)) +
        curvePath([...pts].reverse().map((p) => [sx(p.i), sy(p.lo)] as const)).replace(/^M/, 'L') +
        'Z';

  const view = dayView(model, selected);
  const sel = view.index;
  const factor = model.calibration.factor;
  const outer = view.curve.map((p) => ({
    i: p.i,
    lo: p.level - weighInHalf(p, factor),
    hi: p.level + weighInHalf(p, factor),
  }));
  const inner = view.curve.map((p) => ({
    i: p.i,
    lo: p.level - BAND_Z * p.levelSd,
    hi: p.level + BAND_Z * p.levelSd,
  }));
  const levelBefore = model.level.filter((l) => l.i <= sel);
  const levelAfter = model.level.filter((l) => l.i >= sel);

  const yTicks: number[] = [];
  const step = tickStep(y1 - y0);
  for (let v = y0; v <= y1 + 1e-9; v += step) yTicks.push(Math.round(v * 10) / 10);
  const dayStep = span <= 16 ? 3 : span <= 30 ? 7 : span <= 60 ? 14 : span <= 120 ? 30 : 60;
  const xTicks: number[] = [];
  for (let i = last; i >= 0; i -= dayStep) xTicks.push(i);
  for (let i = last + dayStep; i <= span; i += dayStep) xTicks.push(i);
  const xLabels = (h: number) =>
    xTicks.map((i) => {
      const x = sx(i);
      // A label would reach into the y labels: left out.
      if (x < PAD.left + 18) return null;
      const anchor = x > width - PAD.right - 22 ? 'end' : 'middle';
      return (
        <text
          key={i}
          x={anchor === 'end' ? width - 2 : x}
          y={h - 6}
          textAnchor={anchor}
          fontSize={11}
          fill="var(--muted-foreground)"
        >
          {fmtDayMonthShort(addDays(model.dates[0]!, i))}
        </text>
      );
    });
  const dayLine = (h: number) => (
    <line
      x1={sx(sel)}
      x2={sx(sel)}
      y1={PAD.top}
      y2={h - PAD.bottom}
      stroke="var(--muted-foreground)"
      strokeDasharray="3 3"
    />
  );
  const todayLine = (h: number) => (
    <line x1={sx(last)} x2={sx(last)} y1={PAD.top} y2={h - PAD.bottom} stroke="var(--border)" />
  );

  const dragging = useRef(false);
  const choose = (i: number) => {
    const next = Math.max(model.firstChoice, Math.min(last, i));
    if (next !== sel) onSelect(next);
  };
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * width;
    choose(Math.round(((x - PAD.left) / plotW) * (span + 1) - 0.5));
  };

  const isToday = sel === last;
  const bar = Math.max(1.5, (plotW / (span + 1)) * 0.7);
  const eat = view.eating;
  const cal = model.calibration;
  const trendCal = model.trendCalibration;
  return (
    <figure className="ft-chart" ref={measure}>
      {/* The chart itself chooses the day: touch or drag it, or the arrow keys once focused. */}
      <svg
        role="slider"
        aria-label="Tag der Prognose"
        aria-roledescription="Diagramm"
        aria-valuemin={model.firstChoice}
        aria-valuemax={last}
        aria-valuenow={sel}
        aria-valuetext={fmtDayShort(view.date)}
        tabIndex={0}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block touch-pan-y rounded-md select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onKeyDown={(e) => {
          const next =
            e.key === 'ArrowLeft'
              ? sel - 1
              : e.key === 'ArrowRight'
                ? sel + 1
                : e.key === 'Home'
                  ? model.firstChoice
                  : e.key === 'End'
                    ? last
                    : null;
          if (next === null) return;
          e.preventDefault();
          choose(next);
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => dragging.current && pick(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <defs>
          <clipPath id={`${clipId}-w`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={HEIGHT - PAD.top - PAD.bottom} />
          </clipPath>
        </defs>
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
        {xLabels(HEIGHT)}
        {todayLine(HEIGHT)}
        <g clipPath={`url(#${clipId}-w)`}>
          <path d={area(outer)} fill="var(--forecast)" fillOpacity={0.15} />
          <path d={area(inner)} fill="var(--forecast)" fillOpacity={0.3} />
          <g fill="none" strokeLinejoin="round" strokeLinecap="round">
            {view.trend.length > 1 && (
              <path
                d={curve(view.trend, (p) => p.show)}
                stroke="var(--muted-foreground)"
                strokeWidth={1.3}
                strokeDasharray="4 3"
              />
            )}
            <path
              d={curve(levelAfter, (p) => p.kg)}
              stroke="var(--primary)"
              strokeWidth={2.5}
              opacity={LATER_OPACITY}
            />
            <path d={curve(levelBefore, (p) => p.kg)} stroke="var(--primary)" strokeWidth={2.5} />
            {view.curve.length > 1 && (
              <path d={curve(view.curve, (p) => p.show)} stroke="var(--forecast)" strokeWidth={2} />
            )}
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
              opacity={w.i > sel ? LATER_WEIGH_OPACITY : 1}
            />
          ))}
        </g>
        {dayLine(HEIGHT)}
        {view.level !== null && (
          <circle
            cx={sx(sel)}
            cy={sy(view.level)}
            r={4.5}
            fill="var(--primary)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        )}
      </svg>
      {/* The calories the model ran on: logged, learned maintenance, assumed eating after the chosen day. */}
      <svg
        aria-hidden
        width={width}
        height={KCAL_HEIGHT}
        viewBox={`0 0 ${width} ${KCAL_HEIGHT}`}
        className="block select-none"
        data-testid="forecast-kcal"
      >
        <defs>
          <clipPath id={`${clipId}-k`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={KCAL_HEIGHT - PAD.top - PAD.bottom} />
          </clipPath>
        </defs>
        {[k0, k1].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={ky(v)} y2={ky(v)} stroke="var(--border)" />
            <text x={0} y={ky(v) + 4} fontSize={11} fill="var(--muted-foreground)">
              {v.toLocaleString('de-DE')}
            </text>
          </g>
        ))}
        {xLabels(KCAL_HEIGHT)}
        {todayLine(KCAL_HEIGHT)}
        <g clipPath={`url(#${clipId}-k)`}>
          {model.kcal.map((k) => (
            <rect
              key={k.i}
              x={sx(k.i) - bar / 2}
              y={ky(k.kcal)}
              width={bar}
              height={Math.max(0, ky(k0) - ky(k.kcal))}
              fill="var(--muted-foreground)"
              opacity={k.i > sel ? 0.2 : 0.45}
            />
          ))}
          <g fill="none">
            <path
              d={curve(
                model.maintenance.filter((m) => m.i <= sel),
                (p) => p.kcal,
                ky,
              )}
              stroke="var(--primary)"
              strokeWidth={2}
            />
            {view.maintenance !== null && (
              <line
                x1={sx(sel)}
                x2={sx(span)}
                y1={ky(view.maintenance)}
                y2={ky(view.maintenance)}
                stroke="var(--primary)"
                strokeWidth={1.5}
                opacity={0.5}
              />
            )}
            {eat && (
              <line
                x1={sx(sel)}
                x2={sx(span)}
                y1={ky(eat.mean)}
                y2={ky(eat.mean)}
                stroke="var(--forecast)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </g>
        </g>
        {dayLine(KCAL_HEIGHT)}
      </svg>
      <figcaption className="tabular px-2 pt-1 text-sm" data-testid="forecast-legend">
        <p className="font-semibold">
          {isToday ? `Heute, ${fmtDayShort(view.date)}` : fmtDayShort(view.date)}
        </p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <LegendRow swatch={<Dot />} label="Gewogen">
            {view.weighed !== null ? kg1(view.weighed) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Line color="var(--primary)" thick />} label="Niveau">
            {view.level !== null ? kg1(view.level) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Line color="var(--primary)" thick />} label="Bedarf (gelernt)">
            {view.maintenance !== null ? fmtKcal(Math.round(view.maintenance / 10) * 10) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Dash color="var(--forecast)" />} label="Gegessen Ø 28 T">
            {eat ? fmtKcal(Math.round(eat.mean / 10) * 10) : NO_VALUE}
          </LegendRow>
          <LegendRow
            swatch={<Line color="var(--forecast)" />}
            label={`Prognose ${fmtDayMonthShort(view.end?.date ?? addDays(model.dates[last]!, model.aheadDays))}`}
          >
            {view.end ? kg1(view.end.level) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Band opacity={0.55} />} label="Kurve (80 %)">
            {view.end ? range(view.end.curve) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Band opacity={0.3} />} label="Wiegung (80 %)">
            {view.end ? range(view.end.weighIn) : NO_VALUE}
          </LegendRow>
          <LegendRow swatch={<Dash color="var(--muted-foreground)" />} label="Ohne Kalorien">
            {view.trendEnd !== null ? kg1(view.trendEnd) : NO_VALUE}
          </LegendRow>
        </dl>
        <p className="mt-3 text-muted-foreground">Treffer nach Abstand ({cal.checks} Prüfungen)</p>
        <div className="relative mt-1 grid h-11 grid-cols-14 items-end gap-0.5" data-testid="forecast-hits">
          {cal.coverByDays.slice(1).map((c, k) => (
            <i
              key={k}
              className="block rounded-t-sm bg-muted-foreground/70"
              style={{ height: `${(c ?? 0) * 100}%` }}
              title={c !== null ? fmtPercent(c) : undefined}
            />
          ))}
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-[80%] border-t border-dashed"
            style={{ borderColor: 'var(--forecast)' }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1 T</span>
          <span>7 T</span>
          <span>14 T</span>
        </div>
        <p className="mt-1.5 text-muted-foreground">
          Mit Kalorien: ungeprüft {fmtPercent(cal.coverModel)} getroffen, Faktor {factorText(cal.factor)}.
          {trendCal &&
            ` Ohne Kalorien: ${fmtPercent(trendCal.coverModel)}, Faktor ${factorText(trendCal.factor)}.`}
        </p>
      </figcaption>
      <ScreenReaderTable model={model} title={title} />
    </figure>
  );
}

function LegendRow({ swatch, label, children }: { swatch: ReactNode; label: string; children: ReactNode }) {
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

function Line({ color, thick }: { color: string; thick?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-3.5 rounded-full ${thick ? 'h-[3px]' : 'h-0.5'}`}
      style={{ background: color }}
    />
  );
}

function Dash({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block w-3.5 border-t-2 border-dashed"
      style={{ borderColor: color }}
    />
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      className="mx-[3px] inline-block size-2 rounded-full border-2 border-muted-foreground"
    />
  );
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
  const first = Math.max(model.firstChoice, model.dates.length - 60);
  // Each row runs a forecast: computed once per model, not on every scrub.
  const rows = useMemo(
    () =>
      model.dates
        .slice(first)
        .map((d, k) => ({ d, level: model.level[first + k]!.kg, end: dayView(model, first + k).end })),
    [model, first],
  );
  return (
    // sr-only alone still lets the wide table stretch the page sideways on a small screen.
    <div className="relative max-w-full overflow-hidden">
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Niveau</th>
            <th>Prognose</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, level, end }) => (
            <tr key={d}>
              <td>{fmtDayShort(d)}</td>
              <td>{kg1(level)}</td>
              <td>{end ? `${kg1(end.level)} für ${fmtDayMonthShort(end.date)}` : NO_VALUE}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
