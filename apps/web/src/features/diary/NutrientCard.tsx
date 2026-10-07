import { get, MICRO_DEFAULTS, microStatus, N, type DaySummary } from '@ft/shared';
import { fmtGrams } from '@/lib/format';
import { cn } from '@/lib/utils';

const ROWS = [
  { key: N.fiber, label: 'Ballaststoffe' },
  { key: N.sugar, label: 'Zucker' },
  { key: N.satFat, label: 'Gesättigte Fettsäuren' },
  { key: N.salt, label: 'Salz' },
] as const;

/** Fibre, sugar, saturated fat and salt with DGE-based targets (feature #7), shown as details of the
 * calorie overview. `showSources` adds where each target comes from. */
export function NutrientList({ summary, showSources }: { summary: DaySummary; showSources: boolean }) {
  return (
    <ul className="grid gap-3">
      {ROWS.map(({ key, label }) => {
        const value = get(summary.food, key);
        const target = summary.targets.micros[key];
        const status = microStatus(value, target);
        const pct = target.grams > 0 ? Math.min(100, (value / target.grams) * 100) : 0;
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between text-sm">
              <span>{label}</span>
              <span className="tabular text-muted-foreground">
                <span className={cn('font-semibold text-foreground', status === 'high' && 'text-over')}>
                  {fmtGrams(value)}
                </span>{' '}
                {target.kind === 'min' ? 'von mind.' : 'von max.'} {fmtGrams(target.grams)}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn(
                  'h-full rounded-full',
                  status === 'high'
                    ? 'bg-over'
                    : status === 'ok' && target.kind === 'min'
                      ? 'bg-good'
                      : 'bg-foreground/40',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            {showSources && (
              <p className="mt-1 text-xs text-muted-foreground">
                {target.custom ? 'Eigener Zielwert' : MICRO_DEFAULTS[key].source}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
