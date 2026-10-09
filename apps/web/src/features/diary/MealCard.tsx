import { get, groupDiaryEntries, N, type FoodEntry, type ISODate, type NutrientMap } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { Camera, ChevronDown, ChevronRight, ListPlus, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import type { UserDb } from '@/db/dexie';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useMealInfo } from '@/hooks/data';
import { fmt0, fmt1, fmtGrams, fmtIngredients } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DraggableRow, useDiaryDrag, useMealDropZone, type DragRowData } from './DiaryDnd';
import { readExpanded, setGroupExpanded } from './expandedGroups';

export function entryAmountLabel(
  e: Pick<FoodEntry, 'source' | 'quantity' | 'portionLabel' | 'portionGrams' | 'grams'>,
): string {
  if (e.source === 'quick') return 'Schnell hinzugefügt';
  if (!e.portionLabel || e.portionGrams === null) return e.grams !== null ? fmtGrams(e.grams) : '';
  const isUnit = /^(100|1)\s?(g|ml)$/.test(e.portionLabel);
  if (isUnit)
    return fmtGrams(e.grams ?? e.portionGrams * e.quantity, e.portionLabel.endsWith('ml') ? 'ml' : 'g');
  return `${fmt1(e.quantity)} × ${e.portionLabel}${e.grams !== null ? ` · ${fmtGrams(e.grams)}` : ''}`;
}

export function MealCard({
  date,
  meal,
  name,
  entries,
  totals,
}: {
  date: ISODate;
  meal: number;
  name: string;
  entries: FoodEntry[];
  totals: NutrientMap;
}) {
  const { setDropRef, isOver: dropOver, dragging: dragActive } = useMealDropZone(meal);
  const kcal = get(totals, N.kcal);

  return (
    <Section
      ref={setDropRef}
      className={cn(
        'transition-[box-shadow,background-color] motion-reduce:transition-none',
        dropOver && 'bg-primary/5 ring-2 ring-primary/60',
      )}
      title={
        // The meal's own page: nutrient overview and its entries.
        <Link
          to="/diary-meal"
          search={{ date, meal }}
          className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{name}</span>
            {kcal > 0 && (
              <span className="tabular shrink-0 text-sm font-normal text-muted-foreground">
                {fmt0(kcal)} kcal
              </span>
            )}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      }
      action={
        // At a meal only food makes sense: straight to the food page for this meal.
        <Button variant="ghost" size="icon" asChild>
          <Link to="/photo" search={{ date, meal }} aria-label={`Essen zu ${name} eintragen`}>
            <Plus className="size-5 text-primary" aria-hidden />
          </Link>
        </Button>
      }
    >
      {entries.length === 0 ? (
        <Link
          to="/photo"
          search={{ date, meal }}
          className={cn(
            'mx-4 mb-4 flex h-11 w-[calc(100%-2rem)] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            dragActive && 'border-primary/50 text-primary',
          )}
        >
          {dragActive ? 'Hier ablegen' : 'Essen eintragen'}
        </Link>
      ) : (
        <DiaryRows entries={entries} date={date} meal={meal} draggable />
      )}
    </Section>
  );
}

/** Soft-deletes diary entries with an undo toast. */
export async function removeEntriesWithUndo(db: UserDb, list: FoodEntry[], message?: string): Promise<void> {
  const ids = list.map((e) => e.id);
  for (const id of ids) await deleteRecord(db, 'foodEntries', id);
  toast(message ?? (list.length === 1 ? `${list[0]!.name} gelöscht` : `${list.length} Einträge gelöscht`), {
    action: {
      label: 'Rückgängig',
      onClick: () => void Promise.all(ids.map((id) => restoreRecord(db, 'foodEntries', id))),
    },
  });
}

/**
 * Rows of one diary meal (single entries and groups, see `groupDiaryEntries`), swipe to delete.
 * `draggable`: long press moves a row to another meal (diary only, inside `DiaryDnd`).
 */
export function DiaryRows({
  entries,
  date,
  meal,
  draggable = false,
}: {
  entries: FoodEntry[];
  date: ISODate;
  meal: number;
  draggable?: boolean;
}) {
  const db = useDb();
  const rows = groupDiaryEntries(entries);
  const mealInfo = useMealInfo(rows.map((r) => (r.kind === 'group' ? r.mealId : null)));
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((row) =>
        row.kind === 'entry' ? (
          <li key={row.entry.id}>
            <MaybeDraggable
              enabled={draggable}
              id={row.entry.id}
              data={{
                ids: [row.entry.id],
                meal,
                name: row.entry.name,
                detail: entryAmountLabel(row.entry),
                nutrients: row.entry.nutrients,
              }}
            >
              <EntryRow
                entry={row.entry}
                date={date}
                meal={meal}
                onDelete={() => void removeEntriesWithUndo(db, [row.entry])}
              />
            </MaybeDraggable>
          </li>
        ) : (
          <li key={row.groupId}>
            <GroupRow
              groupId={row.groupId}
              // Own name first: a group renamed in its editor keeps that name, else it follows the saved meal.
              name={row.groupName || (row.mealId && mealInfo?.get(row.mealId)?.name) || 'Meal'}
              // The photo kept on the entries (AI analysis, meal photo at logging time) before the meal's current one.
              photoId={row.entries[0]?.photoId || (row.mealId && mealInfo?.get(row.mealId)?.photoId) || null}
              entries={row.entries}
              nutrients={row.nutrients}
              date={date}
              meal={meal}
              draggable={draggable}
              onDelete={(list) => void removeEntriesWithUndo(db, list)}
            />
          </li>
        ),
      )}
    </ul>
  );
}

function MaybeDraggable({
  enabled,
  id,
  data,
  children,
}: {
  enabled: boolean;
  id: string;
  data: DragRowData;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <DraggableRow id={id} data={data}>
      {children}
    </DraggableRow>
  );
}

function EntryRow({
  entry: e,
  date,
  meal,
  onDelete,
  className,
}: {
  entry: FoodEntry;
  date: ISODate;
  meal: number;
  onDelete: () => void;
  className?: string;
}) {
  const { dragging } = useDiaryDrag();
  return (
    <SwipeToDelete label={`${e.name} löschen`} onDelete={onDelete} disabled={dragging}>
      <Link
        to={e.source === 'quick' ? '/quick-add' : '/entry/$entryId'}
        params={{ entryId: e.id }}
        search={e.source === 'quick' ? { date, meal, entryId: e.id } : undefined}
        className={cn(
          'flex min-h-14 items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none',
          className,
        )}
        draggable={false}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{e.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[e.brand, entryAmountLabel(e)].filter(Boolean).join(' · ')}
          </div>
        </div>
        <NutrientSummary nutrients={e.nutrients} />
      </Link>
    </SwipeToDelete>
  );
}

function NutrientSummary({ nutrients }: { nutrients: NutrientMap }) {
  return (
    <div className="tabular text-right">
      <div className="font-semibold">{fmt0(get(nutrients, N.kcal))}</div>
      <div className="text-[11px] text-muted-foreground">
        P {fmt0(get(nutrients, N.protein))} · K {fmt0(get(nutrients, N.carbs))} · F{' '}
        {fmt0(get(nutrients, N.fat))}
      </div>
    </div>
  );
}

/**
 * Entries logged together (from a saved meal, or as a named group from an AI analysis): one row.
 * Tapping the row opens the group editor (`/diary-group/$groupId`); only "N Zutaten ⌄" expands the
 * single items. The row is a stretched link with the toggle button above it (a button cannot sit
 * inside a link); swipe and long-press drag still work on the whole row.
 */
function GroupRow({
  groupId,
  name,
  photoId,
  entries,
  nutrients,
  date,
  meal,
  draggable,
  onDelete,
}: {
  groupId: string;
  name: string;
  photoId: string | null;
  entries: FoodEntry[];
  nutrients: NutrientMap;
  date: ISODate;
  meal: number;
  draggable: boolean;
  onDelete: (entries: FoodEntry[]) => void;
}) {
  const [expanded, setExpanded] = useState(() => readExpanded().has(groupId));
  const { dragging } = useDiaryDrag();
  function toggle() {
    setExpanded(!expanded);
    setGroupExpanded(groupId, !expanded);
  }
  const fromPhoto = entries.some((e) => e.source === 'ai');
  const listId = `group-items-${groupId}`;
  return (
    <>
      {/* Only the group row is draggable (the whole meal moves), not its expanded ingredients. */}
      <MaybeDraggable
        enabled={draggable}
        id={`group:${groupId}`}
        data={{
          ids: entries.map((e) => e.id),
          meal,
          name,
          detail: fmtIngredients(entries.length),
          nutrients,
        }}
      >
        <SwipeToDelete label={`${name} löschen`} onDelete={() => onDelete(entries)} disabled={dragging}>
          <div className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 has-[a:focus-visible]:bg-accent">
            {photoId && (
              <MealPhoto photoId={photoId} alt="" className="size-10 shrink-0 rounded-lg" placeholder />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-medium">
                {photoId ? null : fromPhoto ? (
                  <Camera className="size-4 shrink-0 text-muted-foreground" aria-label="aus Foto" />
                ) : (
                  <ListPlus className="size-4 shrink-0 text-muted-foreground" aria-label="Meal" />
                )}
                <Link
                  to="/diary-group/$groupId"
                  params={{ groupId }}
                  search={{ date }}
                  draggable={false}
                  className="truncate after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {name}
                </Link>
              </div>
              {/* The tap area is the button's ::before, placed on the row (the nearest positioned ancestor):
                  left half of the row from below the name line (top-8 = padding + one line) to the bottom,
                  above the stretched link. Wider instead of higher: the name stays free, the row its height. */}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                aria-label={`${fmtIngredients(entries.length)} von ${name}`}
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                className="flex items-center gap-1 rounded-md text-xs text-muted-foreground before:absolute before:top-8 before:bottom-0 before:left-0 before:z-10 before:w-1/2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {fmtIngredients(entries.length)}
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform motion-reduce:transition-none',
                    expanded && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
            </div>
            <NutrientSummary nutrients={nutrients} />
          </div>
        </SwipeToDelete>
      </MaybeDraggable>
      {expanded && (
        <ul id={listId} className="border-t border-border/70 bg-muted/40" aria-label={`Zutaten von ${name}`}>
          {entries.map((e) => (
            <li key={e.id} className="border-b border-border/50 last:border-b-0">
              <EntryRow
                entry={e}
                date={date}
                meal={meal}
                onDelete={() => onDelete([e])}
                className="min-h-12 pl-10 text-sm"
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
