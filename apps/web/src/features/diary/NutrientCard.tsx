import { get, MICRO_DEFAULTS, microStatus, N, type DaySummary } from '@ft/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Section } from '@/components/Page';
import { fmtGrams } from '@/lib/format';
import { cn } from '@/lib/utils';

const ROWS = [
  { key: N.fiber, label: 'Ballaststoffe' },
  { key: N.sugar, label: 'Zucker' },
  { key: N.satFat, label: 'Gesättigte Fettsäuren' },
  { key: N.salt, label: 'Salz' },
] as const;

/** Fibre, sugar, saturated fat and salt with DGE-based targets (feature #7). */
export function NutrientCard({ summary }: { summary: DaySummary }) {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Nährstoffe"
      action={
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex h-10 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {open ? 'Weniger' : 'Quellen'}
          <ChevronDown
            className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      }
    >
      <ul className="grid gap-3 px-4 pb-4">
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
              {open && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {target.custom ? 'Eigener Zielwert' : MICRO_DEFAULTS[key].source}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
