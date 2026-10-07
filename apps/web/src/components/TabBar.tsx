import { Link } from '@tanstack/react-router';
import { BarChart3, BookOpen, Menu, Plus, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { AddSheet } from './AddSheet';

const tabs = [
  { to: '/', label: 'Tagebuch', icon: BookOpen },
  { to: '/progress', label: 'Fortschritt', icon: TrendingUp },
  null,
  { to: '/reports', label: 'Berichte', icon: BarChart3 },
  { to: '/more', label: 'Mehr', icon: Menu },
] as const;

export function TabBar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav
        aria-label="Hauptnavigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 pb-[var(--safe-bottom)] backdrop-blur-md"
      >
        <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-xl grid-cols-5 items-stretch">
          {tabs.map((t, i) =>
            t === null ? (
              <li key="add" className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-label="Hinzufügen"
                  className="flex size-12 touch-manipulation items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-[transform,background-color] hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-95 motion-reduce:transition-none"
                >
                  <Plus className="size-6" aria-hidden />
                </button>
              </li>
            ) : (
              <li key={i}>
                <Link
                  to={t.to}
                  activeOptions={{ exact: t.to === '/', includeSearch: false }}
                  className="flex h-full touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none data-[status=active]:text-primary"
                >
                  <t.icon className="size-[22px]" aria-hidden />
                  {t.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
      <AddSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
