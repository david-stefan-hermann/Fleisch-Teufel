/**
 * PWA helpers: service-worker registration with an update prompt, persistent storage request,
 * platform checks and Chrome's install event for the install banner (Safari deletes
 * script-writable storage of sites that are not used for 7 days unless the site runs as a
 * home-screen app, so installing matters on the iPhone).
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

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** A computer: mouse or trackpad and a wide window (installing there is for the phone, via QR). */
export function isDesktop(): boolean {
  return (
    !isIos() &&
    !isAndroid() &&
    !!window.matchMedia?.('(pointer: fine)').matches &&
    !!window.matchMedia?.('(min-width: 768px)').matches
  );
}

/** Chrome's install event (not in the TS DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
let installed = false;
const installListeners = new Set<() => void>();
const notifyInstall = () => installListeners.forEach((l) => l());

/**
 * Keeps Chrome's `beforeinstallprompt` (Android, desktop) for the install banner instead of
 * Chrome's own mini bar, and notices a finished install. Call once at startup: the event fires
 * early, before any component mounts.
 */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installEvent = null;
    notifyInstall();
  });
}

/** Whether Chrome offers its install dialog right now, and whether the app was just installed. */
export function useInstallState(): { canPrompt: boolean; installed: boolean } {
  const [state, setState] = useState(() => ({ canPrompt: !!installEvent, installed }));
  useEffect(() => {
    const update = () => setState({ canPrompt: !!installEvent, installed });
    installListeners.add(update);
    return () => void installListeners.delete(update);
  }, []);
  return state;
}

/** Opens Chrome's install dialog. Resolves to whether the person installed; false without an event. */
export async function promptInstall(): Promise<boolean> {
  const e = installEvent;
  if (!e) return false;
  // The event can be used once; Chrome fires a new one if the dialog was dismissed.
  installEvent = null;
  notifyInstall();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}
