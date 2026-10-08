/** The part of the router history the helpers need (TanStack keeps the entry index in the state). */
export interface IndexedHistory {
  location: { state: { __TSR_index?: number } };
  go: (delta: number) => void;
}

/**
 * Goes `steps` entries back when this tab's history has them (the app opened them), else runs
 * `fallback` (e.g. after a reload or when the page was opened directly).
 */
export function goBackOr(history: IndexedHistory, steps: number, fallback: () => void): void {
  const index = history.location.state.__TSR_index ?? 0;
  if (index >= steps) history.go(-steps);
  else fallback();
}
