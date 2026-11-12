import { Footprints, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/button';
import type { UserDb } from '@/db/dexie';
import { runStepsShortcut, useStepsRunning } from '@/lib/steps';
import { cn } from '@/lib/utils';

/** Runs the shortcut (`runStepsShortcut`); when no import arrived in time, a toast says so. */
export async function fetchSteps(db: UserDb, sync: () => Promise<unknown>): Promise<void> {
  if ((await runStepsShortcut(db, sync)) === 'timeout') toast('Keine neuen Schritte empfangen');
}

/**
 * Starts the shortcut and shows that it waits until its import arrived and the app synced: ↻ spins (steps
 * page), the green footprints of the training card header pulse.
 */
export function StepsRefreshButton({
  icon = 'refresh',
  className,
}: {
  icon?: 'refresh' | 'footprints';
  className?: string;
}) {
  const { db, sync } = useSession();
  const running = useStepsRunning();
  const footprints = icon === 'footprints';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={running ? 'Schritte werden abgerufen' : 'Schritte abrufen'}
      disabled={running}
      className={cn(!footprints && 'text-muted-foreground', 'disabled:opacity-100', className)}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        void fetchSteps(db, () => sync.sync());
      }}
    >
      {footprints ? (
        <Footprints
          className={cn('size-5 text-steps', running && 'animate-pulse motion-reduce:animate-none')}
          aria-hidden
        />
      ) : (
        <RefreshCw
          className={cn('size-[1.125rem]', running && 'animate-spin motion-reduce:[animation-duration:3s]')}
          aria-hidden
        />
      )}
    </Button>
  );
}
