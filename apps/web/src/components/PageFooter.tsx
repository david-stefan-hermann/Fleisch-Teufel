import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sticky bottom bar for a page's primary action ("… eintragen", "Speichern"). Rendered by `Page`
 * (`footer` prop) after `<main>`, so it sits at the bottom of short pages too and sticks while
 * scrolling long ones. Pages with a footer have no tab bar.
 */
export function PageFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="sticky bottom-0 z-20 border-t border-border/70 bg-background/90 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)] backdrop-blur-md">
      <div className={cn('mx-auto grid w-full max-w-xl gap-2 px-4', className)}>{children}</div>
    </div>
  );
}
