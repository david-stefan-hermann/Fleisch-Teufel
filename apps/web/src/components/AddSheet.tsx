import { today } from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Search, Scale } from 'lucide-react';
import type { ComponentType } from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { defaultMealForNow } from '@/lib/meals';
import { ScanCameraIcon } from './ScanCameraIcon';

export function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { date?: string };
  const date = search.date ?? today();
  const meal = defaultMealForNow();
  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  // Deliberately only three entries: quick add lives in the food search, training in the diary card.
  const items: { label: string; icon: ComponentType<{ className?: string }>; run: () => unknown }[] = [
    {
      label: 'Lebensmittel suchen',
      icon: Search,
      run: () => navigate({ to: '/add', search: { date, meal } }),
    },
    {
      // One entry for photo and barcode: a photographed barcode is recognized on the photo page.
      label: 'Foto / Scan',
      icon: ScanCameraIcon,
      run: () => navigate({ to: '/photo', search: { date, meal } }),
    },
    {
      label: 'Gewicht eintragen',
      icon: Scale,
      run: () => navigate({ to: '/progress', search: { log: true } }),
    },
  ];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* On wide screens a centered card instead of a full-width sheet with giant square tiles. */}
      <DrawerContent className="pb-[calc(var(--safe-bottom)+1rem)] sm:mx-auto sm:max-w-md sm:rounded-t-2xl sm:border-x">
        <DrawerHeader>
          <DrawerTitle>Hinzufügen</DrawerTitle>
          <DrawerDescription>Was möchtest du eintragen?</DrawerDescription>
        </DrawerHeader>
        <div className="grid grid-cols-3 gap-3 px-4">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => go(() => void it.run())}
              className="flex aspect-square touch-manipulation sm:aspect-auto sm:h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-secondary p-2 text-center text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <it.icon className="size-7 text-primary" />
              <span className="leading-tight text-balance">{it.label}</span>
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
