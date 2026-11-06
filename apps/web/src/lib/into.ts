import type { UseNavigateResult } from '@tanstack/react-router';

/**
 * Target of the food search when it is not the diary: a saved meal being edited, the ingredient
 * list of an AI photo analysis under review, or a diary group being edited (its day is the `date`
 * search param). Carried as `?into=meal:<id>` / `ai:<n>` / `group:<id>` through search → food page
 * (and barcode scan), so the normal search UI can be reused. The training search has its own
 * target: a saved training being edited (`?into=training:<id>` on `/exercise` and `/sport/$typeKey`).
 */
export type Into =
  | { kind: 'meal'; mealId: string }
  | { kind: 'ai'; localId: number }
  | { kind: 'group'; groupId: string }
  | { kind: 'training'; templateId: string };

const MEAL = /^meal:([A-Za-z0-9_-]{1,64})$/;
const AI = /^ai:(\d{1,9})$/;
const GROUP = /^group:([A-Za-z0-9_-]{1,64})$/;
const TRAINING = /^training:([A-Za-z0-9_-]{1,64})$/;

/** A target of the food search (everything but a saved training). */
export type FoodInto = Exclude<Into, { kind: 'training' }>;

/** The target of the food search in a search param, or null (a training target is no food target). */
export function parseFoodInto(v: unknown): FoodInto | null {
  const p = parseInto(v);
  return p && p.kind !== 'training' ? p : null;
}

export function parseInto(v: unknown): Into | null {
  if (typeof v !== 'string') return null;
  const m = MEAL.exec(v);
  if (m) return { kind: 'meal', mealId: m[1]! };
  const a = AI.exec(v);
  if (a) return { kind: 'ai', localId: Number(a[1]) };
  const g = GROUP.exec(v);
  if (g) return { kind: 'group', groupId: g[1]! };
  const t = TRAINING.exec(v);
  if (t) return { kind: 'training', templateId: t[1]! };
  return null;
}

export function formatInto(into: Into): string {
  switch (into.kind) {
    case 'meal':
      return `meal:${into.mealId}`;
    case 'ai':
      return `ai:${into.localId}`;
    case 'group':
      return `group:${into.groupId}`;
    case 'training':
      return `training:${into.templateId}`;
  }
}

/** Router validator helper of the food search: keeps only well-formed food targets. */
export const intoParam = (v: unknown): string | undefined => {
  const p = parseInto(v);
  return p && p.kind !== 'training' ? formatInto(p) : undefined;
};

/** Router validator helper of the training search: only a saved training. */
export const trainingIntoParam = (v: unknown): string | undefined => {
  const p = parseInto(v);
  return p?.kind === 'training' ? formatInto(p) : undefined;
};

/** The saved training a training search adds to, or null. */
export const trainingTarget = (v: unknown): string | null => {
  const p = parseInto(v);
  return p?.kind === 'training' ? p.templateId : null;
};

interface HistoryLike {
  location: { state: { __TSR_index?: number } };
  go: (delta: number) => void;
}

const START_KEY = 'ft.intoStart';

/** Remembers the screen that opened the search (meal editor / analysis), to return to it later. */
export function rememberIntoStart(history: HistoryLike): void {
  try {
    sessionStorage.setItem(START_KEY, String(history.location.state.__TSR_index ?? -1));
  } catch {
    // Private mode etc.: the fallback navigation is used instead.
  }
}

/**
 * Goes back to the screen that opened the search, dropping search/food pages from the history so
 * "back" from there does not lead into the search again. Falls back to `fallback` (e.g. after a reload).
 */
export function returnFromInto(history: HistoryLike, fallback: () => void): void {
  let start = -1;
  try {
    start = Number(sessionStorage.getItem(START_KEY) ?? -1);
    sessionStorage.removeItem(START_KEY);
  } catch {
    // ignore
  }
  const current = history.location.state.__TSR_index ?? -1;
  if (start >= 0 && current > start) history.go(start - current);
  else fallback();
}

/** Opens the screen of a target directly: the fallback of `returnFromInto` (e.g. after a reload). */
export function openTarget(
  navigate: UseNavigateResult<string>,
  target: Into,
  date: string,
  meal: number,
): void {
  if (target.kind === 'meal')
    void navigate({ to: '/meals/$mealId', params: { mealId: target.mealId }, replace: true });
  else if (target.kind === 'training')
    void navigate({ to: '/trainings/$templateId', params: { templateId: target.templateId }, replace: true });
  else if (target.kind === 'group')
    void navigate({
      to: '/diary-group/$groupId',
      params: { groupId: target.groupId },
      search: { date },
      replace: true,
    });
  else void navigate({ to: '/photo', search: { date, meal, review: target.localId }, replace: true });
}
