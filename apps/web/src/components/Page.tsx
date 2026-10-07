import { useRouter } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PageProps {
  title: ReactNode;
  /** Show a back button (history back, or the given fallback path when there is no history). */
  back?: boolean | string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Pages inside the tab layout leave room for the tab bar. */
  withTabBar?: boolean;
  /** Content shown under the title inside the sticky header (e.g. tabs, search). */
  headerExtra?: ReactNode;
}

export function Page({
  title,
  back,
  actions,
  children,
  className,
  withTabBar = true,
  headerExtra,
}: PageProps) {
  const router = useRouter();
  const goBack = () => {
    if (window.history.length > 1) router.history.back();
    else void router.navigate({ to: typeof back === 'string' ? back : '/' });
  };
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-[var(--safe-top)] backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-1 px-2">
          {back ? (
            <Button variant="ghost" size="icon" onClick={goBack} aria-label="Zurück">
              <ChevronLeft className="size-6" aria-hidden />
            </Button>
          ) : (
            <span className="w-2" />
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
        {headerExtra && <div className="mx-auto w-full max-w-xl px-4 pb-3">{headerExtra}</div>}
      </header>
      <main
        id="main"
        className={cn(
          'mx-auto w-full max-w-xl flex-1 px-4 pt-4',
          withTabBar
            ? 'pb-[calc(var(--tabbar-h)+var(--safe-bottom)+1.5rem)]'
            : 'pb-[calc(var(--safe-bottom)+1.5rem)]',
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}

/** Card section with optional title row. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        // overflow-hidden: full-bleed rows (swipe actions, hover backgrounds) follow the rounded corners.
        'mb-4 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
        className,
      )}
    >
      {(title || action) && (
        <div className="flex min-h-12 items-center justify-between gap-2 px-4 pt-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-10">{icon}</div>}
      <p className="font-medium text-pretty">{title}</p>
      {children && <div className="text-sm text-muted-foreground text-pretty">{children}</div>}
    </div>
  );
}
