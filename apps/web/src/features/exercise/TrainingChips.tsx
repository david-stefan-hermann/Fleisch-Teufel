import { Bookmark, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A badge for a training suggestion or a saved training: name on top, duration and intensity below.
 * On the page "Training eintragen" it toggles a selection (`pressed`), under the diary's training
 * card a tap logs it. Looks like the chips of "Zuletzt hier" in the diary.
 */
export function TrainingChip({
  title,
  detail,
  saved,
  pressed,
  disabled,
  ariaLabel,
  onClick,
}: {
  title: string;
  detail: string;
  /** A saved training (bookmark icon) rather than one from the diary. */
  saved?: boolean;
  /** Toggle chips: whether the training is selected (shows a check). */
  pressed?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  const icon: ReactNode = pressed ? (
    <Check className="size-3.5 shrink-0 text-exercise" aria-hidden />
  ) : saved ? (
    <Bookmark className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
  ) : null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      {...(pressed !== undefined && { 'aria-pressed': pressed })}
      className={cn(
        'grid h-11 max-w-48 min-w-0 content-center rounded-xl border px-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
        pressed ? 'border-exercise/60 bg-exercise/15' : 'border-border bg-background hover:bg-accent',
      )}
    >
      <span className="flex items-center gap-1 truncate text-sm font-medium">
        {icon}
        <span className="truncate">{title}</span>
      </span>
      <span className="tabular truncate text-[11px] text-muted-foreground">{detail}</span>
    </button>
  );
}

/** A horizontal row of chips with a small caption. */
export function ChipRow({
  caption,
  label,
  children,
}: {
  caption: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">{caption}</p>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5" aria-label={label}>
        {children}
      </ul>
    </div>
  );
}
