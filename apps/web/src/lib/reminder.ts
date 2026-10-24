/**
 * The daily reminder on this device (Web Push): subscribe with the browser, tell the server the time
 * of day, and undo both. iOS allows push only for apps on the home screen; everywhere else the
 * notification permission is all it takes. State lives in the browser's subscription and on the
 * server (`GET /api/push/subscription`), nothing is stored here.
 */
import { api } from '@/lib/api';
import { isIos, isStandalone } from '@/app/pwa';

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface ReminderSettings {
  remindAt: string;
  tz: string;
}

export const DEFAULT_REMIND_AT = '20:00';

/** Why the reminder cannot be offered here, or null when it can. */
export type ReminderBlocker = 'unsupported' | 'ios_not_installed' | 'denied';

export function reminderBlocker(): ReminderBlocker | null {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios_not_installed';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

export const reminderApi = {
  config: () => api<PushConfig>('/api/push/config', { timeoutMs: 5000 }),
  settings: (endpoint: string) =>
    api<ReminderSettings>(`/api/push/subscription?endpoint=${encodeURIComponent(endpoint)}`, {
      timeoutMs: 5000,
    }),
  save: (sub: PushSubscriptionJSON, remindAt: string, tz: string) =>
    api<{ ok: true }>('/api/push/subscription', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys, remindAt, tz }),
    }),
  remove: (endpoint: string) =>
    api<{ ok: true }>('/api/push/subscription', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }),
};

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** The browser's current subscription of this device, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** The reminder as stored for this device (browser subscription plus server time), or null. */
export async function readReminder(): Promise<ReminderSettings | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  try {
    return await reminderApi.settings(sub.endpoint);
  } catch {
    return null;
  }
}

export class ReminderError extends Error {
  constructor(public readonly reason: 'permission' | 'no_worker' | 'server_disabled') {
    super(reason);
  }
}

/** Standard base64url to the bytes `pushManager.subscribe` wants. */
export function applicationServerKey(publicKey: string): Uint8Array {
  const padded = publicKey + '='.repeat((4 - (publicKey.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Turns the reminder on (or changes its time): asks for the notification permission once,
 * subscribes with the browser and stores time and zone on the server.
 */
export async function enableReminder(remindAt: string): Promise<ReminderSettings> {
  const config = await reminderApi.config();
  if (!config.enabled || !config.publicKey) throw new ReminderError('server_disabled');
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new ReminderError('permission');
  }
  const reg = await registration();
  if (!reg) throw new ReminderError('no_worker');
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(config.publicKey) as BufferSource,
    }));
  const tz = deviceTimeZone();
  await reminderApi.save(sub.toJSON(), remindAt, tz);
  return { remindAt, tz };
}

/** Turns the reminder off: server first, then the browser subscription. Never throws (used at sign-out). */
export async function disableReminder(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await reminderApi.remove(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
