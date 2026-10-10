import type { Portion } from '@ft/shared';
import { Minus, Plus } from 'lucide-react';
import { useId, useRef, useState, type PointerEvent } from 'react';
import { NumberField } from '@/components/NumberField';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useSliderStart } from '@/hooks/useSliderStart';
import {
  amountKind,
  amountStep,
  clampAmount,
  convertAmount,
  isBasePortion,
  maxAmount,
  roundAmount,
  sliderRange,
} from '@/lib/amounts';
import { fmt0, fmt1, fmtGrams } from '@/lib/format';
import { cn } from '@/lib/utils';

/** An amount: `quantity` pieces of `portion` (the base portion "1 g" / "1 ml" counts grams). */
export interface Amount {
  portion: Portion;
  /** null while the field is empty or invalid. */
  quantity: number | null;
}

const NEW_PORTION = '__new';
const HOLD_DELAY = 400;
const HOLD_EVERY = 75;

/**
 * The one amount input of the app (food page, AI review, meal editor, diary group): unit choice,
 * slider, −/+ around the field and, for portions, "= X g".
 *
 * The slider starts exactly in the middle: its end is 2 × the start amount (the amount when the
 * editor opened, after a unit switch or after leaving the field), never the value being dragged.
 * Raster 1 g / 1 ml, tenths for portions; −/+ move one step and repeat while held. A typed amount
 * beyond the end pins the thumb (filled) to the end until the field is left.
 *
 * `onChange` reports every slider tick and −/+ repeat (show it), `onCommit` the final amount (save
 * it): slider let go, −/+ released, typed, unit switched.
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
  /** What is measured, for the slider's label ("Menge Haferflocken"). */
  name: string;
  unit: 'g' | 'ml';
  /** Units to choose from (see `editorPortions`); with only one the choice is plain text. */
  portions: readonly Portion[];
  value: Amount;
  onChange: (v: Amount) => void;
  onCommit: (v: Amount) => void;
  /** Offers "+ Eigene Portion anlegen…" at the end of the units. */
  onNewPortion?: () => void;
  label?: string;
  className?: string;
}) {
  const id = useId();
  const { portion, quantity } = value;
  const kind = amountKind(portion);
  const step = amountStep(kind);
  const max = maxAmount(kind);
  const slider = useSliderStart(quantity);
  const range = sliderRange(slider.start, kind);
  const [error, setError] = useState<string | null>(null);
  const pinned = quantity !== null && quantity > range.max;
  const unitSymbol = kind === 'base' ? unit : '×';
  const tick = (v: number) => (kind === 'base' ? `${fmt0(v)} ${unit}` : `${fmt1(v)} ×`);

  const emit = (q: number, final: boolean) => {
    slider.own(q);
    setError(null);
    (final ? onCommit : onChange)({ portion, quantity: q });
  };

  // −/+ with repeat while held. The running value lives in the ref: the interval outlives renders.
  const hold = useRef<{ value: number; timer: ReturnType<typeof setTimeout> | undefined } | null>(null);
  const stepBy = (dir: 1 | -1) => {
    const h = hold.current;
    if (!h) return;
    h.value = clampAmount(h.value + dir * step, kind);
    emit(h.value, false);
  };
  const startHold = (dir: 1 | -1, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    hold.current = { value: quantity ?? 0, timer: undefined };
    stepBy(dir);
    const repeat = () => {
      stepBy(dir);
      if (hold.current) hold.current.timer = setTimeout(repeat, HOLD_EVERY);
    };
    hold.current.timer = setTimeout(repeat, HOLD_DELAY);
  };
  const endHold = () => {
    const h = hold.current;
    if (!h) return;
    clearTimeout(h.timer);
    hold.current = null;
    emit(h.value, true);
    // Beyond the end: the new amount becomes the middle.
    if (h.value > range.max) slider.recenter(h.value);
  };
  const stepButton = (dir: 1 | -1) => (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      className="touch-manipulation select-none"
      aria-label={dir === 1 ? 'Mehr' : 'Weniger'}
      onPointerDown={(e) => startHold(dir, e)}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onLostPointerCapture={endHold}
      onContextMenu={(e) => e.preventDefault()}
      // Keyboard (Enter/Space) clicks without a pointer: one step, saved right away.
      onClick={(e) => {
        if (e.detail !== 0) return;
        const q = clampAmount((quantity ?? 0) + dir * step, kind);
        emit(q, true);
        if (q > range.max) slider.recenter(q);
      }}
    >
      {dir === 1 ? <Plus aria-hidden /> : <Minus aria-hidden />}
    </Button>
  );

  const unitText = (p: Portion) =>
    isBasePortion(p)
      ? unit === 'ml'
        ? 'Milliliter'
        : 'Gramm'
      : p.grams > 0 && !/\d\s*(g|ml)\b/i.test(p.label)
        ? `${p.label} (${fmtGrams(p.grams, unit)})`
        : p.label;

  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-q`}>{label}</Label>
        {portions.length > 1 || onNewPortion ? (
          <Select
            value={portion.label}
            onValueChange={(v) => {
              if (v === NEW_PORTION) return onNewPortion?.();
              const next = portions.find((p) => p.label === v);
              if (!next || next.label === portion.label) return;
              const q = convertAmount(quantity, portion, next);
              setError(null);
              slider.own(q);
              slider.recenter(q);
              onCommit({ portion: next, quantity: q });
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-9 max-w-[62%] min-w-0 text-sm"
              aria-label={`Einheit für ${name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {portions.map((p) => (
                <SelectItem key={p.label} value={p.label}>
                  {unitText(p)}
                </SelectItem>
              ))}
              {onNewPortion && <SelectItem value={NEW_PORTION}>+ Eigene Portion anlegen…</SelectItem>}
            </SelectContent>
          </Select>
        ) : (
          <span className="truncate text-sm text-muted-foreground">{unitText(portion)}</span>
        )}
      </div>
      <div className="relative pt-1.5 pb-5">
        <Slider
          aria-label={`Menge ${name}`}
          aria-valuetext={quantity === null ? undefined : `${tick(quantity)}`}
          min={range.min}
          max={range.max}
          step={range.step}
          value={[Math.min(quantity ?? 0, range.max)]}
          thumbClassName={cn('size-5', pinned && 'bg-primary')}
          className="h-6"
          onPointerDown={slider.startDrag}
          onValueChange={([v]) => v !== undefined && emit(clampAmount(v, kind), false)}
          onValueCommit={([v]) => {
            slider.endDrag();
            if (v !== undefined) emit(clampAmount(v, kind), true);
          }}
        />
        {/* Scale: 0, the start amount in the middle, the end. */}
        <div
          className="tabular pointer-events-none absolute inset-x-0 bottom-0 h-4 text-[0.6875rem] text-muted-foreground"
          aria-hidden
        >
          <span className="absolute left-0">0</span>
          <span className="absolute left-1/2 -translate-x-1/2">{tick(roundAmount(range.max / 2, kind))}</span>
          <span className="absolute right-0">{tick(range.max)}</span>
        </div>
      </div>
      <div className="flex items-start gap-2">
        {stepButton(-1)}
        <NumberField
          id={`${id}-q`}
          className="min-w-0 flex-1"
          value={quantity}
          unit={unitSymbol}
          integer={kind === 'base'}
          onValueChange={(q) => {
            if (q === null || !(q > 0)) {
              setError('Bitte eine Menge größer 0 eingeben.');
              slider.own(null);
              return onCommit({ portion, quantity: null });
            }
            if (q > max) {
              setError(`Höchstens ${fmt0(max)} ${kind === 'base' ? unit : 'Portionen'}.`);
              return;
            }
            // Typed amounts may be finer than the raster (1,25 portions); only −/+ and slider snap.
            emit(Math.round(q * 100) / 100, true);
          }}
          onBlur={() => {
            if (!error) slider.recenter(quantity);
          }}
          error={error}
        />
        {stepButton(1)}
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
