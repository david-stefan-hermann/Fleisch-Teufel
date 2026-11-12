/**
 * Order of the rows of a list by dragging (dnd-kit sortable), first used for the training card.
 * Same gestures as the meal drag (`DiaryDnd.tsx`): a long press lifts the row, a swipe right away
 * stays a swipe, a vertical move right away scrolls. While a row is dragged the list's
 * SwipeToDelete rows are disabled (`useDiaryDrag` through `DragStateProvider`). `SortableRows` knows
 * nothing about trainings (`onReorder(keys)`), so the diary's food rows can use it later.
 */
import type { ISODate } from '@ft/shared';
import {
  closestCenter,
  DndContext,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { reorderTrainings } from '@/db/entries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DragStateProvider, useDragSensors } from './DiaryDnd';

/** A click right after a drop is the end of the drag, not a tap on the row's link or button. */
let suppressClickUntil = 0;

export function SortableRows({
  keys,
  labelOf,
  onReorder,
  children,
}: {
  /** The rows' keys in their current order (`SortableRow id`). */
  keys: readonly string[];
  /** The row's name for screen readers. */
  labelOf: (key: string) => string;
  /** Called with all keys in the new order after a drop that changed it. */
  onReorder: (keys: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useDragSensors();
  const [dragging, setDragging] = useState(false);
  const items = [...keys];
  const name = (id: UniqueIdentifier) => labelOf(String(id));
  const position = (id: UniqueIdentifier | undefined) => (id === undefined ? -1 : items.indexOf(String(id)));

  function onDragEnd(e: DragEndEvent) {
    setDragging(false);
    suppressClickUntil = Date.now() + 400;
    const from = position(e.active.id);
    const to = position(e.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(arrayMove(items, from, to));
  }

  // Screen reader announcements in German (dnd-kit's defaults are English).
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${name(active.id)} aufgenommen.`,
    onDragOver: ({ active, over }) =>
      over ? `${name(active.id)} an Position ${position(over.id) + 1} von ${items.length}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id
        ? `${name(active.id)} an Position ${position(over.id) + 1} verschoben.`
        : `${name(active.id)} nicht verschoben.`,
    onDragCancel: ({ active }) => `Verschieben von ${name(active.id)} abgebrochen.`,
  };

  const state = useMemo(() => ({ dragging }), [dragging]);
  return (
    <DragStateProvider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{ announcements }}
        onDragStart={() => {
          setDragging(true);
          navigator.vibrate?.(20);
        }}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(false)}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    </DragStateProvider>
  );
}

/**
 * A row of `SortableRows` (an `<li>`). Only the listeners are attached (no role/tabIndex): the row
 * content keeps its own link or button semantics, like `DraggableRow`.
 */
export function SortableRow({
  id,
  className,
  children,
  ...rest
}: {
  id: string;
  className?: string;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      {...rest}
      {...listeners}
      data-dragging={isDragging || undefined}
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      onClickCapture={(e) => {
        if (Date.now() < suppressClickUntil) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      // No iOS link preview / text selection on the long press.
      className={cn(
        '[-webkit-touch-callout:none] select-none',
        isDragging && 'relative z-10 bg-card opacity-90 shadow-lg',
        className,
      )}
    >
      {children}
    </li>
  );
}

/**
 * The training card's rows (packages and single trainings; the steps row stays outside): a drop writes the
 * new order (`reorderTrainings`), with undo.
 */
export function TrainingSortable({
  date,
  keys,
  labelOf,
  children,
}: {
  date: ISODate;
  keys: readonly string[];
  labelOf: (key: string) => string;
  children: ReactNode;
}) {
  const db = useDb();
  const writing = useRef(false);
  async function onReorder(next: string[]) {
    // One change at a time: a second drop while the first is written is ignored.
    if (writing.current) return;
    writing.current = true;
    try {
      const previous = await reorderTrainings(db, date, next);
      toast('Reihenfolge geändert', {
        action: { label: 'Rückgängig', onClick: () => void reorderTrainings(db, date, previous) },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      writing.current = false;
    }
  }
  return (
    <SortableRows keys={keys} labelOf={labelOf} onReorder={(next) => void onReorder(next)}>
      {children}
    </SortableRows>
  );
}
