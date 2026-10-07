import { Cloud, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/button';
import type { SyncState } from '@/sync/syncEngine';
import { fmtAgo } from '@/lib/format';

export function useSyncState(): SyncState {
  const { sync } = useSession();
  const [s, setS] = useState(sync.getState());
  useEffect(() => sync.subscribe(setS), [sync]);
  return s;
}

export function syncLabel(s: SyncState): string {
  switch (s.status) {
    case 'syncing':
      return 'Synchronisiere…';
    case 'offline':
      return s.pending ? `Offline – ${s.pending} Änderung(en) warten` : 'Offline – Daten sind auf dem Gerät';
    case 'error':
      return s.error ?? 'Sync-Fehler';
    case 'unauthorized':
      return 'Bitte neu anmelden, um zu synchronisieren';
    default:
      return s.lastSyncAt ? `Synchronisiert ${fmtAgo(s.lastSyncAt)}` : 'Noch nicht synchronisiert';
  }
}

export function SyncIndicator() {
  const { sync } = useSession();
  const s = useSyncState();
  const Icon =
    s.status === 'syncing'
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
      aria-label={syncLabel(s)}
      title={syncLabel(s)}
      onClick={() => void sync.sync().catch(() => {})}
      className={s.status === 'error' || s.status === 'unauthorized' ? 'text-warn' : 'text-muted-foreground'}
    >
      <Icon
        className={`size-5 ${s.status === 'syncing' ? 'animate-spin motion-reduce:animate-none' : ''}`}
        aria-hidden
      />
    </Button>
  );
}
