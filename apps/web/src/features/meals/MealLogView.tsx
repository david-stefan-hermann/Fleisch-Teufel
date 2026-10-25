import {
  get,
  mealFactorForGrams,
  mealWeightGrams,
  N,
  rescaleItem,
  sumNutrients,
  scaleNutrients,
  targetsForDate,
  type Food,
  type Meal,
  type MealItem,
} from '@ft/shared';
import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronDown, Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { Page, Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NumberField } from '@/components/NumberField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useGoals, useSettings } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmtFixed, fmtGrams, fmtIngredients } from '@/lib/format';
import { addFoodsToDraft, type AiItem } from '@/db/aiDraft';
import type { UserDb } from '@/db/dexie';
import { addItemsToGroupDraft } from '@/db/groupDraft';
import { addItemsToMealDraft } from '@/db/mealDraft';
import { getFood } from '@/foods/foodService';
import { isBasePortion } from '@/lib/amounts';
import { openTarget, returnFromInto, type Into } from '@/lib/into';
import { logItems } from './logMeal';

const FACTOR_MIN = 0.5;
const FACTOR_MAX = 2;

/**
 * Logging a saved meal (food search, tab "Eigene"): its ingredients read-only, a swipe leaves one
 * out of this entry only (an open row goes with it), a tap shows the nutrients of one ingredient, the
 * amount goes from 0,5× to 2×. The pencil ("Meal bearbeiten") opens the
 * editor; saving there comes back here with the new ingredients (`MealPage` keys this view by `updatedAt`).
 * With `into` (food search for a meal, an AI review or a diary group) the kept ingredients are added
 * there one by one instead ("N Zutaten hinzufügen"; no pencil, no diary meal to pick).
 */
export function MealLogView({
  meal,
  date,
  mealIndex,
  into = null,
}: {
  meal: Meal;
  date: string;
  mealIndex: number;
  into?: Into | null;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const settings = useSettings();
  const goals = useGoals();
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const [factor, setFactor] = useState(1);
  // Recipe mode: grams eaten of the cooked meal set the factor (the slider follows, clamped to its range).
  const cookedWeight = meal.cookedGrams ? mealWeightGrams(meal) : null;
  const [eatenGrams, setEatenGrams] = useState<number | null>(null);
  const setGrams = (g: number | null) => {
    setEatenGrams(g);
    const f = g && g > 0 && cookedWeight ? mealFactorForGrams(meal, g) : null;
    if (f !== null) setFactor(f);
  };
  const [target, setTarget] = useState(mealIndex);
  // One ingredient row at a time shows its nutrients.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const targets = targetsForDate(goals ?? [], date);

  const kept = meal.items.filter((_, i) => !excluded.has(i));
  // Same rounding as `logItems`, so the button shows what gets logged.
  const scaled = kept.map((it) =>
    factor === 1 ? it : rescaleItem(it, Math.round(it.quantity * factor * 1000) / 1000),
  );
  const totals = sumNutrients(scaled.map((i) => i.nutrients));
  const kcal = get(totals, N.kcal);
  const left = meal.items.filter((_, i) => excluded.has(i));

  function exclude(index: number) {
    if (kept.length <= 1) {
      toast.error('Mindestens eine Zutat bleibt.');
      return;
    }
    setExcluded((s) => new Set(s).add(index));
    if (openIndex === index) setOpenIndex(null);
    toast(`${meal.items[index]!.name} entfernt`, {
      action: {
        label: 'Rückgängig',
        onClick: () =>
          setExcluded((s) => {
            const next = new Set(s);
            next.delete(index);
            return next;
          }),
      },
    });
  }

  const { busy, run } = useSubmitting();
  async function log() {
    const { length: n } = await logItems(
      db,
      kept,
      { date, meal: target },
      { factor, mealId: meal.id, photoIds: meal.photoId ? [meal.photoId] : null },
    );
    toast.success(`${meal.name}: ${fmtIngredients(n)} eingetragen`);
    await navigate({ to: '/', search: { date } });
  }

  async function add(target: Into) {
    const ok =
      target.kind === 'meal'
        ? await addItemsToMealDraft(db, target.mealId, scaled)
        : target.kind === 'group'
          ? await addItemsToGroupDraft(db, target.groupId, date, scaled)
          : await addFoodsToDraft(db, target.localId, await Promise.all(scaled.map((i) => aiItemOf(db, i))));
    if (!ok)
      return void toast.error(
        target.kind === 'meal'
          ? 'Das Meal gibt es nicht mehr.'
          : target.kind === 'group'
            ? 'Den Eintrag gibt es nicht mehr.'
            : 'Die Analyse gibt es nicht mehr.',
      );
    toast.success(`„${meal.name}“: ${fmtIngredients(scaled.length)} hinzugefügt`);
    returnFromInto(router.history, () => openTarget(navigate, target, date, mealIndex));
  }

  return (
    <Page
      title={meal.name}
      back
      withTabBar={false}
      actions={
        into ? undefined : (
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/meals/$mealId"
              params={{ mealId: meal.id }}
              search={{ from: 'log' }}
              aria-label="Meal bearbeiten"
            >
              <Pencil aria-hidden />
            </Link>
          </Button>
        )
      }
      footer={
        into ? (
          <Button size="lg" disabled={busy} onClick={() => void run(() => add(into))}>
            {fmtIngredients(scaled.length)} hinzufügen
          </Button>
        ) : (
          <Button size="lg" disabled={busy} onClick={() => void run(log)}>
            {fmt0(kcal)} kcal eintragen
          </Button>
        )
      }
    >
      {meal.photoId && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-border/70">
          <MealPhoto photoId={meal.photoId} alt={`Foto von ${meal.name}`} className="aspect-[4/3] w-full" />
        </div>
      )}
      <Section title="Zutaten">
        <ul className="divide-y divide-border/70 border-t border-border/70">
          {meal.items.map((it, i) =>
            excluded.has(i) ? null : (
              <li key={i}>
                <SwipeToDelete label={`${it.name} für diesen Eintrag entfernen`} onDelete={() => exclude(i)}>
                  {/* SwipeToDelete swallows the click after a horizontal move, so a started swipe never opens. */}
                  <button
                    type="button"
                    aria-expanded={openIndex === i}
                    aria-controls={`ingredient-${i}-nutrients`}
                    onClick={() => setOpenIndex(openIndex === i ? null : i)}
                    className="group flex min-h-12 w-full items-center gap-3 py-2 pr-3 pl-4 text-left select-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{it.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{entryAmountLabel(it)}</div>
                    </div>
                    <div className="tabular font-semibold">{fmt0(get(it.nutrients, N.kcal))}</div>
                    <ChevronDown
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </button>
                  {openIndex === i && (
                    <div id={`ingredient-${i}-nutrients`} className="px-4 pb-3">
                      <NutrientBreakdown
                        title={entryAmountLabel(it)}
                        nutrients={it.nutrients}
                        targets={targets}
                      />
                    </div>
                  )}
                </SwipeToDelete>
              </li>
            ),
          )}
        </ul>
        {left.length > 0 && (
          <p className="border-t border-border/70 px-4 py-3 text-xs text-muted-foreground text-pretty">
            Ohne {left.map((it) => it.name).join(', ')}. Das gespeicherte Meal bleibt unverändert.
          </p>
        )}
      </Section>
      <Section title="Nährwerte">
        <NutrientBreakdown className="px-4 pb-3" nutrients={totals} targets={targets} />
      </Section>
      <Section title={into ? 'Menge' : 'Eintragen'}>
        <div className="grid gap-4 px-4 pb-4">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="meal-factor">Menge</Label>
              <output htmlFor="meal-factor" className="tabular text-lg font-semibold">
                {fmtFixed(factor, eatenGrams ? 2 : 1)}×
              </output>
            </div>
            <Slider
              id="meal-factor"
              aria-label="Menge"
              aria-valuetext={`${fmtFixed(factor, 1)}-fach`}
              min={FACTOR_MIN}
              max={FACTOR_MAX}
              step={0.1}
              value={[Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, factor))]}
              onValueChange={([v]) => {
                if (v === undefined) return;
                setFactor(Math.round(v * 10) / 10);
                setEatenGrams(null);
              }}
            />
            <div className="relative h-4 text-xs text-muted-foreground" aria-hidden>
              <span className="absolute left-0">0,5×</span>
              <span
                className="absolute -translate-x-1/2"
                style={{ left: `${((1 - FACTOR_MIN) / (FACTOR_MAX - FACTOR_MIN)) * 100}%` }}
              >
                1×
              </span>
              <span className="absolute right-0">2×</span>
            </div>
          </div>
          {cookedWeight && (
            <NumberField
              label="Gegessen (gekocht)"
              unit="g"
              integer
              value={eatenGrams}
              onValueChange={setGrams}
              hint={`Ganzes Rezept ${fmtGrams(cookedWeight)} gekocht; ${fmt0(factor * 100)} % davon.`}
            />
          )}
          {!into && (
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
          )}
        </div>
      </Section>
    </Page>
  );
}

/**
 * An ingredient of a saved meal as a row of an AI review: its database food (portions included) when
 * there is one, else a snapshot with its values per 100 g, logged like an estimate (without food id).
 */
async function aiItemOf(db: UserDb, item: MealItem): Promise<AiItem> {
  const grams = item.grams ?? 100;
  const portion =
    item.portionLabel && item.portionGrams && item.portionGrams > 0
      ? { label: item.portionLabel, grams: item.portionGrams }
      : null;
  const known = item.foodId ? await getFood(db, item.foodId).catch(() => null) : null;
  const per100 = item.per100 ?? scaleNutrients(item.nutrients, item.grams ? 10_000 / item.grams : 100);
  const food: Food = known ?? {
    id: item.foodId ?? `meal-item:${item.name}`,
    source: item.foodId?.startsWith('bls:') ? 'bls' : item.foodId?.startsWith('off:') ? 'off' : 'custom',
    sourceId: null,
    name: item.name,
    nameEn: null,
    brand: item.brand,
    group: null,
    unit: item.portionLabel?.endsWith('ml') ? 'ml' : 'g',
    nutrients: per100,
    portions: portion && !isBasePortion(portion) ? [portion] : [],
    estimated: !item.foodId,
  };
  return { food, grams, portion: portion && !isBasePortion(portion) ? portion : null };
}
