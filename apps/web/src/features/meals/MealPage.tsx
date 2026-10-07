import {
  get,
  N,
  rescaleItem,
  sumNutrients,
  targetsForDate,
  today,
  type Meal,
  type MealItem,
} from '@ft/shared';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { NumberField } from '@/components/NumberField';
import { EmptyState, Page, Section } from '@/components/Page';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { updateMealItem } from '@/db/entries';
import { storePhoto } from '@/db/photos';
import { deleteRecord, patchRecord, restoreRecord } from '@/db/write';
import { compressImage } from '@/features/ai/image';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useGoals, useSettings } from '@/hooks/data';
import { fmt0, fmtGrams, fmtIngredients } from '@/lib/format';
import { rememberIntoStart } from '@/lib/into';
import { logItems } from './logMeal';

const FACTORS = [0.5, 1, 1.5, 2];

/** Saved meal: log it (scaled), and edit name, photo and ingredients. */
export function MealPage() {
  const { mealId } = useParams({ from: '/authed/meals/$mealId' });
  const search = useSearch({ from: '/authed/meals/$mealId' });
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const settings = useSettings();
  const goals = useGoals();
  const meal = useLiveQuery(async () => (await db.meals.get(mealId)) ?? null, [db, mealId]);
  const [name, setName] = useState<string | null>(null);
  const [factor, setFactor] = useState(1);
  const [target, setTarget] = useState(search.meal ?? 0);
  const [editing, setEditing] = useState<number | null>(null);
  const date = search.date ?? today();

  if (meal === undefined) return null;
  if (!meal || meal.deleted) {
    return (
      <Page title="Meal" back withTabBar={false}>
        <EmptyState title="Meal nicht gefunden" />
      </Page>
    );
  }
  const totals = sumNutrients(meal.items.map((i) => i.nutrients));

  async function removeItem(m: Meal, index: number) {
    if (m.items.length === 1) {
      toast.error('Ein Meal braucht mindestens eine Zutat. Lösche stattdessen das ganze Meal.');
      return;
    }
    const before = m.items;
    await updateMealItem(db, m.id, index, null);
    toast(`${before[index]!.name} entfernt`, {
      action: { label: 'Rückgängig', onClick: () => void patchRecord(db, 'meals', m.id, { items: before }) },
    });
  }

  return (
    <Page
      title={meal.name}
      back
      withTabBar={false}
      actions={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Meal löschen"
          onClick={async () => {
            await deleteRecord(db, 'meals', meal.id);
            toast(`${meal.name} gelöscht`, {
              action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'meals', meal.id) },
            });
            await navigate({ to: '/meals', search: { date: search.date, meal: search.meal } });
          }}
        >
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
    >
      <PhotoSection meal={meal} />
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="meal-name">Name</Label>
          <Input
            id="meal-name"
            autoComplete="off"
            maxLength={120}
            value={name ?? meal.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name?.trim();
              if (n && n !== meal.name) void patchRecord(db, 'meals', meal.id, { name: n });
              setName(null);
            }}
          />
        </div>
      </Section>
      <Section title="Zutaten">
        <ul className="divide-y divide-border/70 border-t border-border/70">
          {meal.items.map((i, idx) => (
            <li key={`${idx}-${i.name}`}>
              <SwipeToDelete label={`${i.name} entfernen`} onDelete={() => void removeItem(meal, idx)}>
                <button
                  type="button"
                  onClick={() => setEditing(idx)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition-colors select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{i.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{entryAmountLabel(i)}</div>
                  </div>
                  <div className="tabular font-semibold">{fmt0(get(i.nutrients, N.kcal))}</div>
                </button>
              </SwipeToDelete>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 border-t border-border/70 p-3">
          <Button
            variant="outline"
            onClick={() => {
              rememberIntoStart(router.history);
              void navigate({ to: '/add', search: { date, meal: target, into: `meal:${meal.id}` } });
            }}
          >
            <Plus aria-hidden /> Zutat hinzufügen
          </Button>
          <p className="px-1 text-xs text-muted-foreground">
            Tippen ändert die Menge, nach links wischen entfernt eine Zutat. Änderungen gelten für künftige
            Einträge. Bereits eingetragene Tage bleiben, wie sie sind.
          </p>
        </div>
      </Section>
      <Section title="Nährwerte">
        <NutrientBreakdown
          className="px-4 pb-3"
          nutrients={totals}
          targets={targetsForDate(goals ?? [], date)}
        />
      </Section>
      <Section title="Eintragen">
        <div className="grid gap-4 px-4 pb-4">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Menge</span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(factor)}
              onValueChange={(v) => v && setFactor(Number(v))}
              className="w-full"
            >
              {FACTORS.map((f) => (
                <ToggleGroupItem key={f} value={String(f)} className="flex-1">
                  {f.toLocaleString('de-DE')}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="meal-target">Mahlzeit</Label>
            <Select value={String(target)} onValueChange={(v) => setTarget(Number(v))}>
              <SelectTrigger id="meal-target" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(settings?.mealNames ?? []).map((n, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="lg"
            onClick={async () => {
              const n = await logItems(db, meal.items, { date, meal: target }, { factor, mealId: meal.id });
              toast.success(`${meal.name}: ${fmtIngredients(n)} eingetragen`);
              await navigate({ to: '/', search: { date } });
            }}
          >
            {fmt0(get(totals, N.kcal) * factor)} kcal eintragen
          </Button>
        </div>
      </Section>
      {editing !== null && meal.items[editing] && (
        <AmountDialog
          key={editing}
          item={meal.items[editing]}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await updateMealItem(db, meal.id, editing, item);
            setEditing(null);
          }}
        />
      )}
    </Page>
  );
}

function PhotoSection({ meal }: { meal: Meal }) {
  const db = useDb();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file, 600_000, 0.8);
      const photoId = await storePhoto(db, blob);
      await patchRecord(db, 'meals', meal.id, { photoId });
    } catch {
      toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
    } finally {
      setBusy(false);
    }
  }

  const input = (ref: typeof camera, capture: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      {...(capture ? { capture: 'environment' as const } : {})}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        void pick(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  return (
    <Section>
      {input(camera, true)}
      {input(gallery, false)}
      {meal.photoId ? (
        <div className="relative">
          <MealPhoto photoId={meal.photoId} alt={`Foto von ${meal.name}`} className="aspect-[4/3] w-full" />
          <div className="absolute right-2 bottom-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => gallery.current?.click()}
              aria-label="Foto ändern"
            >
              <ImagePlus aria-hidden /> Ändern
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              disabled={busy}
              aria-label="Foto entfernen"
              onClick={async () => {
                const before = meal.photoId;
                await patchRecord(db, 'meals', meal.id, { photoId: null });
                toast('Foto entfernt', {
                  action: {
                    label: 'Rückgängig',
                    onClick: () => void patchRecord(db, 'meals', meal.id, { photoId: before }),
                  },
                });
              }}
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4">
          <Button
            variant="outline"
            className="h-20 flex-col gap-1"
            disabled={busy}
            onClick={() => camera.current?.click()}
          >
            <Camera className="size-6 text-primary" aria-hidden /> Foto aufnehmen
          </Button>
          <Button
            variant="outline"
            className="h-20 flex-col gap-1"
            disabled={busy}
            onClick={() => gallery.current?.click()}
          >
            <ImagePlus className="size-6 text-primary" aria-hidden /> Aus Mediathek
          </Button>
        </div>
      )}
    </Section>
  );
}

/** Changes the amount of one ingredient: portions for portion-based items, else grams. */
function AmountDialog({
  item,
  onClose,
  onSave,
}: {
  item: MealItem;
  onClose: () => void;
  onSave: (item: MealItem) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState<number | null>(item.quantity);
  const byGram = !item.portionLabel || /^1\s?(g|ml)$/.test(item.portionLabel);
  const unit = item.portionLabel?.endsWith('ml') ? 'ml' : 'g';
  const valid = quantity !== null && quantity > 0;
  const preview = valid ? rescaleItem(item, quantity) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>Menge in diesem Meal ändern.</DialogDescription>
        </DialogHeader>
        <NumberField
          label={byGram ? 'Menge' : `Anzahl · ${item.portionLabel}`}
          unit={byGram ? unit : '×'}
          value={quantity}
          onValueChange={setQuantity}
          error={quantity !== null && quantity <= 0 ? 'Bitte eine Menge größer 0 eingeben.' : null}
        />
        {preview && (
          <p className="tabular text-sm text-muted-foreground">
            {preview.grams !== null && !byGram ? `${fmtGrams(preview.grams, unit)} · ` : ''}
            {fmt0(get(preview.nutrients, N.kcal))} kcal · P {fmt0(get(preview.nutrients, N.protein))} · K{' '}
            {fmt0(get(preview.nutrients, N.carbs))} · F {fmt0(get(preview.nutrients, N.fat))}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!preview} onClick={() => preview && void onSave(preview)}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
