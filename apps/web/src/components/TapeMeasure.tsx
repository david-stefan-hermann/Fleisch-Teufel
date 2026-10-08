import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { fmt0, fmtFixed } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TapeMeasureProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Raster the tape snaps to. */
  step?: number;
  /** Units visible on each side of the pointer (1 = ±1 kg). */
  visibleRange?: number;
  /** Accessible name. */
  label: string;
  unit?: string;
  className?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * An endless measuring tape with a fixed pointer in the middle (weight entry). Drag or swipe it
 * sideways, use a trackpad, or the keyboard (arrows ±step, Page Up/Down ±1, Home/End); it snaps to
 * `step` when released. Only the visible window is rendered, so 20 to 400 kg cost the same as ±1 kg.
 * A value off the raster (typed 84,37) shows the nearest mark.
 */
export function TapeMeasure({
  value,
  onChange,
  min = 20,
  max = 400,
  step = 0.05,
  visibleRange = 1,
  label,
  unit = 'kg',
  className,
}: TapeMeasureProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const snap = (v: number) => round2(clamp(Math.round(v / step) * step));
  const pxPerUnit = width / (2 * visibleRange);
  const drag = useRef<{ x: number; start: number; id: number } | null>(null);
  // Trackpad deltas are often smaller than one mark; they add up here between events.
  const wheel = useRef<{ raw: number; base: number } | null>(null);

  /** Light tick when the value crosses a mark (ignored where vibration is unavailable, e.g. iOS). */
  const tick = (from: number, to: number) => {
    if (Math.floor(from / step + 1e-9) !== Math.floor(to / step + 1e-9)) navigator.vibrate?.(5);
  };
  const emit = (next: number) => {
    tick(value, next);
    if (next !== value) onChange(next);
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || pxPerUnit <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, id: e.pointerId };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Moving the tape to the left brings higher values under the pointer.
    emit(round2(clamp(d.start - (e.clientX - d.x) / pxPerUnit)));
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const snapped = snap(value);
    if (snapped !== value) onChange(snapped);
  }
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!delta || pxPerUnit <= 0) return;
    const w = wheel.current && wheel.current.base === value ? wheel.current : { raw: value, base: value };
    const raw = clamp(w.raw + delta / pxPerUnit);
    const next = snap(raw);
    wheel.current = { raw, base: next };
    emit(next);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const by: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
    };
    let next: number | null = null;
    if (e.key in by) next = snap(snap(value) + by[e.key]!);
    else if (e.key === 'PageUp') next = snap(value + 1);
    else if (e.key === 'PageDown') next = snap(value - 1);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    emit(next);
  }

  // Marks of the visible window (a bit wider, so they slide in from under the faded edges).
  const shown = snap(value);
  const r = visibleRange + 0.2;
  // (±1e-9: 83,15 / 0,05 is 1662,9999… in floating point.)
  const first = Math.max(Math.ceil(min / step - 1e-9), Math.floor((shown - r) / step + 1e-9));
  const last = Math.min(Math.floor(max / step + 1e-9), Math.ceil((shown + r) / step - 1e-9));
  const perUnit = Math.round(1 / step);
  const centre = Math.round(shown / step);
  const marks: { i: number; v: number; kind: 'unit' | 'half' | 'small' }[] = [];
  if (width > 0)
    for (let i = first; i <= last; i++)
      marks.push({
        i,
        v: i * step,
        kind: i % perUnit === 0 ? 'unit' : (2 * i) % perUnit === 0 ? 'half' : 'small',
      });

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={round2(value)}
      aria-valuetext={`${fmtFixed(value, 2)} ${unit}`}
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      className={cn(
        'relative h-[68px] cursor-grab touch-pan-y overflow-hidden rounded-xl border bg-card select-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:outline-none active:cursor-grabbing',
        className,
      )}
    >
      <div
        className="absolute inset-0 [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]"
        aria-hidden
      >
        {marks.map((m) => (
          <div
            key={m.i}
            data-mark={m.kind}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `calc(50% + ${(m.i - centre) * step * pxPerUnit}px)` }}
          >
            <div
              className={cn(
                'w-px bg-muted-foreground/60',
                m.kind === 'unit' ? 'h-6' : m.kind === 'half' ? 'h-4' : 'h-2.5',
              )}
            />
            {m.kind === 'unit' && (
              <span className="tabular mt-1.5 text-xs text-muted-foreground">{fmt0(m.v)}</span>
            )}
          </div>
        ))}
      </div>
      {/* Fixed pointer: a triangle on top of a line. */}
      <div className="pointer-events-none absolute top-0 left-1/2 h-10 w-0.5 -translate-x-1/2 rounded-b-sm bg-primary" />
      <div
        className="pointer-events-none absolute top-0 left-1/2 size-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-primary"
        aria-hidden
      />
    </div>
  );
}
