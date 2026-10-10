import type { Portion } from '@ft/shared';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Wheel } from '@/components/Wheel';
import {
  amountKind,
  convertAmount,
  isBasePortion,
  maxAmount,
  nearestIndex,
  wheelValues,
} from '@/lib/amounts';
import { fmt0, fmt2, fmtGrams } from '@/lib/format';
import { cn } from '@/lib/utils';

/** An amount: `quantity` pieces of `portion` (the base portion "1 g" / "1 ml" counts grams). */
export interface Amount {
  portion: Portion;
  /** null while the field is empty or invalid. */
  quantity: number | null;
}

/**
 * The one amount input of the app (food page, AI review, meal editor, diary group): a picker wheel
 * with the amount and, next to it, the unit, and below it a field for typing plus, for portions,
 * "= X g".
 *
 * The amount wheel runs on a raster (5 g / 5 ml up to 1.000, half portions up to 10). Wheel and
 * field always show the same amount: one that is off the raster (typed 137 g, a stored 1,25
 * portions) gets its own place on the wheel and keeps it while the wheel turns. Larger amounts are
 * typed. Turning the unit wheel keeps the grams.
 *
 * `onChange` reports the amount under the middle while the wheel turns (show it), `onCommit` the
 * final amount (save it): wheel stopped, typed, unit switched.
 */
export function AmountEditor({
  name,
  unit,
  portions,
  value,
  onChange,
  onCommit,
  onNewPortion,
  label = 'Menge',
  className,
}: {
  /** What is measured, for the wheel's label ("Menge Haferflocken"). */
  name: string;
  unit: 'g' | 'ml';
  /** Units to choose from (see `editorPortions`); with only one there is no unit wheel. */
  portions: readonly Portion[];
  value: Amount;
  onChange: (v: Amount) => void;
  onCommit: (v: Amount) => void;
  /** Offers "Eigene Portion" next to the label. */
  onNewPortion?: () => void;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const { portion, quantity } = value;
  const kind = amountKind(portion);
  const max = maxAmount(kind);
  const [error, setError] = useState<string | null>(null);
  const unitSymbol = kind === 'base' ? unit : '×';

  // The amount off the raster that has a place on the wheel. It follows every amount that does not
  // come from the wheel itself (typed, unit switched, changed from outside such as "Gesamtmenge"),
  // and stays while the wheel turns: removing its row mid-turn would shift all rows below it.
  const [extra, setExtra] = useState<number | null>(quantity);
  const [seen, setSeen] = useState({ quantity, label: portion.label });
  const [own, setOwn] = useState<number | null | undefined>(undefined);
  if (quantity !== seen.quantity || portion.label !== seen.label) {
    setSeen({ quantity, label: portion.label });
    if (quantity !== own || portion.label !== seen.label) setExtra(quantity);
  }
  const values = wheelValues(kind, extra);
  const amountText = (v: number) => (kind === 'base' ? fmt0(v) : fmt2(v));

  const fromWheel = (i: number, final: boolean) => {
    const q = values[i];
    if (q === undefined) return;
    setOwn(q);
    setError(null);
    (final ? onCommit : onChange)({ portion, quantity: q });
  };

  const unitText = (p: Portion) =>
    isBasePortion(p)
      ? unit === 'ml'
        ? 'Milliliter'
        : 'Gramm'
      : p.grams > 0 && !/\d\s*(g|ml)\b/i.test(p.label)
        ? `${p.label} (${fmtGrams(p.grams, unit)})`
        : p.label;
  const unitIndex = Math.max(
    0,
    portions.findIndex((p) => p.label === portion.label),
  );
  const switchUnit = (i: number) => {
    const next = portions[i];
    if (!next || next.label === portion.label) return;
    setError(null);
    onCommit({ portion: next, quantity: convertAmount(quantity, portion, next) });
  };

  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-2', className)}>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <Label htmlFor={`${id}-q`}>{label}</Label>
        {onNewPortion && (
          <Button type="button" variant="ghost" size="sm" className="-mr-2" onClick={onNewPortion}>
            <Plus aria-hidden />
            Eigene Portion
          </Button>
        )}
      </div>
      <div className="relative grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1">
        {/* The band that marks the choice of both wheels. */}
        <div className="pointer-events-none absolute inset-x-0 top-11 h-11 rounded-lg bg-muted" aria-hidden />
        <Wheel
          label={`Menge ${name}`}
          items={values.map(amountText)}
          index={nearestIndex(values, quantity)}
          valueNow={quantity ?? 0}
          onChange={(i) => fromWheel(i, false)}
          onSettle={(i) => fromWheel(i, true)}
          className="text-xl"
        />
        {portions.length > 1 ? (
          <Wheel
            label={`Einheit für ${name}`}
            items={portions.map(unitText)}
            index={unitIndex}
            onSettle={switchUnit}
            className="text-[1.0625rem]"
          />
        ) : (
          <div className="relative flex h-11 items-center justify-center self-center truncate px-2 text-[1.0625rem] font-medium">
            <span className="truncate">{unitText(portion)}</span>
          </div>
        )}
      </div>
      <div className="flex items-start gap-2">
        <NumberField
          id={`${id}-q`}
          className="min-w-0 flex-1"
          value={quantity}
          unit={unitSymbol}
          integer={kind === 'base'}
          onValueChange={(q) => {
            if (q === null || !(q > 0)) {
              setError('Bitte eine Menge größer 0 eingeben.');
              return onCommit({ portion, quantity: null });
            }
            if (q > max) {
              setError(`Höchstens ${fmt0(max)} ${kind === 'base' ? unit : 'Portionen'}.`);
              return;
            }
            setError(null);
            onCommit({ portion, quantity: Math.round(q * 100) / 100 });
          }}
          error={error}
        />
        {kind === 'portion' && portion.grams > 0 && (
          <output
            htmlFor={`${id}-q`}
            className="tabular flex h-11 min-w-[4.5rem] shrink-0 items-center justify-end text-sm whitespace-nowrap text-muted-foreground"
          >
            = {fmtGrams((quantity ?? 0) * portion.grams, unit)}
          </output>
        )}
      </div>
    </div>
  );
}
