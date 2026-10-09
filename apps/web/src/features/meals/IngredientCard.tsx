import { get, N, rescaleItem, type MealItem, type ResolvedTargets } from '@ft/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { NutrientsDisclosure } from '@/components/NutrientsDisclosure';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useSliderStart } from '@/hooks/useSliderStart';
import { clampAmount, MAX_AMOUNT, sliderRange } from '@/lib/amounts';
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

/**
 * One ingredient of the meal editor, laid out like an ingredient of the AI review: name, kcal and
 * remove in the head, then a slider with a number field. Gram ingredients move in 1 g steps, piece
 * ingredients ("Anzahl · Stück") in tenths; the slider starts in the middle. "Nährwerte" at the
 * bottom opens the overview of the current amount (it follows slider and field).
 */
export function IngredientCard({
  item,
  index,
  removable,
  targets,
  onChange,
  onCommit,
  onRemove,
}: {
  item: MealItem;
  index: number;
  removable: boolean;
  targets: ResolvedTargets;
  /** Live change while the slider is dragged (show it, do not save it yet). */
  onChange: (item: MealItem) => void;
  /** Final change: drag ended, a typed amount. Save it. */
  onCommit: (item: MealItem) => void;
  onRemove: () => void;
}) {
  const grams = isGramItem(item);
  const unit = item.portionLabel?.endsWith('ml') ? 'ml' : 'g';
  const min = minQuantity(item);
  // A typed amount below the minimum (or empty) is not applied; the field says why.
  const [invalid, setInvalid] = useState(false);
  const kind = grams ? 'base' : 'portion';
  const max = MAX_AMOUNT[kind];
  // The range comes from the start amount (middle), never from the value being dragged.
  const slider = useSliderStart(item.quantity);
  const range = sliderRange(slider.start, kind);
  const set = (q: number | null) => {
    const ok = q !== null && q >= min && q <= max;
    setInvalid(!ok);
    if (ok) {
      const next = Math.round(q * 100) / 100;
      slider.own(next);
      onCommit(rescaleItem(item, next));
    }
  };
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
            min={range.min}
            max={range.max}
            step={range.step}
            value={[Math.min(item.quantity, range.max)]}
            onPointerDown={slider.startDrag}
            onValueChange={([v]) => {
              if (v === undefined) return;
              const q = clampAmount(v, kind);
              slider.own(q);
              setInvalid(false);
              onChange(rescaleItem(item, q));
            }}
            onValueCommit={([v]) => {
              slider.endDrag();
              if (v !== undefined) onCommit(rescaleItem(item, clampAmount(v, kind)));
            }}
            className="mb-4"
          />
          <NumberField
            id={id}
            label={grams ? 'Gramm' : `Anzahl · ${item.portionLabel ?? 'Portion'}`}
            unit={grams ? unit : '×'}
            value={item.quantity}
            onValueChange={set}
            onBlur={() => slider.recenter(item.quantity)}
            integer={grams}
            error={
              invalid
                ? grams
                  ? `Zwischen 1 und ${fmt0(max)} ${unit}.`
                  : `Zwischen 0,1 und ${fmt0(max)}.`
                : null
            }
          />
        </div>
        <NutrientsDisclosure title={entryAmountLabel(item)} nutrients={item.nutrients} targets={targets} />
      </div>
    </Section>
  );
}
