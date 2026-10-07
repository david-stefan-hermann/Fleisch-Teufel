import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MacroValue {
  key: 'protein' | 'carbs' | 'fat';
  label: string;
  value: number;
  target: number;
}

const color = { protein: 'bg-protein', carbs: 'bg-carbs', fat: 'bg-fat' } as const;

export function MacroBars({ macros, className }: { macros: MacroValue[]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-3 gap-3', className)}>
      {macros.map((m) => {
        const pct = m.target > 0 ? Math.min(100, (m.value / m.target) * 100) : 0;
        const over = m.target > 0 && m.value > m.target * 1.05;
        return (
          <div key={m.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-1 text-xs">
              <span className="truncate font-medium">{m.label}</span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-label={m.label}
              aria-valuemin={0}
              aria-valuemax={m.target}
              aria-valuenow={Math.round(m.value)}
            >
              <div className={cn('h-full rounded-full', color[m.key])} style={{ width: `${pct}%` }} />
            </div>
            <div className={cn('tabular mt-1 text-xs text-muted-foreground', over && 'text-over')}>
              <span className="font-semibold text-foreground">{fmt0(m.value)}</span> / {fmt0(m.target)}&nbsp;g
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Thin stacked bar of the energy split (protein / carbs / fat). */
export function MacroSplitBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const p = protein * 4;
  const c = carbs * 4;
  const f = fat * 9;
  const total = p + c + f;
  if (total <= 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div className="bg-protein" style={{ width: `${(p / total) * 100}%` }} />
      <div className="bg-carbs" style={{ width: `${(c / total) * 100}%` }} />
      <div className="bg-fat" style={{ width: `${(f / total) * 100}%` }} />
    </div>
  );
}
