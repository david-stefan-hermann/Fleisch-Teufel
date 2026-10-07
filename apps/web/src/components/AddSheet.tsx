import { today } from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Camera, Dumbbell, Flame, ScanBarcode, Search, Scale } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { defaultMealForNow } from '@/lib/meals';

export function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { date?: string };
  const date = search.date ?? today();
  const meal = defaultMealForNow();
  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const items = [
    {
      label: 'Lebensmittel suchen',
      icon: Search,
      run: () => navigate({ to: '/add', search: { date, meal } }),
    },
    {
      label: 'Barcode scannen',
      icon: ScanBarcode,
      run: () => navigate({ to: '/scan', search: { date, meal } }),
    },
    {
      label: 'Foto analysieren',
      icon: Camera,
      run: () => navigate({ to: '/photo', search: { date, meal } }),
    },
    {
      label: 'Schnell hinzufügen',
      icon: Flame,
      run: () => navigate({ to: '/quick-add', search: { date, meal } }),
    },
    {
      label: 'Gewicht eintragen',
      icon: Scale,
      run: () => navigate({ to: '/progress', search: { log: true } }),
    },
    {
      label: 'Training eintragen',
      icon: Dumbbell,
      run: () => navigate({ to: '/exercise', search: { date } }),
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
              <it.icon className="size-7 text-primary" aria-hidden />
              <span className="leading-tight text-balance">{it.label}</span>
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
