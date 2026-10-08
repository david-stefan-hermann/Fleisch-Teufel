import { get, N, rescaleItem, type MealItem } from '@ft/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { rowSliderMax } from '@/lib/amounts';
import { fmt0 } from '@/lib/format';

/** Ingredients counted in grams (1 g / 1 ml portions); everything else counts pieces of a portion. */
export function isGramItem(item: Pick<MealItem, 'portionLabel'>): boolean {
  return !!item.portionLabel && /^1\s?(g|ml)$/.test(item.portionLabel);
}

/** Smallest amount an ingredient can be set to (it keeps its nutrients per unit that way). */
export const minQuantity = (item: Pick<MealItem, 'portionLabel'>) => (isGramItem(item) ? 1 : 0.1);

/**
 * One ingredient of the meal editor, laid out like an ingredient of the AI review: name, kcal and
 * remove in the head, then a slider with a number field. Gram ingredients move in 5 g steps, piece
 * ingredients ("Anzahl · Stück") in halves.
 */
export function IngredientCard({
  item,
  index,
  base,
  removable,
  onChange,
  onRemove,
}: {
  item: MealItem;
  index: number;
  /** Reference quantity for the slider range (the amount before "Gesamtmenge" scaled it). */
  base: number;
  removable: boolean;
  onChange: (item: MealItem) => void;
  onRemove: () => void;
}) {
  const grams = isGramItem(item);
  const unit = item.portionLabel?.endsWith('ml') ? 'ml' : 'g';
  const min = minQuantity(item);
  // A typed amount below the minimum (or empty) is not applied; the field says why.
  const [invalid, setInvalid] = useState(false);
  const set = (q: number | null) => {
    const ok = q !== null && q >= min;
    setInvalid(!ok);
    if (ok) onChange(rescaleItem(item, Math.round(q * 100) / 100));
  };
  const max = grams
    ? rowSliderMax(base, item.quantity)
    : Math.max(10, Math.ceil(base * 2.5), Math.ceil(item.quantity));
  const id = `ingredient-${index}`;
  return (
    <Section>
      <div className="grid gap-3 p-4">
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
        <div className="grid grid-cols-[1fr_7rem] items-end gap-3">
          <Slider
            aria-label={`Menge ${item.name}`}
            min={grams ? 5 : 0.5}
            max={max}
            step={grams ? 5 : 0.5}
            value={[item.quantity]}
            onValueChange={([v]) => v !== undefined && set(v)}
            className="mb-4"
          />
          <NumberField
            id={id}
            label={grams ? 'Gramm' : `Anzahl · ${item.portionLabel ?? 'Portion'}`}
            unit={grams ? unit : '×'}
            value={item.quantity}
            onValueChange={set}
            integer={grams}
            error={invalid ? (grams ? `Mindestens 1 ${unit}.` : 'Mindestens 0,1.') : null}
          />
        </div>
      </div>
    </Section>
  );
}
