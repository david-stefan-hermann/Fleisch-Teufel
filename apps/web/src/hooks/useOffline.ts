import { useSyncExternalStore } from 'react';
import { useSyncState } from '@/components/SyncIndicator';

function subscribe(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/**
 * Whether the server looks unreachable: the device says it is offline, or the last sync could not
 * reach the server (WireGuard down while the device itself is online).
 */
export function useOffline(): boolean {
  const deviceOnline = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const sync = useSyncState();
  return !deviceOnline || sync.status === 'offline';
}
