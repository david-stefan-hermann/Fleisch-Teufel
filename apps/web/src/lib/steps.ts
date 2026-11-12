/**
 * Steps from Apple Health: the personal access for the iOS shortcut, and the button that starts the
 * shortcut from the app (footprints in the training card header, ↻ on the steps pages). The server
 * keeps the access (`/api/steps/*`); this device remembers the last status it saw in `kv`
 * (`steps.status`), so the diary knows offline whether to offer the button and nothing jumps.
 * The token itself is shown once on the settings page and never stored.
 */
import { toISODate, type StepsStatus } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useSyncExternalStore } from 'react';
import { isIos } from '@/app/pwa';
import { useDb } from '@/app/session';
import type { UserDb } from '@/db/dexie';
import { api } from '@/lib/api';
import { fmtDayLong, fmtDayMonth, fmtRelativeDay, fmtTime } from '@/lib/format';

/** The shortcut's fixed name: the settings page tells to use it, ↻ starts it by it. */
export const STEPS_SHORTCUT_NAME = 'Fleisch-Teufel Schritte';
export const STEPS_SHORTCUT_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(STEPS_SHORTCUT_NAME)}`;
const STATUS_KEY = 'steps.status';
/** After ↻: ask the server this often, and at most this long after the app is visible again. */
const POLL_MS = 2000;
const WAIT_MS = 30_000;

export const stepsApi = {
  status: () => api<StepsStatus>('/api/steps/status'),
  createToken: () => api<{ token: string }>('/api/steps/token', { method: 'POST' }),
  deleteToken: () => api<{ ok: true }>('/api/steps/token', { method: 'DELETE' }),
};

/** Where the shortcut sends to. */
export const stepsImportUrl = () => `${window.location.origin}/api/steps/import`;

/** The status last seen on this device (undefined while loading, null when never asked). */
export function useStepsStatus(): StepsStatus | null | undefined {
  const db = useDb();
  return useLiveQuery(
    async () => ((await db.kv.get(STATUS_KEY))?.value as StepsStatus | undefined) ?? null,
    [db],
  );
}

/** Asks the server and remembers the answer; offline it keeps what it had. */
export async function refreshStepsStatus(db: UserDb): Promise<StepsStatus | null> {
  try {
    const s = await stepsApi.status();
    await db.kv.put({ key: STATUS_KEY, value: s });
    return s;
  } catch {
    return null;
  }
}

let refreshedThisRun = false;

/**
 * Whether ↻ belongs on this device: an iPhone (the shortcut runs there) with a configured access.
 * Asks the server once per app run, so an access made on another device shows up here too.
 */
export function useStepsRefreshAvailable(): boolean {
  const db = useDb();
  const status = useStepsStatus();
  const ios = isIos();
  useEffect(() => {
    if (!ios || refreshedThisRun) return;
    refreshedThisRun = true;
    void refreshStepsStatus(db);
  }, [db, ios]);
  return ios && !!status?.configured;
}

// ---------------------------------------------------------------- ↻ while it runs (one at a time)

let running = false;
const listeners = new Set<() => void>();
function setRunning(v: boolean) {
  running = v;
  for (const l of listeners) l();
}

/** Whether ↻ is waiting for the shortcut's import (spins everywhere it is shown). */
export function useStepsRunning(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => running,
  );
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * ↻: opens the shortcut, then, once the app is visible again, asks the server every 2 s (at most
 * 30 s) until the access was used after the tap, and syncs once. The time of the tap is taken in
 * server time (`clockOffset`), the server's `lastUsedAt` is server time too. Result: `received` (the
 * import arrived), `timeout` (nothing came within the wait) or `unavailable` (a run was already going).
 */
export type StepsShortcutResult = 'received' | 'timeout' | 'unavailable';

export async function runStepsShortcut(
  db: UserDb,
  sync: () => Promise<unknown>,
  open: (url: string) => void = (url) => {
    window.location.href = url;
  },
): Promise<StepsShortcutResult> {
  if (running) return 'unavailable';
  setRunning(true);
  const tappedAt = Date.now() + db.clockOffset;
  let deadline = Date.now() + WAIT_MS;
  const onVisible = () => {
    if (document.visibilityState === 'visible') deadline = Date.now() + WAIT_MS;
  };
  document.addEventListener('visibilitychange', onVisible);
  open(STEPS_SHORTCUT_URL);
  let received = false;
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      if (document.visibilityState !== 'visible') {
        deadline = Date.now() + WAIT_MS;
        continue;
      }
      const s = await stepsApi.status().catch(() => null);
      if (s) void db.kv.put({ key: STATUS_KEY, value: s }).catch(() => {});
      // A second of slack: the import may answer within the same second as the tap.
      if (s?.lastUsedAt && s.lastUsedAt >= tappedAt - 1000) {
        received = true;
        break;
      }
    }
    await sync().catch(() => {});
    return received ? 'received' : 'timeout';
  } finally {
    document.removeEventListener('visibilitychange', onVisible);
    setRunning(false);
  }
}

/** "heute, 14:02", "gestern, 22:00", else "3. November, 14:02" (for "Zuletzt empfangen"). */
export function fmtReceived(ms: number, todayDate: string): string {
  const day = toISODate(new Date(ms));
  const rel = fmtRelativeDay(day, todayDate);
  const near = rel !== fmtDayLong(day);
  return `${near ? rel.toLowerCase() : fmtDayMonth(day)}, ${fmtTime(ms)}`;
}
