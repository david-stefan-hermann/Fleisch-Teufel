import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/** Height of one row in px (three rows are visible). */
const ROW = 44;
const SETTLE_MS = 160;

/**
 * One column of a picker wheel in the style of the iOS picker: a scroll-snap list of three visible
 * rows, the middle one is the choice. Turn it by touch, trackpad or mouse wheel, tap a row, or use
 * the keyboard (arrows, Page Up/Down, Home/End).
 *
 * `onChange` reports the row under the middle while it turns, `onSettle` once it has stopped. A
 * column that only reacts when it stops (the unit) leaves `onChange` out. The choice comes from the
 * scroll position; a new `index` from outside scrolls there.
 *
 * `valueNow` makes it a `slider` for screen readers (amounts), otherwise it is a `listbox`.
 */
export function Wheel({
  items,
  index,
  onChange,
  onSettle,
  label,
  valueNow,
  className,
}: {
  items: readonly string[];
  index: number;
  onChange?: (index: number) => void;
  onSettle: (index: number) => void;
  /** Accessible name. */
  label: string;
  valueNow?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Turned by hand since the last `onSettle` (scrolling to a choice from outside reports nothing).
  const turned = useRef(false);
  // The wheel stops a moment after the last scroll event, outside of any React event. Reporting it
  // from the timer would call an `onSettle` whose closure may be older than state set meanwhile
  // (and overwrite that state), so the stop goes through state and is reported after the render.
  const [stopped, setStopped] = useState<{ row: number } | null>(null);
  useEffect(() => {
    if (stopped) onSettle(stopped.row);
    // Only a new stop reports, not a new callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopped]);
  const last = items.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const rowAt = (el: HTMLElement) => clamp(Math.round(el.scrollTop / ROW));

  // Follow a choice set from outside (typed amount, unit switch). A choice that came from turning
  // the wheel already sits under the middle and must not be touched, or the momentum would stop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (rowAt(el) !== index) el.scrollTop = index * ROW;
    // `items.length`: rows added or removed above the choice move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = rowAt(el);
    if (i !== index) {
      turned.current = true;
      onChange?.(i);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!turned.current) return;
      turned.current = false;
      setStopped({ row: rowAt(el) });
    }, SETTLE_MS);
  };
  /** Keyboard and taps: straight to the row, reported as final. */
  const jump = (i: number) => {
    const next = clamp(i);
    if (next === index) return;
    turned.current = false;
    onChange?.(next);
    onSettle(next);
    if (ref.current) ref.current.scrollTop = next * ROW;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const to: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      PageDown: index + 5,
      PageUp: index - 5,
      Home: 0,
      End: last,
    };
    const next = to[e.key];
    if (next === undefined) return;
    e.preventDefault();
    jump(next);
  };

  const slider = valueNow !== undefined;
  return (
    <div
      ref={ref}
      role={slider ? 'slider' : 'listbox'}
      aria-label={label}
      aria-orientation="vertical"
      {...(slider && { 'aria-valuenow': valueNow, 'aria-valuetext': items[index] })}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className={cn(
        'wheel relative h-[132px] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-lg py-11 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {items.map((text, i) => (
        <div
          key={`${i}:${text}`}
          role={slider ? undefined : 'option'}
          aria-selected={slider ? undefined : i === index}
          aria-hidden={slider ? true : undefined}
          onClick={() => jump(i)}
          className={cn(
            'tabular flex h-11 snap-center items-center justify-center truncate px-2 select-none',
            i === index ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          <span className="truncate">{text}</span>
        </div>
      ))}
    </div>
  );
}
