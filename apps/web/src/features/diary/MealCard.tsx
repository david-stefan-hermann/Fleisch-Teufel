import {
  get,
  groupDiaryEntries,
  N,
  uuidv7,
  type FoodEntry,
  type ISODate,
  type NutrientMap,
} from '@ft/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Camera, ChevronDown, Copy, EllipsisVertical, ListPlus, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { useAddSheet } from '@/components/AddSheet';
import { MealPhoto } from '@/components/MealPhoto';
import { Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';
import { useMealInfo } from '@/hooks/data';
import { fmt0, fmt1, fmtGrams } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DraggableRow, useDiaryDrag, useMealDropZone } from './DiaryDnd';

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
  showMicros,
}: {
  date: ISODate;
  meal: number;
  name: string;
  entries: FoodEntry[];
  totals: NutrientMap;
  showMicros: boolean;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const addSheet = useAddSheet();
  const { setDropRef, isOver: dropOver, dragging: dragActive } = useMealDropZone(meal);
  const [saveOpen, setSaveOpen] = useState(false);
  const kcal = get(totals, N.kcal);

  const rows = groupDiaryEntries(entries);
  const mealInfo = useMealInfo(rows.map((r) => (r.kind === 'group' ? r.mealId : null)));

  /** Soft-deletes entries with an undo toast. */
  async function removeEntries(list: FoodEntry[], message?: string) {
    const ids = list.map((e) => e.id);
    for (const id of ids) await deleteRecord(db, 'foodEntries', id);
    toast(message ?? (list.length === 1 ? `${list[0]!.name} gelöscht` : `${list.length} Einträge gelöscht`), {
      action: {
        label: 'Rückgängig',
        onClick: () => void Promise.all(ids.map((id) => restoreRecord(db, 'foodEntries', id))),
      },
    });
  }

  return (
    <Section
      ref={setDropRef}
      className={cn(
        'transition-[box-shadow,background-color] motion-reduce:transition-none',
        dropOver && 'bg-primary/5 ring-2 ring-primary/60',
      )}
      title={
        <span className="flex items-baseline gap-2">
          {name}
          {kcal > 0 && (
            <span className="tabular text-sm font-normal text-muted-foreground">{fmt0(kcal)} kcal</span>
          )}
        </span>
      }
      action={
        <div className="flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Aktionen für ${name}`}>
                <EllipsisVertical aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => void navigate({ to: '/copy-meal', search: { date, meal } })}>
                <Copy aria-hidden /> Von anderem Tag kopieren
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigate({ to: '/meals', search: { date, meal } })}>
                <ListPlus aria-hidden /> Gespeichertes Meal eintragen
              </DropdownMenuItem>
              <DropdownMenuItem disabled={entries.length === 0} onSelect={() => setSaveOpen(true)}>
                <Save aria-hidden /> Als Meal speichern
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={entries.length === 0}
                onSelect={() => void removeEntries(entries, `${name} geleert`)}
              >
                <Trash2 aria-hidden /> Alle Einträge löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Zu ${name} hinzufügen`}
            onClick={() => addSheet.open({ date, meal })}
          >
            <Plus className="size-5 text-primary" aria-hidden />
          </Button>
        </div>
      }
    >
      {entries.length === 0 ? (
        <button
          type="button"
          onClick={() => addSheet.open({ date, meal })}
          className={cn(
            'mx-4 mb-4 flex h-11 w-[calc(100%-2rem)] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            dragActive && 'border-primary/50 text-primary',
          )}
        >
          {dragActive ? 'Hier ablegen' : 'Lebensmittel hinzufügen'}
        </button>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((row) =>
            row.kind === 'entry' ? (
              <li key={row.entry.id}>
                <DraggableRow
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
                    onDelete={() => void removeEntries([row.entry])}
                  />
                </DraggableRow>
              </li>
            ) : (
              <li key={row.groupId}>
                <GroupRow
                  groupId={row.groupId}
                  name={(row.mealId && mealInfo?.get(row.mealId)?.name) || row.groupName || 'Meal'}
                  photoId={(row.mealId && mealInfo?.get(row.mealId)?.photoId) || null}
                  entries={row.entries}
                  nutrients={row.nutrients}
                  date={date}
                  meal={meal}
                  onDelete={(list) => void removeEntries(list)}
                />
              </li>
            ),
          )}
        </ul>
      )}
      {showMicros && entries.length > 0 && <MealMicros totals={totals} />}
      <SaveMealDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultName={`${name} ${new Date().toLocaleDateString('de-DE')}`}
        entries={entries}
      />
    </Section>
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
 * Entries logged together (from a saved meal, or as a named group from an AI analysis): one row,
 * expandable to the single items.
 */
function GroupRow({
  groupId,
  name,
  photoId,
  entries,
  nutrients,
  date,
  meal,
  onDelete,
}: {
  groupId: string;
  name: string;
  photoId: string | null;
  entries: FoodEntry[];
  nutrients: NutrientMap;
  date: ISODate;
  meal: number;
  onDelete: (entries: FoodEntry[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { dragging } = useDiaryDrag();
  const fromPhoto = entries.some((e) => e.source === 'ai');
  return (
    <>
      {/* Only the group row is draggable (the whole meal moves), not its expanded ingredients. */}
      <DraggableRow
        id={`group:${groupId}`}
        data={{ ids: entries.map((e) => e.id), meal, name, detail: `${entries.length} Zutaten`, nutrients }}
      >
        <SwipeToDelete label={`${name} löschen`} onDelete={() => onDelete(entries)} disabled={dragging}>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
          >
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
                <span className="truncate">{name}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {entries.length} Zutaten
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform motion-reduce:transition-none',
                    expanded && 'rotate-180',
                  )}
                  aria-hidden
                />
              </div>
            </div>
            <NutrientSummary nutrients={nutrients} />
          </button>
        </SwipeToDelete>
      </DraggableRow>
      {expanded && (
        <ul className="border-t border-border/70 bg-muted/40" aria-label={`Zutaten von ${name}`}>
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

function MealMicros({ totals }: { totals: NutrientMap }) {
  const items = [
    ['Ballaststoffe', N.fiber],
    ['Zucker', N.sugar],
    ['Ges. Fett', N.satFat],
    ['Salz', N.salt],
  ] as const;
  return (
    <dl className="tabular grid grid-cols-4 gap-2 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
      {items.map(([label, key]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd className="font-medium text-foreground">{fmtGrams(get(totals, key))}</dd>
        </div>
      ))}
    </dl>
  );
}

function SaveMealDialog({
  open,
  onOpenChange,
  defaultName,
  entries,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultName: string;
  entries: FoodEntry[];
}) {
  const db = useDb();
  const [name, setName] = useState(defaultName);
  async function save() {
    const items = entries.map(
      ({ foodId, source, name, brand, grams, portionLabel, portionGrams, quantity, per100, nutrients }) => ({
        foodId,
        source,
        name,
        brand,
        grams,
        portionLabel,
        portionGrams,
        quantity,
        per100,
        nutrients,
      }),
    );
    await saveRecord(db, 'meals', { id: uuidv7(), name: name.trim() || defaultName, items, photoId: null });
    onOpenChange(false);
    toast.success(`„${name.trim() || defaultName}“ gespeichert`);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Als Meal speichern</DialogTitle>
          <DialogDescription>
            {entries.length} Einträge werden als wiederverwendbares Meal gespeichert.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="meal-name">Name</Label>
          <Input
            id="meal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            placeholder="z. B. Mein Frühstück…"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} className={cn(!name.trim() && 'opacity-80')}>
            Meal speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
