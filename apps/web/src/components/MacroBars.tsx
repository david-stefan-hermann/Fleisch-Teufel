import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MacroValue {
  key: 'protein' | 'carbs' | 'fat';
  label: string;
  value: number;
  target: number;
}

export const MACRO_BG = { protein: 'bg-protein', carbs: 'bg-carbs', fat: 'bg-fat' } as const;

/** Above the target as displayed (whole numbers), so "55 / 55 g" is never marked as too much. */
export function isOverTarget(value: number, target: number): boolean {
  return target > 0 && Math.round(value) > Math.round(target);
}

/**
 * Progress towards a target. The fill is capped at 100 %; above the target a red bar from the
 * left shows the excess as a share of the target (76 g of 55 g: full bar, red 38 %). Once the red
 * bar is full (twice the target), a darker red step fills on top of it the same way (250 %: red full,
 * dark red 50 %; from 300 % both are full). No legend: the red grams next to it say the same.
 */
export function TargetBar({
  value,
  target,
  color,
  label,
  valueText,
  over = isOverTarget(value, target),
  className,
}: {
  value: number;
  target: number;
  /** Fill color (macro token class, e.g. `bg-protein`; `bg-foreground/40` for micros with a maximum). */
  color: string;
  /** Accessible name of the meter. */
  label: string;
  valueText?: string;
  /**
   * Whether the value counts as above the target. Defaults to the whole-number comparison of the
   * macros; micros pass their own status because they are shown with decimals (6,3 g of max. 6 g).
   */
  over?: boolean;
  className?: string;
}) {
  const fill = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const excess = over && target > 0 ? Math.min(100, ((value - target) / target) * 100) : 0;
  const excess2 = over && target > 0 ? Math.min(100, Math.max(0, ((value - 2 * target) / target) * 100)) : 0;
  return (
    <div
      className={cn('relative h-1.5 overflow-hidden rounded-full bg-muted', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(target)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={valueText}
    >
      <div data-part="fill" className={cn('h-full rounded-full', color)} style={{ width: `${fill}%` }} />
      {excess > 0 && (
        <div
          data-part="excess"
          className="absolute inset-y-0 left-0 rounded-full bg-over"
          style={{ width: `${excess}%` }}
        />
      )}
      {excess2 > 0 && (
        <div
          data-part="excess2"
          className="absolute inset-y-0 left-0 rounded-full bg-over-2"
          style={{ width: `${excess2}%` }}
        />
      )}
    </div>
  );
}

/** The three macro targets of the day (calorie overview, closed state). */
export function MacroBars({ macros, className }: { macros: MacroValue[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {macros.map((m) => {
        const over = isOverTarget(m.value, m.target);
        return (
          <div key={m.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-1 text-xs">
              <span className="truncate font-medium">{m.label}</span>
            </div>
            <TargetBar
              className="mt-1 h-2"
              value={m.value}
              target={m.target}
              color={MACRO_BG[m.key]}
              label={m.label}
              valueText={`${fmt0(m.value)} von ${fmt0(m.target)} g`}
            />
            <div className={cn('tabular mt-1 text-xs text-muted-foreground', over && 'text-over')}>
              <span className={cn('font-semibold', over ? 'text-over' : 'text-foreground')}>
                {fmt0(m.value)}
              </span>{' '}
              / {fmt0(m.target)}&nbsp;g
            </div>
          </div>
        );
      })}
    </div>
  );
}
