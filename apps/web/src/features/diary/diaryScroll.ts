import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Where the diary stood and what it should show next. One place for the running app (not per day,
 * gone with a reload): leaving the diary to log something and coming back finds the old position,
 * and after logging the new row is on the screen.
 *
 * The router restores a scroll position too, but once, right after the page change, when the diary
 * still shows its skeletons (a short page: the position is cut off), and not at all for the new `/`
 * a logging flow ends on. So the diary sets its position itself once the day is on the screen.
 */

/** What a logging flow asks the diary to show: the new rows, else the meal they went into. */
export interface DiaryFocus {
  date: string;
  /** Ids of the new entries (or `pending:<localId>` for a waiting analysis), the first one found counts. */
  rows: readonly string[];
  /** The diary meal, when no row is found (yet). */
  meal?: number;
}

let position: { date: string; y: number } | null = null;
let focus: DiaryFocus | null = null;

/** The next time the diary shows `date`, it scrolls these rows into view (only if they are not). */
export function setDiaryFocus(next: DiaryFocus | null): void {
  focus = next;
}

/** For tests: forgets position and focus. */
export function resetDiaryScroll(): void {
  position = null;
  focus = null;
}

/** The remembered position of a day, if it is the day the diary was last scrolled on. */
export function diaryPosition(date: string): number | null {
  return position?.date === date ? position.y : null;
}

function remember(date: string): void {
  // Another page is already in the URL (the diary is about to go), or a sheet holds the page
  // still (`position: fixed` on the body reports 0): neither is a position of the diary.
  if (window.location.pathname !== '/' || document.body.style.position === 'fixed') return;
  position = { date, y: window.scrollY };
}

function takeFocus(date: string): DiaryFocus | null {
  const f = focus;
  focus = null;
  return f?.date === date ? f : null;
}

/** Sets the position; a page that is still growing (cards loading below) is asked again for a moment. */
function scrollToY(y: number, tries = 10): void {
  window.scrollTo(0, y);
  if (tries > 0 && window.scrollY < y - 1) requestAnimationFrame(() => scrollToY(y, tries - 1));
}

const attr = (value: string) => value.replace(/["\\]/g, '\\$&');

/** The element of a focus: the row of an entry, the group row it is part of, else its meal card. */
function focusElement(f: DiaryFocus): Element | null {
  for (const id of f.rows) {
    const el =
      document.querySelector(`[data-row="${attr(id)}"]`) ??
      document.querySelector(`[data-rows~="${attr(id)}"]`);
    if (el) return el;
  }
  return f.meal === undefined ? null : document.querySelector(`[data-meal="${f.meal}"]`);
}

/**
 * Scrolls so that the element is on the screen between the sticky header and the tab bar. Nothing
 * moves when it already is. An element higher than that space shows its upper edge.
 */
export function showInDiary(el: Element): void {
  const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
  const nav = document.querySelector('nav[aria-label="Hauptnavigation"]');
  const bottom = nav ? nav.getBoundingClientRect().top : window.innerHeight;
  const r = el.getBoundingClientRect();
  if (r.top >= top && r.bottom <= bottom) return;
  const by = r.height > bottom - top - 16 ? r.top - top - 8 : r.top + r.height / 2 - (top + bottom) / 2;
  window.scrollTo(0, Math.max(0, window.scrollY + by));
}

/**
 * Keeps the diary's scroll position for the shown day and, once the day is on the screen (`ready`:
 * no skeletons, everything that changes the height of the cards loaded), sets it again and shows
 * the rows a logging flow asked for. Once per mount and day.
 */
export function useDiaryScroll(date: string, ready: boolean): void {
  const applied = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ready || applied.current === date) return;
    applied.current = date;
    const y = diaryPosition(date);
    const f = takeFocus(date);
    const el = f && focusElement(f);
    if (el) {
      // One try only: the focus decides from where the page stands now.
      if (y !== null) window.scrollTo(0, y);
      showInDiary(el);
    } else if (y !== null) scrollToY(y);
  }, [date, ready]);
  useEffect(() => {
    if (!ready) return;
    const onScroll = () => remember(date);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [date, ready]);
}
