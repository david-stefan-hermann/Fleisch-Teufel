import { Cloud, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/button';
import type { SyncState } from '@/sync/syncEngine';
import { fmtAgo } from '@/lib/format';

export function useSyncState(): SyncState {
  const { sync } = useSession();
  const subscribe = useCallback((l: () => void) => sync.subscribe(l), [sync]);
  return useSyncExternalStore(subscribe, () => sync.getState());
}

export function syncLabel(s: SyncState): string {
  switch (s.status) {
    case 'syncing':
      return 'Synchronisiere…';
    case 'offline':
      return s.pending ? `Offline: ${s.pending} Änderung(en) warten` : 'Offline. Daten sind auf dem Gerät';
    case 'error':
      return s.error ?? 'Sync-Fehler';
    case 'unauthorized':
      return 'Bitte neu anmelden, um zu synchronisieren';
    default:
      if (s.needsUpdate) return 'App-Update nötig: neuere Daten konnten nicht geladen werden';
      return s.lastSyncAt ? `Synchronisiert ${fmtAgo(s.lastSyncAt)}` : 'Noch nicht synchronisiert';
  }
}

/** How long a tap on the cloud shows the loading animation at least. */
export const MIN_SPIN_MS = 1000;

/**
 * The cloud in a page header: the sync state as an icon, a tap syncs now. A tap always shows the
 * loading animation for at least `MIN_SPIN_MS`, so it visibly did something even when the sync
 * takes no time or the device is offline (then only the animation, no message). Syncs the app
 * starts by itself show the animation only while they run.
 */
export function SyncIndicator() {
  const { sync } = useSession();
  const s = useSyncState();
  const [tapped, setTapped] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const syncNow = () => {
    if (tapped) return;
    setTapped(true);
    void Promise.allSettled([sync.sync(), new Promise((done) => setTimeout(done, MIN_SPIN_MS))]).then(() => {
      if (mounted.current) setTapped(false);
    });
  };
  const spinning = tapped || s.status === 'syncing';
  const label = spinning ? 'Synchronisiere…' : syncLabel(s);
  const Icon = spinning
    ? LoaderCircle
    : s.status === 'offline'
      ? CloudOff
      : s.status === 'idle'
        ? s.pending
          ? RefreshCw
          : Cloud
        : TriangleAlert;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={syncNow}
      className={
        !spinning && (s.status === 'error' || s.status === 'unauthorized')
          ? 'text-warn-text'
          : 'text-muted-foreground'
      }
    >
      <Icon className={`size-6 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
    </Button>
  );
}
