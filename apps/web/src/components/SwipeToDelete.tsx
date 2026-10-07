import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Width of the revealed delete button (px). */
const ACTION_WIDTH = 88;
/** Movement before a gesture counts as a swipe or a scroll (px). */
const SLOP = 8;

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  base: number;
  axis: 'x' | 'y' | null;
}

/**
 * iOS-style row: swipe left to reveal a delete button, tap it to delete. Vertical scrolling stays
 * with the browser (`touch-action: pan-y`); a swipe never triggers the row's own link or button,
 * and tapping an open row (or anywhere else) closes it again. Keyboard users delete from the
 * detail screen, so the hidden button is not focusable while closed.
 *
 * `disabled` (e.g. while the row is dragged to another meal) ignores all gestures and closes an
 * open row.
 */
export function SwipeToDelete({
  children,
  onDelete,
  label,
  className,
  contentClassName,
  disabled = false,
}: {
  children: ReactNode;
  onDelete: () => void;
  /** Accessible name of the delete button, e.g. "Haferflocken löschen". */
  label: string;
  className?: string;
  /** Classes of the sliding layer, e.g. `bg-background` for rows outside a card (default `bg-card`). */
  contentClassName?: string;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  if (disabled && (offset !== 0 || dragging)) {
    setOffset(0);
    setDragging(false);
  }
  const open = offset < 0 && !dragging;

  // Close when the user touches anything outside this row.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOffset(0);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  return (
    <div ref={root} className={cn('relative overflow-hidden', className)}>
      <button
        type="button"
        aria-label={label}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => {
          setOffset(0);
          onDelete();
        }}
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-center bg-destructive text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
          offset === 0 && 'invisible',
        )}
        style={{ width: ACTION_WIDTH }}
      >
        <Trash2 className="size-5" aria-hidden />
      </button>
      <div
        data-slot="swipe-content"
        className={cn(
          'relative touch-pan-y bg-card',
          !dragging && 'transition-transform duration-200 ease-out motion-reduce:transition-none',
          contentClassName,
        )}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onPointerDown={(e) => {
          if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
          gesture.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, base: offset, axis: null };
          swallowClick.current = false;
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.pointerId !== e.pointerId) return;
          if (disabled) {
            gesture.current = null;
            return;
          }
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.axis) {
            if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
            g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (g.axis === 'y') return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragging(true);
          }
          if (g.axis !== 'x') return;
          swallowClick.current = true;
          // Rubber band beyond the button width.
          const raw = Math.min(0, g.base + dx);
          setOffset(raw < -ACTION_WIDTH ? -ACTION_WIDTH + (raw + ACTION_WIDTH) * 0.3 : raw);
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          gesture.current = null;
          if (!g || g.pointerId !== e.pointerId || disabled) return;
          if (g.axis === 'x') {
            setDragging(false);
            setOffset((o) => (o < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0));
          } else if (g.axis === null && g.base !== 0) {
            // Tap on an open row closes it instead of opening the entry.
            swallowClick.current = true;
            setOffset(0);
          }
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDragging(false);
          setOffset((o) => (o < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0));
        }}
        // A mouse swipe over a link would otherwise start the browser's native link drag (pointercancel).
        onDragStart={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
