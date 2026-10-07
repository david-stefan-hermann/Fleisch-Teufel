import { today } from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Search, Scale } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useSettings } from '@/hooks/data';
import { defaultMealForNow } from '@/lib/meals';
import { cn } from '@/lib/utils';
import { ScanCameraIcon } from './ScanCameraIcon';

/** Target of the sheet: a meal card passes its day and meal, the tab bar passes nothing. */
export interface AddSheetTarget {
  date?: string;
  meal?: number;
}

const AddSheetContext = createContext<{ open: (target?: AddSheetTarget) => void } | null>(null);

/** Opens the "Hinzufügen" sheet (tab bar "+", meal card "+"). */
export function useAddSheet() {
  const ctx = useContext(AddSheetContext);
  if (!ctx) throw new Error('useAddSheet outside AddSheetProvider');
  return ctx;
}

/** Holds the one add sheet of the signed-in area, so every "+" opens the same menu. */
export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; target: AddSheetTarget }>({ open: false, target: {} });
  const open = useCallback((target: AddSheetTarget = {}) => setState({ open: true, target }), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <AddSheetContext.Provider value={value}>
      {children}
      <AddSheet
        open={state.open}
        onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}
        target={state.target}
      />
    </AddSheetContext.Provider>
  );
}

function AddSheet({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: AddSheetTarget;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const search = useSearch({ strict: false }) as { date?: string };
  const date = target.date ?? search.date ?? today();
  const meal = target.meal ?? defaultMealForNow();
  const mealName = target.meal !== undefined ? settings?.mealNames[target.meal] : undefined;
  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  // Deliberately only three entries: quick add lives in the food search, training in the diary card.
  const items: {
    label: string;
    icon: ComponentType<{ className?: string }>;
    run: () => unknown;
    primary?: boolean;
  }[] = [
    {
      label: 'Lebensmittel suchen',
      icon: Search,
      run: () => navigate({ to: '/add', search: { date, meal } }),
    },
    {
      // One entry for photo and barcode: a photographed barcode is recognized on the photo page.
      // Highlighted: the most used way to log.
      label: 'Foto / Scan',
      icon: ScanCameraIcon,
      run: () => navigate({ to: '/photo', search: { date, meal } }),
      primary: true,
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
          <DrawerTitle>{mealName ? `Zu ${mealName} hinzufügen` : 'Hinzufügen'}</DrawerTitle>
          <DrawerDescription>Was möchtest du eintragen?</DrawerDescription>
        </DrawerHeader>
        <div className="grid grid-cols-3 gap-3 px-4">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => go(() => void it.run())}
              className={cn(
                'flex aspect-square touch-manipulation flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:aspect-auto sm:h-24',
                it.primary
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/90 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                  : 'bg-secondary hover:bg-accent',
              )}
            >
              <it.icon className={cn('size-7', it.primary ? 'text-primary-foreground' : 'text-primary')} />
              <span className="leading-tight text-balance">{it.label}</span>
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
