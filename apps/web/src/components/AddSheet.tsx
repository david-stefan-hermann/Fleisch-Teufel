import { addDays, today as todayOf } from '@ft/shared';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Dumbbell, Scale } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useDb } from '@/app/session';
import { rememberLogStart } from '@/lib/logFlow';
import { logTargetFor } from '@/lib/meals';
import { cn } from '@/lib/utils';
import { warmUpCamera } from './cameraWarmup';
import { ScanFoodIcon } from './ScanFoodIcon';
import { useToday } from '@/hooks/data';

/**
 * Target of the sheet: day and meal for "Essen eintragen". Without a meal `logTargetFor` decides:
 * the meal of the last entry while it is younger than 20 minutes, else the meal of the hour.
 */
export interface AddSheetTarget {
  date?: string;
  meal?: number;
}

const AddSheetContext = createContext<{ open: (target?: AddSheetTarget) => void } | null>(null);

/** Opens the "Eintragen" sheet (tab bar "+"). */
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
  const router = useRouter();
  const search = useSearch({ strict: false }) as { date?: string };
  const todayNow = useToday();
  const db = useDb();
  // What was logged last (today, and yesterday for the minutes after midnight) and which photos
  // still wait in a meal: read while the sheet is open, used when a tile is tapped.
  const recent = useLiveQuery(
    async () =>
      open
        ? {
            entries: await db.foodEntries
              .where('date')
              .between(addDays(todayNow, -1), todayNow, true, true)
              .filter((e) => !e.deleted)
              .toArray(),
            pending: await db.aiQueue.filter((i) => !i.result).toArray(),
          }
        : null,
    [db, open, todayNow],
  );
  /** Day and meal of the tap (the clock is read then, not while rendering). */
  const targetNow = () => {
    const now = Date.now();
    const today = todayOf(new Date(now));
    const shownDate = target.date ?? search.date ?? today;
    if (target.meal !== undefined) return { date: shownDate, meal: target.meal };
    return logTargetFor({
      shownDate,
      today,
      now,
      entries: recent?.entries ?? [],
      pending: recent?.pending ?? [],
    });
  };
  /** Logging returns to the page the sheet was opened on, when that is the diary of the day. */
  const rememberStart = () =>
    rememberLogStart(router.history, {
      path: router.state.location.pathname,
      date: search.date ?? todayNow,
    });
  // Loads the code of the food page while the sheet is open, so the tap only waits for the camera.
  useEffect(() => {
    const photo = router.routesByPath['/photo'];
    if (open && photo) void router.loadRouteChunk(photo)?.catch(() => {});
  }, [open, router]);
  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  // Three entries, all "… eintragen": food (camera, barcode, and the search behind the magnifier) in
  // the middle and highlighted, where the thumb rests; weight on the left, training on the right.
  const items: {
    label: string;
    icon: ComponentType<{ className?: string }>;
    run: () => unknown;
    primary?: boolean;
  }[] = [
    {
      label: 'Gewicht eintragen',
      icon: Scale,
      run: () => navigate({ to: '/progress', search: { log: true } }),
    },
    {
      label: 'Essen eintragen',
      icon: ScanFoodIcon,
      run: () => {
        // The camera starts while the sheet closes and the page changes.
        warmUpCamera();
        rememberStart();
        return navigate({ to: '/photo', search: targetNow() });
      },
      primary: true,
    },
    {
      label: 'Training eintragen',
      icon: Dumbbell,
      run: () => {
        rememberStart();
        // Only the day: a training right after the late snack belongs to the same evening.
        return navigate({ to: '/exercise', search: { date: targetNow().date } });
      },
    },
  ];
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      {/* On wide screens a centered card instead of a full-width sheet with giant square tiles. */}
      <DrawerContent className="pb-[calc(var(--safe-bottom)+1rem)] sm:mx-auto sm:max-w-md sm:rounded-t-2xl sm:border-x">
        <DrawerHeader>
          <DrawerTitle>Eintragen</DrawerTitle>
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
