/**
 * Drag and drop of diary rows between the meals of a day (dnd-kit).
 *
 * Gestures on a row, decided within the first 300 ms:
 *   - hold still (moving less than 8 px) → the row lifts and can be dropped on another meal card
 *   - swipe left right away → SwipeToDelete (dnd-kit cancels when the finger moves beyond 8 px)
 *   - move vertically right away → normal page scroll
 * While a row is dragged, every SwipeToDelete in the diary is disabled (`useDiaryDrag`), so the
 * drag movement cannot open a delete button. Mouse and touch sensors (not the pointer sensor): on
 * iOS a vertical pointer move hands the gesture to the browser's scrolling and cancels the drag,
 * the touch sensor prevents that once the drag is active. Keyboard users change the meal of an
 * entry on its detail page instead.
 */
import { get, N, type NutrientMap } from '@ft/shared';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { moveEntriesToMeal } from '@/db/entries';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Long press before a row lifts, and how far the finger may wander meanwhile. */
export const DRAG_ACTIVATION = { delay: 300, tolerance: 8 } as const;

/** What a dragged row carries: the entries it stands for and what the drag preview shows. */
export interface DragRowData {
  ids: string[];
  meal: number;
  name: string;
  detail: string;
  nutrients: NutrientMap;
}

const DragState = createContext<{ dragging: boolean }>({ dragging: false });

/** Whether a diary row is being dragged right now (false outside the diary). */
export function useDiaryDrag() {
  return useContext(DragState);
}

export function DiaryDnd({ mealNames, children }: { mealNames: string[]; children: ReactNode }) {
  const db = useDb();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: DRAG_ACTIVATION }),
  );
  const [active, setActive] = useState<DragRowData | null>(null);
  const mealName = (m: number) => mealNames[m] ?? `Mahlzeit ${m + 1}`;
  const rowOf = (data: unknown) => data as DragRowData | undefined;
  const mealOf = (data: unknown) => (data as { meal?: number } | undefined)?.meal;

  async function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const row = rowOf(e.active.data.current);
    const target = mealOf(e.over?.data.current);
    if (!row || target === undefined || target === row.meal) return;
    await moveEntriesToMeal(db, row.ids, target);
    toast(`Nach ${mealName(target)} verschoben`, {
      action: { label: 'Rückgängig', onClick: () => void moveEntriesToMeal(db, row.ids, row.meal) },
    });
  }

  // Screen reader announcements in German (dnd-kit's defaults are English).
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${rowOf(active.data.current)?.name ?? 'Eintrag'} aufgenommen.`,
    onDragOver: ({ active, over }) => {
      const name = rowOf(active.data.current)?.name ?? 'Eintrag';
      const m = mealOf(over?.data.current);
      return m === undefined ? `${name} ist über keiner Mahlzeit.` : `${name} ist über ${mealName(m)}.`;
    },
    onDragEnd: ({ active, over }) => {
      const row = rowOf(active.data.current);
      const m = mealOf(over?.data.current);
      return m === undefined || m === row?.meal
        ? `${row?.name ?? 'Eintrag'} nicht verschoben.`
        : `${row?.name ?? 'Eintrag'} nach ${mealName(m)} verschoben.`;
    },
    onDragCancel: ({ active }) =>
      `Verschieben von ${rowOf(active.data.current)?.name ?? 'Eintrag'} abgebrochen.`,
  };

  const state = useMemo(() => ({ dragging: active !== null }), [active]);
  return (
    <DragState.Provider value={state}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        accessibility={{ announcements }}
        onDragStart={(e: DragStartEvent) => {
          setActive(rowOf(e.active.data.current) ?? null);
          navigator.vibrate?.(20);
        }}
        onDragEnd={(e) => void onDragEnd(e)}
        onDragCancel={() => setActive(null)}
      >
        {children}
        <DragOverlay modifiers={[restrictToWindowEdges]} dropAnimation={null}>
          {active && <DragPreview row={active} />}
        </DragOverlay>
      </DndContext>
    </DragState.Provider>
  );
}

function DragPreview({ row }: { row: DragRowData }) {
  return (
    <div
      className="flex min-h-14 cursor-grabbing items-center gap-3 rounded-xl border border-primary/40 bg-card px-4 py-2 shadow-lg ring-1 ring-primary/20"
      aria-hidden
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{row.name}</div>
        <div className="truncate text-xs text-muted-foreground">{row.detail}</div>
      </div>
      <div className="tabular font-semibold">{fmt0(get(row.nutrients, N.kcal))} kcal</div>
    </div>
  );
}

/**
 * A diary row that can be picked up with a long press. Only the listeners are attached (no
 * role/tabIndex): the row content keeps its own link or button semantics.
 */
export function DraggableRow({ id, data, children }: { id: string; data: DragRowData; children: ReactNode }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, data });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-dragging={isDragging || undefined}
      // No iOS link preview / text selection on the long press.
      className={cn('[-webkit-touch-callout:none] select-none', isDragging && 'opacity-40')}
    >
      {children}
    </div>
  );
}

/** Drop target state of a meal card. */
export function useMealDropZone(meal: number) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `meal-${meal}`, data: { meal } });
  const from = (active?.data.current as DragRowData | undefined)?.meal;
  return { setDropRef: setNodeRef, isOver: isOver && from !== meal, dragging: active !== null };
}
