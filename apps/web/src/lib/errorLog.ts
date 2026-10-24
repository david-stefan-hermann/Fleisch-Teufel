/**
 * A small error log on the device (localStorage, newest first, at most `MAX_ENTRIES`): unhandled
 * errors and rejections, plus anything a caller reports. Shown under "Daten & Sync", copyable, so a
 * failure on the phone can be read without a debugger.
 */
import { useSyncExternalStore } from 'react';

export interface LoggedError {
  at: number;
  message: string;
  /** Where it came from: `window`, `promise`, or a caller's label. */
  source: string;
  stack?: string;
}

const KEY = 'ft.errorLog';
const MAX_ENTRIES = 50;
const listeners = new Set<() => void>();
let cache: LoggedError[] | null = null;

function read(): LoggedError[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as LoggedError[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: LoggedError[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the in-memory copy still shows until the app closes.
  }
  for (const l of listeners) l();
}

function describe(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: `${e.name}: ${e.message}`, stack: e.stack?.slice(0, 2000) };
  return { message: String(e).slice(0, 500) };
}

export function recordError(e: unknown, source: string): void {
  const entry: LoggedError = { at: Date.now(), source, ...describe(e) };
  // The same message within a second is one problem, not fifty (a render loop, a retrying effect).
  const last = read()[0];
  if (last && last.message === entry.message && entry.at - last.at < 1000) return;
  write([entry, ...read()].slice(0, MAX_ENTRIES));
}

export function clearErrorLog(): void {
  write([]);
}

/** Plain text of the log for the clipboard (newest first). */
export function errorLogText(list: LoggedError[] = read()): string {
  return list
    .map((e) => `${new Date(e.at).toISOString()} [${e.source}] ${e.message}${e.stack ? `\n${e.stack}` : ''}`)
    .join('\n\n');
}

/** Wires the global listeners once at startup. */
export function installErrorLog(): void {
  window.addEventListener('error', (ev) => recordError(ev.error ?? ev.message, 'window'));
  window.addEventListener('unhandledrejection', (ev) => recordError(ev.reason, 'promise'));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useErrorLog(): LoggedError[] {
  return useSyncExternalStore(subscribe, read, () => []);
}
