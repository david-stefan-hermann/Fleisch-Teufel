/**
 * PWA helpers: service-worker registration with an update prompt, persistent storage request
 * and the iOS "Add to Home Screen" hint (Safari deletes script-writable storage of sites that are
 * not used for 7 days unless the site runs as a home-screen app).
 */
import { useEffect, useState } from 'react';
import { Workbox } from 'workbox-window';

let wb: Workbox | null = null;
let updateReady = false;
const listeners = new Set<(ready: boolean) => void>();

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  wb = new Workbox('/sw.js', { scope: '/' });
  wb.addEventListener('waiting', () => {
    updateReady = true;
    for (const l of listeners) l(true);
  });
  void wb.register();
  // Check for updates when the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void wb?.update();
  });
}

export function applyUpdate(): void {
  if (!wb) return;
  wb.addEventListener('controlling', () => window.location.reload());
  wb.messageSkipWaiting();
}

export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(updateReady);
  useEffect(() => {
    listeners.add(setReady);
    return () => void listeners.delete(setReady);
  }, []);
  return ready;
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
