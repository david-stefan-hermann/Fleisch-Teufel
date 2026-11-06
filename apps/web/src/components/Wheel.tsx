import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from 'react';
import { cn } from '@/lib/utils';

/** Height of one row in px (three rows are visible). */
const ROW = 44;
const SETTLE_MS = 160;
/** How long a stop between two rows may wait for the snap before it is reported anyway. */
const SNAP_MS = 1000;
/** How long a scroll set from outside may take to be reported before its events count again. */
const PENDING_MS = 300;

/**
 * One column of a picker wheel in the style of the iOS picker: a scroll-snap list of three visible
 * rows, the middle one is the choice. Turn it by touch, trackpad or mouse wheel, tap a row, or use
 * the keyboard (arrows, Page Up/Down, Home/End).
 *
 * `onChange` reports the row under the middle while it turns, `onSettle` once it has stopped. A
 * column that only reacts when it stops (the unit) leaves `onChange` out. The choice comes from the
 * scroll position; a new `index` from outside scrolls there.
 *
 * Only the person turns the wheel: a scroll event counts as a turn when a finger, the mouse, a
 * trackpad or a key touched the wheel before it. Scrolling the browser does by itself (the scroll
 * to a new `index`, re-snapping after the rows changed, clamping after rows were removed) is never a
 * turn: it reported the row the old scroll position happened to land on in the new list (2 portions
 * became 20 g after a unit switch) and the two scrolls fought over the position. A scroll like that
 * which leaves the wheel on another row is undone: the wheel follows the value, never the other way.
 *
 * A turn ends when the finger is off the wheel, no scroll event came for a moment and the wheel sits
 * on a row. A finger that rests and turns on is still the same turn (reporting the pause as the stop
 * dropped everything after it: the wheel showed one row, the value stayed on another).
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
  // Touched by hand since the last stop or scroll from outside: only then scroll events are turns.
  const turned = useRef(false);
  // The turn moved the wheel: a tap that scrolls nothing has no stop to report.
  const moved = useRef(false);
  // A finger lies on the wheel. Touch events only: iOS fires `pointercancel` as soon as it scrolls.
  const held = useRef(false);
  // How often the stop already waited for the snap between two rows.
  const waits = useRef(0);
  const realign = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The latest choice, for the timers (their closures may be older).
  const current = useRef(index);
  // A scroll set from outside that the browser has not reported yet: its events are no turns.
  const pending = useRef<{ top: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearPending = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current = null;
  };
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
  const id = useId();
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const rowAt = (el: HTMLElement) => clamp(Math.round(el.scrollTop / ROW));

  /** Scrolls to a row from outside: whatever turn was running is over, the scroll itself is none. */
  const scrollToRow = (el: HTMLElement, row: number) => {
    const top = row * ROW;
    turned.current = false;
    moved.current = false;
    clearTimeout(timer.current);
    clearTimeout(realign.current);
    clearPending();
    // The browser reports this scroll later (or not at all, when nothing moved); until then its
    // events are no turns. A browser that never lands exactly on `top` is released by the timer.
    pending.current = { top, timer: setTimeout(clearPending, PENDING_MS) };
    el.scrollTop = top;
  };

  // Follow a choice set from outside (typed amount, unit switch). A choice that came from turning
  // the wheel already sits under the middle and must not be touched, or the momentum would stop.
  // Before the paint, so iOS does not animate (and re-snap) the way there.
  useLayoutEffect(() => {
    const el = ref.current;
    current.current = index;
    if (!el) return;
    if (rowAt(el) === index) return;
    scrollToRow(el, index);
    // `items.length`: rows added or removed above the choice move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(realign.current);
      clearPending();
    },
    [],
  );

  /** A finger, the mouse or a trackpad on the wheel: the scroll events that follow are a turn. */
  const touch = () => {
    clearPending();
    clearTimeout(realign.current);
    turned.current = true;
  };
  /** Reports the stop of a turn, once nothing holds the wheel and it sits on a row. */
  const settle = () => {
    const el = ref.current;
    if (!el || !turned.current || !moved.current) return;
    // The finger still lies on it: letting go asks again.
    if (held.current) return;
    if (Math.abs(el.scrollTop - rowAt(el) * ROW) > 1) {
      // Between two rows: the snap is still running (or never comes, then the nearest row counts).
      waits.current += 1;
      if (waits.current * SETTLE_MS < SNAP_MS) {
        timer.current = setTimeout(settle, SETTLE_MS);
        return;
      }
    }
    waits.current = 0;
    turned.current = false;
    moved.current = false;
    setStopped({ row: rowAt(el) });
  };
  const settleSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(settle, SETTLE_MS);
  };
  /** A scroll nobody turned left the wheel on another row than the value: back to the value. */
  const realignSoon = () => {
    clearTimeout(realign.current);
    realign.current = setTimeout(() => {
      const el = ref.current;
      if (!el || turned.current || rowAt(el) === current.current) return;
      scrollToRow(el, current.current);
    }, SETTLE_MS);
  };
  const onTouchStart = () => {
    held.current = true;
    touch();
  };
  const onTouchEnd = (e: TouchEvent) => {
    held.current = e.touches.length > 0;
    // Letting go without another scroll event still has to report where the wheel stands.
    if (!held.current && turned.current && moved.current) settleSoon();
  };
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    if (pending.current) {
      if (Math.abs(el.scrollTop - pending.current.top) < 1) clearPending();
      else realignSoon();
      return;
    }
    if (!turned.current) {
      realignSoon();
      return;
    }
    moved.current = true;
    waits.current = 0;
    const i = rowAt(el);
    if (i !== index) onChange?.(i);
    settleSoon();
  };
  /** Keyboard and taps: straight to the row, reported as final. */
  const jump = (i: number) => {
    const next = clamp(i);
    if (next === index) return;
    turned.current = false;
    moved.current = false;
    clearTimeout(timer.current);
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
      {...(slider && {
        'aria-valuenow': valueNow,
        'aria-valuemin': 0,
        'aria-valuemax': last,
        'aria-valuetext': items[index],
      })}
      {...(!slider && { 'aria-activedescendant': `${id}-opt-${index}` })}
      tabIndex={0}
      onScroll={onScroll}
      onPointerDown={touch}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onWheel={touch}
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
          id={slider ? undefined : `${id}-opt-${i}`}
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
