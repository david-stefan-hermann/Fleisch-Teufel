/**
 * The hint the assistant heard with "Ich hab Fotos" travels to the photo page in `sessionStorage`
 * (not in the URL: search params are short), together with the entries the photos replace. It is
 * good for ten minutes and for one preview.
 */
const HINT_KEY = 'ft.assistant.hint';
const VALID_MS = 10 * 60_000;

export interface AssistantHint {
  hint: string;
  /** Entry ids deleted when the analysis of these photos is logged. */
  replaces: string[];
}

export function storeAssistantHint(hint: string, replaces: readonly string[] = []): void {
  try {
    if (hint.trim() || replaces.length)
      sessionStorage.setItem(HINT_KEY, JSON.stringify({ hint: hint.trim(), replaces, at: Date.now() }));
    else sessionStorage.removeItem(HINT_KEY);
  } catch {
    // Private mode: the camera opens without the hint.
  }
}

export function readAssistantHint(): AssistantHint {
  try {
    const v = JSON.parse(sessionStorage.getItem(HINT_KEY) ?? 'null') as {
      hint?: unknown;
      replaces?: unknown;
      at?: unknown;
    } | null;
    if (v && typeof v.hint === 'string' && typeof v.at === 'number' && Date.now() - v.at < VALID_MS)
      return {
        hint: v.hint,
        replaces: Array.isArray(v.replaces)
          ? v.replaces.filter((x): x is string => typeof x === 'string')
          : [],
      };
  } catch {
    // Unreadable: no hint.
  }
  return { hint: '', replaces: [] };
}

export function clearAssistantHint(): void {
  try {
    sessionStorage.removeItem(HINT_KEY);
  } catch {
    // Nothing to clear.
  }
}
