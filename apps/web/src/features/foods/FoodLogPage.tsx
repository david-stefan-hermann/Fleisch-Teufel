import {
  addDays,
  computeItem,
  DISPLAY_NUTRIENTS,
  get,
  N,
  portionsFor,
  today,
  uuidv7,
  type Food,
  type FoodEntry,
  type NutrientInfo,
  type Portion,
} from '@ft/shared';
import catalog from '@ft/shared/nutrients-catalog.json';
import { Link, useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarPlus, ChevronDown, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MacroSplitBar } from '@/components/MacroBars';
import { NumberField } from '@/components/NumberField';
import { EmptyState, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { addFoodToDraft } from '@/db/aiDraft';
import { addItemToMeal, logFoodEntry } from '@/db/entries';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';
import { getFood, rememberFood, userPortions } from '@/foods/foodService';
import { useSettings } from '@/hooks/data';
import { fmt0, fmt1, fmtDayShort, fmtGrams, NO_VALUE } from '@/lib/format';
import { parseInto, returnFromInto, type Into } from '@/lib/into';
import { cn } from '@/lib/utils';

const CATALOG = catalog as NutrientInfo[];

/** Handles both `/food/$foodId` (new entry) and `/entry/$entryId` (edit). */
export function FoodLogPage() {
  const params = useParams({ strict: false }) as { foodId?: string; entryId?: string };
  const search = useSearch({ strict: false }) as { date?: string; meal?: number; into?: string };
  const db = useDb();
  const entry = useLiveQuery(
    async () => (params.entryId ? ((await db.foodEntries.get(params.entryId)) ?? null) : null),
    [db, params.entryId],
  );
  const foodId = params.foodId ?? entry?.foodId ?? null;
  const [loaded, setLoaded] = useState<{ id: string; food: Food | null } | null>(null);
  const waitingForEntry = !!params.entryId && entry === undefined;
  const food: Food | null | undefined = waitingForEntry
    ? undefined
    : !foodId
      ? null
      : loaded?.id === foodId
        ? loaded.food
        : undefined;

  useEffect(() => {
    if (waitingForEntry || !foodId) return;
    let cancelled = false;
    getFood(db, foodId).then((f) => !cancelled && setLoaded({ id: foodId, food: f }));
    return () => {
      cancelled = true;
    };
  }, [db, foodId, waitingForEntry]);

  if ((params.entryId && entry === undefined) || food === undefined) {
    return (
      <Page title="Lebensmittel" back withTabBar={false}>
        <Skeleton className="mb-4 h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </Page>
    );
  }
  if (params.entryId && entry === null) {
    return (
      <Page title="Eintrag" back withTabBar={false}>
        <EmptyState title="Eintrag nicht gefunden">
          Er wurde vermutlich auf einem anderen Gerät gelöscht.
        </EmptyState>
      </Page>
    );
  }
  // Edit of an entry whose food is gone (e.g. deleted custom food): fall back to its stored values.
  const effective: Food | null =
    food ??
    (entry?.per100
      ? {
          id: entry.foodId ?? entry.id,
          source: entry.source === 'off' ? 'off' : entry.source === 'bls' ? 'bls' : 'custom',
          sourceId: null,
          name: entry.name,
          nameEn: null,
          brand: entry.brand,
          group: null,
          unit: 'g',
          nutrients: entry.per100,
          portions:
            entry.portionLabel && entry.portionGrams
              ? [{ label: entry.portionLabel, grams: entry.portionGrams }]
              : [],
        }
      : null);
  if (!effective) {
    return (
      <Page title="Lebensmittel" back withTabBar={false}>
        <EmptyState title="Lebensmittel nicht verfügbar">
          Es ist nicht auf diesem Gerät gespeichert und der Server ist nicht erreichbar. Versuche es online
          erneut.
        </EmptyState>
      </Page>
    );
  }
  return (
    <FoodLogForm
      key={effective.id + (entry?.id ?? '')}
      food={effective}
      entry={entry ?? null}
      defaultDate={search.date}
      defaultMeal={search.meal}
      into={entry ? null : parseInto(search.into)}
    />
  );
}

interface FormProps {
  food: Food;
  entry: FoodEntry | null;
  defaultDate?: string;
  defaultMeal?: number;
  /** Add to a saved meal / AI analysis instead of the diary. */
  into: Into | null;
}

/** Loads the data the form needs for its initial values, then mounts the editor. */
function FoodLogForm(props: FormProps) {
  const { food, entry } = props;
  const db = useDb();
  const custom = useLiveQuery(() => userPortions(db, food.id), [db, food.id]);
  const lastUsed = useLiveQuery(
    async () =>
      entry
        ? null
        : ((
            await db.foodEntries
              .where('foodId')
              .equals(food.id)
              .filter((e) => !e.deleted)
              .reverse()
              .sortBy('loggedAt')
          )[0] ?? null),
    [db, food.id, entry],
  );
  if (custom === undefined || lastUsed === undefined) return <Skeleton className="h-64 rounded-2xl" />;
  const portions = portionsFor(food, custom);
  // Initial portion: the entry's, else the last one used for this food, else the food's own serving / 100 g.
  const initial: { portion: Portion; quantity: number } =
    entry?.portionLabel && entry.portionGrams
      ? { portion: { label: entry.portionLabel, grams: entry.portionGrams }, quantity: entry.quantity }
      : lastUsed?.portionLabel && lastUsed.portionGrams
        ? {
            portion: { label: lastUsed.portionLabel, grams: lastUsed.portionGrams },
            quantity: lastUsed.quantity,
          }
        : { portion: portions[0] ?? { label: '100 g', grams: 100 }, quantity: 1 };
  return <FoodLogEditor {...props} customPortions={custom} initial={initial} />;
}

function FoodLogEditor({
  food,
  entry,
  defaultDate,
  defaultMeal,
  into,
  customPortions,
  initial,
}: FormProps & { customPortions: Portion[]; initial: { portion: Portion; quantity: number } }) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const targetMeal = useLiveQuery(
    async () => (into?.kind === 'meal' ? ((await db.meals.get(into.mealId)) ?? null) : null),
    [db, into?.kind === 'meal' ? into.mealId : null],
  );
  const settings = useSettings();
  const portions = useMemo(() => portionsFor(food, customPortions), [food, customPortions]);
  const date = entry?.date ?? defaultDate ?? today();
  const [meal, setMeal] = useState(entry?.meal ?? defaultMeal ?? 0);
  const [portion, setPortion] = useState<Portion | null>(initial.portion);
  const [quantity, setQuantity] = useState<number | null>(initial.quantity);
  const [extraDays, setExtraDays] = useState<string[]>([]);
  const [showDays, setShowDays] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [portionDialog, setPortionDialog] = useState(false);

  const effectivePortion = portion ?? portions[0] ?? { label: '100 g', grams: 100 };
  const q = quantity ?? 0;
  const { grams, nutrients } = computeItem({
    per100: food.nutrients,
    portionLabel: effectivePortion.label,
    portionGrams: effectivePortion.grams,
    quantity: q,
  });
  const valid = q > 0;
  const unit = food.unit;

  async function addToTarget(target: Into) {
    if (target.kind === 'meal') {
      const ok = await addItemToMeal(db, target.mealId, {
        foodId: food.id,
        source: food.source,
        name: food.name,
        brand: food.brand,
        grams,
        portionLabel: effectivePortion.label,
        portionGrams: effectivePortion.grams,
        quantity: q,
        per100: food.nutrients,
        nutrients,
      });
      if (!ok) return void toast.error('Das Meal gibt es nicht mehr.');
    } else {
      await addFoodToDraft(db, target.localId, food, grams);
    }
    await rememberFood(db, food);
    toast.success(`${food.name} hinzugefügt`);
    returnFromInto(
      router.history,
      () =>
        void (target.kind === 'meal'
          ? navigate({ to: '/meals/$mealId', params: { mealId: target.mealId }, replace: true })
          : navigate({ to: '/photo', search: { date, meal, review: target.localId }, replace: true })),
    );
  }

  async function save() {
    if (!valid) return;
    if (into) return addToTarget(into);
    const base = {
      foodId: food.id,
      source: (entry?.source === 'ai' ? 'ai' : food.source) as FoodEntry['source'],
      name: food.name,
      brand: food.brand,
      grams,
      portionLabel: effectivePortion.label,
      portionGrams: effectivePortion.grams,
      quantity: q,
      per100: food.nutrients,
      nutrients,
      meal,
      mealId: entry?.mealId ?? null,
      aiAnalysisId: entry?.aiAnalysisId ?? null,
    };
    if (entry) {
      await saveRecord(db, 'foodEntries', { ...entry, ...base });
      toast.success('Eintrag gespeichert');
    } else {
      const dates = [date, ...extraDays];
      await logFoodEntry(db, base, dates);
      toast.success(
        dates.length > 1 ? `${food.name} an ${dates.length} Tagen eingetragen` : `${food.name} eingetragen`,
      );
    }
    await rememberFood(db, food);
    await navigate({ to: '/', search: { date: entry?.date ?? date } });
  }

  async function remove() {
    if (!entry) return;
    await deleteRecord(db, 'foodEntries', entry.id);
    toast(`${entry.name} gelöscht`, {
      action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'foodEntries', entry.id) },
    });
    await navigate({ to: '/', search: { date: entry.date } });
  }

  const per = unit === 'ml' ? '100 ml' : '100 g';
  const micros = DISPLAY_NUTRIENTS.slice(4);
  const allRows = CATALOG.filter((c) => food.nutrients[c.code] !== undefined);

  return (
    <Page
      title={
        entry
          ? 'Eintrag bearbeiten'
          : into
            ? into.kind === 'meal'
              ? `Zu „${targetMeal?.name ?? 'Meal'}“`
              : 'Zur Foto-Analyse'
            : 'Eintragen'
      }
      back
      withTabBar={false}
      actions={
        entry ? (
          <Button variant="ghost" size="icon" onClick={() => void remove()} aria-label="Eintrag löschen">
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-balance break-words">{food.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {food.brand && <span>{food.brand}</span>}
          <Badge variant="secondary">
            {food.source === 'bls' ? 'BLS 4.0' : food.source === 'off' ? 'Open Food Facts' : 'Eigenes'}
          </Badge>
          {food.group && food.source === 'bls' && <span className="truncate">{food.group}</span>}
          {food.source === 'custom' && (
            <Link
              to="/custom-food/$id"
              params={{ id: food.id }}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Pencil className="size-3" aria-hidden /> Bearbeiten
            </Link>
          )}
        </div>
      </div>

      <Section>
        <div className="grid gap-4 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="portion">Portion</Label>
            <Select
              value={effectivePortion.label}
              onValueChange={(v) => {
                if (v === '__new') return setPortionDialog(true);
                const p = portions.find((x) => x.label === v);
                if (p) setPortion(p);
              }}
            >
              <SelectTrigger id="portion" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ...portions,
                  ...(portions.some((p) => p.label === effectivePortion.label) ? [] : [effectivePortion]),
                ].map((p) => (
                  <SelectItem key={p.label} value={p.label}>
                    {p.label}
                    {!/^(100|1) (g|ml)$/.test(p.label) && (
                      <span className="text-muted-foreground"> · {fmtGrams(p.grams, unit)}</span>
                    )}
                  </SelectItem>
                ))}
                <SelectItem value="__new">+ Eigene Portion anlegen…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Weniger"
              onClick={() =>
                setQuantity(Math.max(0, Math.round((q - stepFor(effectivePortion)) * 100) / 100))
              }
            >
              <Minus aria-hidden />
            </Button>
            <NumberField
              className="flex-1"
              label="Anzahl Portionen"
              value={quantity}
              onValueChange={setQuantity}
              error={quantity !== null && quantity <= 0 ? 'Bitte eine Menge größer 0 eingeben.' : null}
            />
            <Button
              variant="outline"
              size="icon-lg"
              aria-label="Mehr"
              onClick={() => setQuantity(Math.round((q + stepFor(effectivePortion)) * 100) / 100)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <p className="tabular -mt-2 text-sm text-muted-foreground">= {fmtGrams(grams, unit)}</p>
          {!into && (
            <div className="grid gap-1.5">
              <Label htmlFor="meal">Mahlzeit</Label>
              <Select value={String(meal)} onValueChange={(v) => setMeal(Number(v))}>
                <SelectTrigger id="meal" className="w-full">
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
          )}
          {!entry && !into && (
            <div>
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                aria-expanded={showDays}
                onClick={() => setShowDays(!showDays)}
              >
                <CalendarPlus className="size-4" aria-hidden /> Auch an weiteren Tagen eintragen
                {extraDays.length > 0 && <Badge>{extraDays.length}</Badge>}
              </button>
              {showDays && (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {Array.from({ length: 14 }, (_, i) => addDays(date, i - 6))
                    .filter((d) => d !== date)
                    .map((d) => {
                      const on = extraDays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setExtraDays(on ? extraDays.filter((x) => x !== d) : [...extraDays, d])
                          }
                          className={cn(
                            'h-11 rounded-lg border text-xs transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                          )}
                        >
                          {fmtDayShort(d)}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Nährwerte dieser Menge">
        <div className="px-4 pb-4">
          <div className="flex items-baseline justify-between">
            <span className="tabular text-3xl font-bold">{fmt0(get(nutrients, N.kcal))}</span>
            <span className="text-sm text-muted-foreground">kcal</span>
          </div>
          <div className="my-3">
            <MacroSplitBar
              protein={get(nutrients, N.protein)}
              carbs={get(nutrients, N.carbs)}
              fat={get(nutrients, N.fat)}
            />
          </div>
          <dl className="tabular grid grid-cols-3 gap-2 text-sm">
            <Macro label="Protein" value={get(nutrients, N.protein)} className="bg-protein" />
            <Macro label="Kohlenhydrate" value={get(nutrients, N.carbs)} className="bg-carbs" />
            <Macro label="Fett" value={get(nutrients, N.fat)} className="bg-fat" />
          </dl>
          <dl className="tabular mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-sm">
            {micros.map((m) => (
              <div key={m.code} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{m.de}</dt>
                <dd>{nutrients[m.code] !== undefined ? fmtGrams(nutrients[m.code]!) : NO_VALUE}</dd>
              </div>
            ))}
          </dl>
          {allRows.length > 12 && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
              className="mt-3 flex items-center gap-1 text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none"
            >
              Alle {allRows.length} Nährstoffe pro {per}
              <ChevronDown
                className={cn(
                  'size-4 transition-transform motion-reduce:transition-none',
                  showAll && 'rotate-180',
                )}
                aria-hidden
              />
            </button>
          )}
          {showAll && (
            <dl className="tabular mt-2 grid gap-y-1 text-xs">
              {allRows.map((c) => (
                <div key={c.code} className="flex justify-between gap-2 border-b border-border/40 py-1">
                  <dt className="text-muted-foreground">{c.de}</dt>
                  <dd className="shrink-0">
                    {fmt1(food.nutrients[c.code]!)} {c.unit}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </Section>

      {food.source === 'bls' && (
        <p className="mb-4 text-xs text-muted-foreground">
          Quelle: Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0.
        </p>
      )}
      {food.source === 'off' && (
        <p className="mb-4 text-xs text-muted-foreground">
          Quelle: Open Food Facts (ODbL). Angaben der Community, ohne Gewähr.
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-border/70 bg-background/90 px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] backdrop-blur-md">
        <Button size="lg" className="w-full" disabled={!valid} onClick={() => void save()}>
          {entry
            ? 'Änderungen speichern'
            : into
              ? into.kind === 'meal'
                ? 'Zum Meal hinzufügen'
                : 'Zur Analyse hinzufügen'
              : `Zu ${settings?.mealNames[meal] ?? 'Mahlzeit'} hinzufügen`}
        </Button>
      </div>

      <NewPortionDialog
        open={portionDialog}
        onOpenChange={setPortionDialog}
        unit={unit}
        onSave={async (label, gramsPerPortion) => {
          await saveRecord(db, 'foodPortions', {
            id: uuidv7(),
            foodId: food.id,
            label,
            grams: gramsPerPortion,
          });
          setPortion({ label, grams: gramsPerPortion });
          setQuantity(1);
        }}
      />
    </Page>
  );
}

function stepFor(p: Portion): number {
  return p.grams <= 1 ? 10 : p.grams === 100 ? 0.5 : 1;
}

function Macro({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn('size-2 rounded-full', className)} aria-hidden />
        {label}
      </dt>
      <dd className="font-semibold">{fmtGrams(value)}</dd>
    </div>
  );
}

function NewPortionDialog({
  open,
  onOpenChange,
  unit,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  unit: 'g' | 'ml';
  onSave: (label: string, grams: number) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [grams, setGrams] = useState<number | null>(null);
  const valid = label.trim().length > 0 && grams !== null && grams > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eigene Portion</DialogTitle>
          <DialogDescription>
            Zum Beispiel „Meine Müslischale“ oder „1 Scheibe“. Gilt auf allen deinen Geräten.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="portion-label">Bezeichnung</Label>
            <Input
              id="portion-label"
              autoComplete="off"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="z. B. 1 Scheibe…"
            />
          </div>
          <NumberField label={`Menge in ${unit}`} value={grams} onValueChange={setGrams} unit={unit} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              await onSave(label.trim(), grams!);
              setLabel('');
              setGrams(null);
              onOpenChange(false);
            }}
          >
            Portion speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
