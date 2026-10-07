import { get, N, uuidv7, type FoodEntry, type ISODate, type NutrientMap } from '@ft/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Copy, EllipsisVertical, ListPlus, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
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
import { fmt0, fmt1, fmtGrams } from '@/lib/format';
import { cn } from '@/lib/utils';

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
  const [saveOpen, setSaveOpen] = useState(false);
  const kcal = get(totals, N.kcal);

  async function clearMeal() {
    const ids = entries.map((e) => e.id);
    for (const id of ids) await deleteRecord(db, 'foodEntries', id);
    toast(`${name} geleert`, {
      action: {
        label: 'Rückgängig',
        onClick: () => void Promise.all(ids.map((id) => restoreRecord(db, 'foodEntries', id))),
      },
    });
  }

  return (
    <Section
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
                onSelect={() => void clearMeal()}
              >
                <Trash2 aria-hidden /> Alle Einträge löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" asChild>
            <Link to="/add" search={{ date, meal }} aria-label={`Zu ${name} hinzufügen`}>
              <Plus className="size-5 text-primary" aria-hidden />
            </Link>
          </Button>
        </div>
      }
    >
      {entries.length === 0 ? (
        <Link
          to="/add"
          search={{ date, meal }}
          className="mx-4 mb-4 flex h-11 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Lebensmittel hinzufügen
        </Link>
      ) : (
        <ul className="divide-y divide-border/70 pb-1">
          {entries.map((e) => (
            <li key={e.id}>
              <Link
                to={e.source === 'quick' ? '/quick-add' : '/entry/$entryId'}
                params={{ entryId: e.id }}
                search={e.source === 'quick' ? { date, meal, entryId: e.id } : undefined}
                className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[e.brand, entryAmountLabel(e)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="tabular text-right">
                  <div className="font-semibold">{fmt0(get(e.nutrients, N.kcal))}</div>
                  <div className="text-[11px] text-muted-foreground">
                    P {fmt0(get(e.nutrients, N.protein))} · K {fmt0(get(e.nutrients, N.carbs))} · F{' '}
                    {fmt0(get(e.nutrients, N.fat))}
                  </div>
                </div>
              </Link>
            </li>
          ))}
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
    await saveRecord(db, 'meals', { id: uuidv7(), name: name.trim() || defaultName, items });
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
