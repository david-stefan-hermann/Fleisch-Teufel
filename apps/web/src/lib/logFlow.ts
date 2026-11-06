import { today } from '@ft/shared';
import { useRouter } from '@tanstack/react-router';
import { setDiaryFocus, type DiaryFocus } from '@/features/diary/diaryScroll';
import type { IndexedHistory } from './history';

/**
 * A logging flow: from the diary through camera, search, food page or review until something is
 * logged. Back always means the page before, with one exception this module takes care of: after
 * logging, the finished forms are dropped from the history, so the diary is one step and "back"
 * from it never reopens a filled form (an invitation to log twice).
 */

const START_KEY = 'ft.logStart';

interface LogStart {
  /** `__TSR_index` of the page the flow started on. */
  index: number;
  path: string;
  /** The day that page showed. */
  date: string;
}

/** Remembers the page a logging flow starts on (the "+" of the diary, the add sheet). */
export function rememberLogStart(history: IndexedHistory, start: { path: string; date: string }): void {
  try {
    sessionStorage.setItem(
      START_KEY,
      JSON.stringify({ ...start, index: history.location.state.__TSR_index ?? -1 } satisfies LogStart),
    );
  } catch {
    // Private mode etc.: the fallback navigation is used instead.
  }
}

/** The diary is on the screen: whatever flow was remembered is over. */
export function clearLogStart(): void {
  try {
    sessionStorage.removeItem(START_KEY);
  } catch {
    // ignore
  }
}

function takeLogStart(): LogStart | null {
  try {
    const raw = sessionStorage.getItem(START_KEY);
    sessionStorage.removeItem(START_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<LogStart>) : null;
    return s && typeof s.index === 'number' && typeof s.path === 'string' && typeof s.date === 'string'
      ? (s as LogStart)
      : null;
  } catch {
    return null;
  }
}

/** The part of the router `returnToDiary` needs. */
export interface LogFlowRouter {
  history: IndexedHistory;
  subscribe: (
    event: 'onResolved',
    fn: (e: { toLocation: { pathname: string; search: unknown } }) => void,
  ) => () => void;
  navigate: (opts: { to: '/'; search: { date: string }; replace: true }) => Promise<unknown>;
}

/** How long the way back may take before the form is released anyway. */
const RETURN_MS = 2000;

/**
 * After logging: back to the diary of `date`, which then shows the new rows (`focus`). When the flow
 * started on that diary, the history goes back to it (search, forms and review are gone from it);
 * otherwise (started elsewhere, another day, after a reload) the diary replaces the form. Resolves
 * once the diary is reached, so the submitting button stays busy until then.
 */
export function returnToDiary(
  router: LogFlowRouter,
  { date, focus }: { date: string; focus?: Omit<DiaryFocus, 'date'> },
): Promise<void> {
  setDiaryFocus(focus ? { date, ...focus } : null);
  const start = takeLogStart();
  const current = router.history.location.state.__TSR_index ?? -1;
  const replace = () => router.navigate({ to: '/', search: { date }, replace: true }).then(() => {});
  if (!start || start.path !== '/' || start.date !== date || start.index < 0 || start.index >= current)
    return replace();
  return new Promise<void>((resolve) => {
    const done = () => {
      off();
      clearTimeout(timer);
    };
    const off = router.subscribe('onResolved', ({ toLocation }) => {
      done();
      // The entry is not the diary of that day after all (e.g. midnight passed on an undated URL).
      const shown = (toLocation.search as { date?: string } | undefined)?.date ?? today();
      if (toLocation.pathname === '/' && shown === date) resolve();
      else void replace().then(resolve);
    });
    const timer = setTimeout(() => {
      done();
      resolve();
    }, RETURN_MS);
    router.history.go(start.index - current);
  });
}

/** For the taps that start a logging flow: remembers the current page and the day it shows. */
export function useRememberLogStart(): (date: string) => void {
  const router = useRouter();
  return (date) => rememberLogStart(router.history, { path: router.state.location.pathname, date });
}

/** `returnToDiary` with the app's router. */
export function useReturnToDiary(): (opts: Parameters<typeof returnToDiary>[1]) => Promise<void> {
  const router = useRouter();
  return (opts) =>
    returnToDiary(
      {
        history: router.history,
        subscribe: (event, fn) => router.subscribe(event, fn),
        navigate: (o) => router.navigate(o),
      },
      opts,
    );
}
