/**
 * The hint the assistant heard with "Ich hab Fotos" travels to the photo page in `sessionStorage`
 * (not in the URL: search params are short). It is good for ten minutes and for one preview.
 */
const HINT_KEY = 'ft.assistant.hint';
const VALID_MS = 10 * 60_000;

export function storeAssistantHint(hint: string): void {
  try {
    if (hint.trim()) sessionStorage.setItem(HINT_KEY, JSON.stringify({ hint: hint.trim(), at: Date.now() }));
    else sessionStorage.removeItem(HINT_KEY);
  } catch {
    // Private mode: the camera opens without the hint.
  }
}

export function readAssistantHint(): string {
  try {
    const v = JSON.parse(sessionStorage.getItem(HINT_KEY) ?? 'null') as {
      hint?: unknown;
      at?: unknown;
    } | null;
    if (v && typeof v.hint === 'string' && typeof v.at === 'number' && Date.now() - v.at < VALID_MS)
      return v.hint;
  } catch {
    // Unreadable: no hint.
  }
  return '';
}

export function clearAssistantHint(): void {
  try {
    sessionStorage.removeItem(HINT_KEY);
  } catch {
    // Nothing to clear.
  }
}
