import { RefreshCw } from 'lucide-react';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/button';
import { runStepsShortcut, useStepsRunning } from '@/lib/steps';
import { cn } from '@/lib/utils';

/** ↻: starts the shortcut and spins until its import arrived and the app synced (`runStepsShortcut`). */
export function StepsRefreshButton({ className }: { className?: string }) {
  const { db, sync } = useSession();
  const running = useStepsRunning();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={running ? 'Schritte werden abgerufen' : 'Schritte abrufen'}
      disabled={running}
      className={cn('text-muted-foreground disabled:opacity-100', className)}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        void runStepsShortcut(db, () => sync.sync());
      }}
    >
      <RefreshCw
        className={cn('size-[1.125rem]', running && 'animate-spin motion-reduce:[animation-duration:3s]')}
        aria-hidden
      />
    </Button>
  );
}
