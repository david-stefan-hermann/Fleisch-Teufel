import { ChevronDown, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * One activity as a row that opens to its fields ("Training eintragen" of a saved training, the
 * editor of a saved training): the sport, below it duration · intensity · note, "+N" kcal, the arrow,
 * optionally an X to remove it. `changed` marks a row that differs from the saved values.
 */
export function TrainingRow({
  title,
  detail,
  kcal,
  open,
  onToggle,
  onRemove,
  removeDisabled,
  changed,
  children,
}: {
  title: string;
  detail: string;
  kcal: number;
  open: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
  changed?: boolean;
  /** The fields, shown while the row is open. */
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left focus-visible:bg-accent focus-visible:outline-none"
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{title}</span>
              {changed && (
                <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px] font-normal">
                  geändert
                </Badge>
              )}
            </div>
            <div className="truncate text-xs text-muted-foreground">{detail}</div>
          </div>
          <span className="tabular font-semibold text-exercise">+{fmt0(kcal)}</span>
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="mr-2"
            aria-label={`${title} entfernen`}
            disabled={removeDisabled}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      {open && <div className="grid gap-4 bg-muted/30 px-4 pt-1 pb-4">{children}</div>}
    </div>
  );
}
