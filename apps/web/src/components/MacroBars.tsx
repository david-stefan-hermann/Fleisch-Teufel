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
 * left shows the excess as a share of the target (76 g of 55 g: full bar, red 38 %). No legend:
 * the red grams next to it say the same.
 */
export function TargetBar({
  value,
  target,
  color,
  label,
  valueText,
  className,
}: {
  value: number;
  target: number;
  /** Fill color (macro token class, e.g. `bg-protein`). */
  color: string;
  /** Accessible name of the meter. */
  label: string;
  valueText?: string;
  className?: string;
}) {
  const fill = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const excess = isOverTarget(value, target) ? Math.min(100, ((value - target) / target) * 100) : 0;
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
