import {
  addDays,
  get,
  groupDiaryEntries,
  N,
  photoIdsOf,
  sumNutrients,
  type FoodEntry,
  type ISODate,
  type NutrientMap,
} from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { Camera, ChevronDown, ChevronRight, ClipboardPaste, ListPlus, Moon, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MarqueeText } from '@/components/MarqueeText';
import { MealPhoto, PhotoCount } from '@/components/MealPhoto';
import { Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import { copyMealToClipboard, copyToClipboard, pasteClipboard, type Clipboard } from '@/db/clipboard';
import { prepareMealTarget, type DiaryDayMeal, type MealChoice, type MealRef } from '@/db/diaryMeals';
import type { UserDb } from '@/db/dexie';
import type { MealSuggestions as MealSuggestionsData } from '@/db/suggestions';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useMealInfo } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { useAppearance } from '@/lib/appearance';
import { useRememberLogStart } from '@/lib/logFlow';
import { fmt0, fmt2, fmtGrams, fmtIngredients, fmtTime, fmtWeekdayShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MacroSummary } from './MacroSummary';
import { DiaryMealMenu } from './DiaryMealMenu';
import { MealNameMenu } from './MealNameMenu';
import { MealSuggestions } from './MealSuggestions';
import { MealTimeDialog } from './MealTimeDialog';
import { PendingAnalysisRow } from './PendingAnalysisRow';
import { DraggableRow, useDiaryDrag, useMealDropZone, type DragRowData } from './DiaryDnd';
import { readExpanded, setGroupExpanded } from './expandedGroups';
import { warmUpCamera } from '@/components/cameraWarmup';

export function entryAmountLabel(
  e: Pick<FoodEntry, 'source' | 'quantity' | 'portionLabel' | 'portionGrams' | 'grams'>,
): string {
  if (e.source === 'quick') return 'Schnell eingetragen';
  if (!e.portionLabel || e.portionGrams === null) return e.grams !== null ? fmtGrams(e.grams) : '';
  const isUnit = /^(100|1)\s?(g|ml)$/.test(e.portionLabel);
  if (isUnit)
    return fmtGrams(e.grams ?? e.portionGrams * e.quantity, e.portionLabel.endsWith('ml') ? 'ml' : 'g');
  return `${fmt2(e.quantity)} × ${e.portionLabel}${e.grams !== null ? ` · ${fmtGrams(e.grams)}` : ''}`;
}

/** The taps that open the food page: the camera starts, and logging returns to this diary. */
function useStartLogging(date: ISODate) {
  const rememberStart = useRememberLogStart();
  return () => {
    warmUpCamera();
    rememberStart(date);
  };
}

/** A meal of the day: its time above the card, then name, kcal, actions, entries and waiting analyses. */
export function MealCard({
  meal,
  clipboard = null,
  suggestions,
}: {
  meal: DiaryDayMeal;
  /** What was copied (swipe right); shows the paste icon next to "+". */
  clipboard?: Clipboard | null;
  /** "Zuletzt hier" of this meal (`useDaySuggestions`), undefined while loading. */
  suggestions?: MealSuggestionsData;
}) {
  const db = useDb();
  const { id, date, name, slot, entries, pending } = meal;
  const { setDropRef, isOver: dropOver } = useMealDropZone(id);
  const kcal = get(sumNutrients(entries.map((e) => e.nutrients)), N.kcal);
  const startLogging = useStartLogging(date);
  const target = { date, meal: slot, dm: id };

  return (
    <div ref={setDropRef} data-meal={id} className="mb-[18px]">
      <MealTimeLine meal={meal} />
      <Section
        className={cn(
          'mb-0 transition-[box-shadow,background-color] motion-reduce:transition-none',
          dropOver && 'bg-primary/5 ring-2 ring-primary/60',
        )}
        titleClassName="min-w-0"
        title={
          <span className="flex min-h-11 min-w-0 items-baseline gap-1">
            {/* A meal of waiting analyses only has no record yet that could take a name. */}
            {entries.length > 0 ? <MealNameMenu meal={meal} /> : <MarqueeText text={name} />}
            {entries.length > 0 && (
              // The meal's own page: nutrient overview and its entries.
              <Link
                to="/diary-meal"
                search={target}
                aria-label={`${name}, ${fmt0(kcal)} kcal`}
                className="-mr-2 flex min-h-11 shrink-0 items-center gap-2 rounded-lg pr-2 pl-1 hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="tabular text-sm font-normal text-muted-foreground">{fmt0(kcal)} kcal</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            )}
          </span>
        }
        action={
          <div className="flex shrink-0 items-center">
            {clipboard && <PasteButton db={db} clipboard={clipboard} target={target} mealName={name} />}
            {entries.length > 0 && (
              <DiaryMealMenu
                target={target}
                mealName={name}
                entries={entries}
                yesterday={suggestions?.yesterday ?? null}
              />
            )}
            {/* At a meal only food makes sense: straight to the food page for this meal. */}
            <Button variant="ghost" size="icon" asChild>
              <Link
                to="/photo"
                preload="intent"
                onClick={startLogging}
                search={target}
                aria-label={`Essen zu ${name} eintragen`}
              >
                <Plus className="size-5 text-primary" aria-hidden />
              </Link>
            </Button>
          </div>
        }
      >
        {entries.length > 0 && <DiaryRows entries={entries} date={date} meal={slot} mealId={id} draggable />}
        {pending.length > 0 && (
          <ul className={cn('divide-y divide-border/70', entries.length > 0 && 'border-t border-border/70')}>
            {pending.map((item) => (
              <li key={item.localId} data-row={`pending:${item.localId}`}>
                <PendingAnalysisRow item={item} />
              </li>
            ))}
          </ul>
        )}
        <MealSuggestions target={target} mealName={name} data={suggestions} empty={false} />
      </Section>
    </div>
  );
}

/**
 * The time above a meal card: a tap opens the time dialog. A meal eaten in the night after its day
 * carries a moon with that weekday. A meal of waiting analyses only has no record to take a time.
 */
function MealTimeLine({ meal }: { meal: DiaryDayMeal }) {
  const [open, setOpen] = useState(false);
  const time = fmtTime(meal.eatenAt);
  const night = meal.night && (
    <span className="inline-flex items-center gap-[3px] rounded-full bg-secondary px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground">
      <Moon className="size-[11px]" aria-hidden />
      {fmtWeekdayShort(addDays(meal.date, 1))}
    </span>
  );
  const label = meal.night ? `${time}, Nacht auf ${fmtWeekdayShort(addDays(meal.date, 1))}` : time;
  const text = 'tabular -m-2 p-2 text-[13px] leading-4 font-medium text-muted-foreground';
  return (
    <div className="flex h-[22px] items-center gap-1.5 pl-4">
      {meal.entries.length > 0 ? (
        <>
          <button
            type="button"
            aria-label={`${meal.name} um ${label}, Uhrzeit ändern`}
            onClick={() => setOpen(true)}
            className={cn(
              text,
              'rounded-lg hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            )}
          >
            {time}
          </button>
          <MealTimeDialog meal={meal} open={open} onOpenChange={setOpen} />
        </>
      ) : (
        <span className={text}>{time}</span>
      )}
      {night}
    </div>
  );
}

/** A day without meals: the card of the next one. Nothing exists until something is logged. */
export function EmptyMealCard({
  date,
  next,
  clipboard = null,
  suggestions,
}: {
  date: ISODate;
  next: MealChoice['next'];
  clipboard?: Clipboard | null;
  suggestions?: MealSuggestionsData;
}) {
  const db = useDb();
  const startLogging = useStartLogging(date);
  const target = { date, meal: next.slot, dm: 'new' };
  return (
    <Section
      className="mb-[18px]"
      titleClassName="min-w-0"
      title={<MarqueeText text={next.name} />}
      action={
        <div className="flex shrink-0 items-center">
          {clipboard && <PasteButton db={db} clipboard={clipboard} target={target} mealName={next.name} />}
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/photo"
              preload="intent"
              onClick={startLogging}
              search={target}
              aria-label={`Essen zu ${next.name} eintragen`}
            >
              <Plus className="size-5 text-primary" aria-hidden />
            </Link>
          </Button>
        </div>
      }
    >
      <Link
        to="/photo"
        preload="intent"
        onClick={startLogging}
        search={target}
        className="mx-4 mb-4 flex h-11 w-[calc(100%-2rem)] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Essen eintragen
      </Link>
      {/* What this meal usually gets: one tap logs it again. */}
      <MealSuggestions target={target} mealName={next.name} data={suggestions} empty />
    </Section>
  );
}

/** End of the meal list: the food page for a new meal of this day. */
export function AddMealLink({ date, next }: { date: ISODate; next: MealChoice['next'] }) {
  const startLogging = useStartLogging(date);
  return (
    <Link
      to="/photo"
      preload="intent"
      onClick={startLogging}
      search={{ date, meal: next.slot, dm: 'new' }}
      className="mb-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-input text-sm font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Plus className="size-4" aria-hidden />
      Mahlzeit hinzufügen
    </Link>
  );
}

/** Paste icon of a diary meal: logs what was copied into this meal of the day. */
export function PasteButton({
  db,
  clipboard,
  target,
  mealName,
  iconClassName = 'size-5',
}: {
  db: UserDb;
  clipboard: Clipboard;
  /** The meal it pastes into (`dm: 'new'` for the card of a day without meals). */
  target: MealRef;
  mealName: string;
  /** Icon size: 20 px in a card header; page headers pass '' and get their 24 px. */
  iconClassName?: string;
}) {
  // The clipboard stays after pasting: a second tap while the first runs would log it twice.
  const { run, busy } = useSubmitting();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`„${clipboard.name}“ in ${mealName} eintragen`}
      disabled={busy}
      onClick={() => void run(() => pasteWithToast(db, clipboard, target, mealName))}
    >
      <ClipboardPaste className={cn(iconClassName, 'text-primary')} aria-hidden />
    </Button>
  );
}

/** Copies a diary row (swipe right) and says so; replaces what was copied before. */
async function copyWithToast(
  db: UserDb,
  kind: 'entry' | 'group',
  name: string,
  entries: readonly FoodEntry[],
): Promise<void> {
  await copyToClipboard(db, kind, name, entries);
  copiedToast(name);
}

/** Copies a whole diary meal ("Kopieren" in its ⋯ menu) and says so. */
export async function copyMealWithToast(
  db: UserDb,
  name: string,
  entries: readonly FoodEntry[],
): Promise<void> {
  await copyMealToClipboard(db, name, entries);
  copiedToast(name);
}

function copiedToast(name: string) {
  // The paste icon in the meal headers shows where it goes.
  toast(`„${name}“ kopiert`);
}

/** Logs the clipboard into a diary meal, with an undo toast. */
export async function pasteWithToast(
  db: UserDb,
  clip: Clipboard,
  into: MealRef,
  mealName: string,
): Promise<void> {
  const ids = await pasteClipboard(db, clip, await prepareMealTarget(db, into));
  toast(`„${clip.name}“ in ${mealName} eingetragen`, {
    action: {
      label: 'Rückgängig',
      onClick: () => void Promise.all(ids.map((id) => deleteRecord(db, 'foodEntries', id))),
    },
  });
}

/** Soft-deletes diary entries with an undo toast. */
export async function removeEntriesWithUndo(db: UserDb, list: FoodEntry[], message?: string): Promise<void> {
  const ids = list.map((e) => e.id);
  // One transaction: a group is gone as a whole or not at all.
  await db.transaction('rw', [db.foodEntries, db.outbox], async () => {
    for (const id of ids) await deleteRecord(db, 'foodEntries', id);
  });
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
  mealId,
  draggable = false,
}: {
  entries: FoodEntry[];
  date: ISODate;
  meal: number;
  /** The id of the meal these rows stand in. */
  mealId: string;
  draggable?: boolean;
}) {
  const db = useDb();
  const rows = groupDiaryEntries(entries);
  const mealInfo = useMealInfo(rows.map((r) => (r.kind === 'group' ? r.mealId : null)));
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((row) =>
        row.kind === 'entry' ? (
          <li key={row.entry.id} data-row={row.entry.id}>
            <MaybeDraggable
              enabled={draggable}
              id={row.entry.id}
              data={{
                ids: [row.entry.id],
                meal: mealId,
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
                onCopy={() => void copyWithToast(db, 'entry', row.entry.name, [row.entry])}
              />
            </MaybeDraggable>
          </li>
        ) : (
          <li
            key={row.groupId}
            data-row={`group:${row.groupId}`}
            data-rows={row.entries.map((e) => e.id).join(' ')}
          >
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
              mealId={mealId}
              draggable={draggable}
              onDelete={(list) => void removeEntriesWithUndo(db, list)}
              onCopy={(kind, label, list) => void copyWithToast(db, kind, label, list)}
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
  onCopy,
  className,
}: {
  entry: FoodEntry;
  date: ISODate;
  meal: number;
  onDelete: () => void;
  /** Swipe right: copy this entry (also an ingredient of an expanded group, then only it). */
  onCopy: () => void;
  className?: string;
}) {
  const { dragging } = useDiaryDrag();
  return (
    <SwipeToDelete label={`${e.name} löschen`} onDelete={onDelete} onCopy={onCopy} disabled={dragging}>
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
        <EntryRowBody entry={e} />
      </Link>
    </SwipeToDelete>
  );
}

/** Content of a single diary row (also in the shared day image): name, brand and amount, nutrients. */
export function EntryRowBody({ entry: e }: { entry: FoodEntry }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[e.brand, entryAmountLabel(e)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <NutrientSummary nutrients={e.nutrients} />
    </>
  );
}

/**
 * Content of a group row (also in the shared day image): photo or icon, name, the line below it
 * ("N Zutaten", a toggle in the diary), nutrients.
 */
export function GroupRowBody({
  photo,
  fromPhoto,
  name,
  detail,
  nutrients,
}: {
  /** The photo element, or nothing for the icon. */
  photo?: ReactNode;
  fromPhoto: boolean;
  name: ReactNode;
  detail: ReactNode;
  nutrients: NutrientMap;
}) {
  return (
    <>
      {photo}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-medium">
          {photo ? null : fromPhoto ? (
            <Camera className="size-4 shrink-0 text-muted-foreground" role="img" aria-label="aus Foto" />
          ) : (
            <ListPlus className="size-4 shrink-0 text-muted-foreground" role="img" aria-label="Meal" />
          )}
          {name}
        </div>
        {detail}
      </div>
      <NutrientSummary nutrients={nutrients} />
    </>
  );
}

/** kcal and macros of a diary row, in the form chosen under Mehr → Aussehen. */
function NutrientSummary({ nutrients }: { nutrients: NutrientMap }) {
  const { diaryMacros } = useAppearance();
  return <MacroSummary nutrients={nutrients} variant={diaryMacros} />;
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
  mealId,
  draggable,
  onDelete,
  onCopy,
}: {
  groupId: string;
  name: string;
  photoId: string | null;
  entries: FoodEntry[];
  nutrients: NutrientMap;
  date: ISODate;
  meal: number;
  mealId: string;
  draggable: boolean;
  onDelete: (entries: FoodEntry[]) => void;
  onCopy: (kind: 'entry' | 'group', name: string, entries: FoodEntry[]) => void;
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
          meal: mealId,
          name,
          detail: fmtIngredients(entries.length),
          nutrients,
        }}
      >
        <SwipeToDelete
          label={`${name} löschen`}
          onDelete={() => onDelete(entries)}
          onCopy={() => onCopy('group', name, entries)}
          disabled={dragging}
        >
          <div className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 has-[a:focus-visible]:bg-accent">
            <GroupRowBody
              photo={
                photoId && (
                  <div className="relative size-10 shrink-0">
                    <MealPhoto photoId={photoId} alt="" className="size-10 rounded-lg" placeholder />
                    <PhotoCount count={entries[0] ? photoIdsOf(entries[0]).length : 0} />
                  </div>
                )
              }
              fromPhoto={fromPhoto}
              nutrients={nutrients}
              name={
                <Link
                  to="/diary-group/$groupId"
                  params={{ groupId }}
                  search={{ date }}
                  draggable={false}
                  className="truncate after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {name}
                </Link>
              }
              detail={
                /* The tap area is the button's ::before, placed on the row (the nearest positioned ancestor):
                  left half of the row from below the name line (top-8 = padding + one line) to the bottom,
                  above the stretched link. Wider instead of higher: the name stays free, the row its height. */
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
              }
            />
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
                onCopy={() => onCopy('entry', e.name, [e])}
                className="min-h-12 pl-10 text-sm"
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
