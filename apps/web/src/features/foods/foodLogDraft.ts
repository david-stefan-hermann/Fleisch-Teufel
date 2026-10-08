import type { Portion } from '@ft/shared';

/**
 * Unsaved form state of the food page (portion, amount, meal, extra days) while the pencil opens the
 * custom food editor. The page is mounted anew on return; the state only comes back for the same
 * history entry (`__TSR_key`), so a later visit of the same food starts fresh.
 */
export interface FoodLogDraft {
  portion: Portion;
  quantity: number | null;
  meal: number;
  extraDays: string[];
}

interface Stored extends FoodLogDraft {
  entryKey: string;
}

const storageKey = (pathname: string) => `ft:foodlog:${pathname}`;

export function stashFoodLogDraft(pathname: string, entryKey: string | undefined, draft: FoodLogDraft): void {
  if (!entryKey) return;
  try {
    sessionStorage.setItem(storageKey(pathname), JSON.stringify({ ...draft, entryKey } satisfies Stored));
  } catch {
    // Private mode etc.: the page simply starts with its defaults again.
  }
}

/** The stashed state for this page and history entry, or null. Does not remove it. */
export function peekFoodLogDraft(pathname: string, entryKey: string | undefined): FoodLogDraft | null {
  if (!entryKey) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(pathname));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    const valid =
      s.entryKey === entryKey &&
      typeof s.portion?.label === 'string' &&
      typeof s.portion.grams === 'number' &&
      (s.quantity === null || typeof s.quantity === 'number') &&
      typeof s.meal === 'number' &&
      Array.isArray(s.extraDays) &&
      s.extraDays.every((d) => typeof d === 'string');
    if (!valid) return null;
    return { portion: s.portion!, quantity: s.quantity!, meal: s.meal!, extraDays: s.extraDays! };
  } catch {
    return null;
  }
}

export function dropFoodLogDraft(pathname: string): void {
  try {
    sessionStorage.removeItem(storageKey(pathname));
  } catch {
    // ignore
  }
}
