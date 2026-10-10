import {
  computeItem,
  get,
  multiplyNutrients,
  N,
  portionsFor,
  rescaleItem,
  type Food,
  type MealItem,
  type Portion,
  type ResolvedTargets,
} from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDb } from '@/app/session';
import { AmountEditor, type Amount } from '@/components/AmountEditor';
import { NutrientsDisclosure } from '@/components/NutrientsDisclosure';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { getFood, userPortions } from '@/foods/foodService';
import { editorPortions } from '@/lib/amounts';
import { fmt0 } from '@/lib/format';

/** Ingredients counted in grams (1 g / 1 ml portions); everything else counts pieces of a portion. */
export function isGramItem(item: Pick<MealItem, 'portionLabel'>): boolean {
  return !!item.portionLabel && /^1\s?(g|ml)$/.test(item.portionLabel);
}

/** Smallest amount an ingredient can be set to (it keeps its nutrients per unit that way). */
export const minQuantity = (item: Pick<MealItem, 'portionLabel'>) => (isGramItem(item) ? 1 : 0.1);

/** Range of the "Gesamtmenge" slider of the meal and diary group editors. */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 3;

/**
 * "Gesamtmenge": scales every ingredient of `base` (the amounts after the last manual change) by
 * `factor`, grams to whole numbers, pieces to tenths, never below `minQuantity`. Extra fields stay.
 */
export function scaleItems<T extends MealItem>(base: readonly T[], factor: number): T[] {
  return base.map((it) => {
    const q = it.quantity * factor;
    const rounded = isGramItem(it) ? Math.round(q) : Math.round(q * 10) / 10;
    return rescaleItem(it, Math.max(minQuantity(it), rounded));
  });
}

/** Unit choice of an ingredient: its food's portions (local data only) and the user's own ones. */
function useItemPortions(item: MealItem): { unit: 'g' | 'ml'; portions: Portion[] } {
  const db = useDb();
  const foodId = item.foodId;
  const [loaded, setLoaded] = useState<{ id: string; food: Food | null } | null>(null);
  useEffect(() => {
    if (!foodId) return;
    let cancelled = false;
    // Never the network: an ingredient without local food data simply offers fewer units.
    void getFood(db, foodId, { enrich: false }).then((food) => !cancelled && setLoaded({ id: foodId, food }));
    return () => {
      cancelled = true;
    };
  }, [db, foodId]);
  const own = useLiveQuery(async () => (foodId ? userPortions(db, foodId) : []), [db, foodId]);
  const food = loaded && loaded.id === foodId ? loaded.food : null;
  const unit = food?.unit ?? (item.portionLabel?.endsWith('ml') ? 'ml' : 'g');
  const current = itemPortion(item);
  // Without per-100 values or portion weight the amount can only be counted as it is.
  if (!item.per100 || !(current.grams > 0)) return { unit, portions: [current] };
  return {
    unit,
    portions: editorPortions(
      unit,
      portionsFor(food ?? { portions: [], unit, name: item.name }, own ?? []),
      current,
    ),
  };
}

/** The ingredient's portion ("1 g" for gram ingredients, "Portion" for quick entries without one). */
export function itemPortion(item: Pick<MealItem, 'portionLabel' | 'portionGrams'>): Portion {
  return { label: item.portionLabel ?? 'Portion', grams: item.portionGrams ?? 0 };
}

/** The ingredient with another amount, also in another unit (the nutrients follow the grams). */
export function itemWithAmount(item: MealItem, amount: { portion: Portion; quantity: number }): MealItem {
  const { portion, quantity } = amount;
  // Same unit (also a quick entry without portion): the count changes, everything else scales.
  if (portion.label === itemPortion(item).label) return rescaleItem(item, quantity);
  if (item.per100) {
    const { grams, nutrients } = computeItem({
      per100: item.per100,
      portionLabel: portion.label,
      portionGrams: portion.grams,
      quantity,
    });
    return { ...item, portionLabel: portion.label, portionGrams: portion.grams, quantity, grams, nutrients };
  }
  const grams = Math.round(portion.grams * quantity * 100) / 100;
  const factor = item.grams ? grams / item.grams : 0;
  return {
    ...item,
    portionLabel: portion.label,
    portionGrams: portion.grams,
    quantity,
    grams,
    nutrients: multiplyNutrients(item.nutrients, factor),
  };
}

/**
 * One ingredient of the meal editor and the diary group editor, laid out like an ingredient of the
 * AI review: name, kcal and remove in the head, then the amount editor (unit, slider, −/+ and
 * field). "Nährwerte" at the bottom opens the overview of the current amount (it follows the
 * editor).
 */
export function IngredientCard({
  item,
  removable,
  targets,
  onChange,
  onCommit,
  onRemove,
}: {
  item: MealItem;
  removable: boolean;
  targets: ResolvedTargets;
  /** Live change while the slider is dragged or −/+ held (show it, do not save it yet). */
  onChange: (item: MealItem) => void;
  /** Final change: slider let go, typed, unit switched. Save it. */
  onCommit: (item: MealItem) => void;
  onRemove: () => void;
}) {
  const { unit, portions } = useItemPortions(item);
  const apply = (cb: (item: MealItem) => void) => (a: Amount) => {
    // An empty or invalid field keeps the last amount; the editor says why.
    if (a.quantity !== null) cb(itemWithAmount(item, { portion: a.portion, quantity: a.quantity }));
  };
  return (
    <Section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold break-words">{item.name}</div>
            {item.brand && <div className="text-xs text-muted-foreground">{item.brand}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="tabular font-semibold">{fmt0(get(item.nutrients, N.kcal))} kcal</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${item.name} entfernen`}
              disabled={!removable}
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
        <AmountEditor
          name={item.name}
          unit={unit}
          portions={portions}
          value={{ portion: itemPortion(item), quantity: item.quantity }}
          onChange={apply(onChange)}
          onCommit={apply(onCommit)}
        />
        <NutrientsDisclosure title={entryAmountLabel(item)} nutrients={item.nutrients} targets={targets} />
      </div>
    </Section>
  );
}
