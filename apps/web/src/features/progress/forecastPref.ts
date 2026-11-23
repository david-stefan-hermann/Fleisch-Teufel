import { useSyncExternalStore } from 'react';

/** Per device: whether "Prognose" under the weight chart is open. */
const KEY = 'ft.progress.forecasts';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let current = read();
const listeners = new Set<() => void>();

function set(on: boolean) {
  current = on;
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the switch holds for this session.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useForecastPref(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => current), set];
}
