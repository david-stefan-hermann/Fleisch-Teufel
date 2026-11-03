import { energyBreakdown, get, MACRO_KEYS, N, type NutrientMap } from '@ft/shared';
import { MACRO_BG } from '@/components/MacroBars';
import type { DiaryMacrosPref } from '@/lib/appearance';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

const LETTER = { protein: 'P', carbs: 'K', fat: 'F' } as const;
const CODE = { protein: N.protein, carbs: N.carbs, fat: N.fat } as const;

/**
 * Right column of a diary row: kcal, below it protein, carbs and fat. `numbers` is the plain line
 * "P 47 · K 0 · F 3"; `bar` puts a dot in the macro color before each number (the text stays grey,
 * yellow text would be unreadable) and a small energy split bar under the line, exactly as wide as
 * the text. The bar is hidden from screen readers: the text says the same.
 */
export function MacroSummary({
  nutrients,
  variant,
  className,
}: {
  nutrients: NutrientMap;
  variant: DiaryMacrosPref;
  className?: string;
}) {
  const kcal = <div className="font-semibold">{fmt0(get(nutrients, N.kcal))}</div>;
  if (variant === 'numbers') {
    return (
      <div className={cn('tabular text-right', className)}>
        {kcal}
        <div className="text-[11px] text-muted-foreground">
          P {fmt0(get(nutrients, N.protein))} · K {fmt0(get(nutrients, N.carbs))} · F{' '}
          {fmt0(get(nutrients, N.fat))}
        </div>
      </div>
    );
  }
  const b = energyBreakdown(nutrients);
  return (
    <div className={cn('tabular text-right', className)}>
      {kcal}
      {/* Shrink-to-fit: the bar takes the width of the text line above it. */}
      <div className="inline-flex flex-col items-stretch">
        <div className="flex gap-1.5 text-[11px] whitespace-nowrap text-muted-foreground">
          {MACRO_KEYS.map((k) => (
            <span key={k} className="inline-flex items-center gap-0.5">
              <span className={cn('size-1.5 shrink-0 rounded-full', MACRO_BG[k])} aria-hidden />
              {LETTER[k]} {fmt0(get(nutrients, CODE[k]))}
            </span>
          ))}
        </div>
        <div
          data-part="split"
          aria-hidden
          className="mt-0.5 flex h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          {MACRO_KEYS.map((k) => (
            <div
              key={k}
              className={cn('h-full', MACRO_BG[k])}
              style={{ width: `${b.macros[k].share * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
