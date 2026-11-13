import { useSyncExternalStore } from 'react';

/**
 * Appearance of this device (not synced: a phone and a desktop may want different themes).
 *
 * - App theme: system, light or dark. `public/theme-init.js` applies it before the first paint
 *   (class `dark`/`light` on `<html>`); this module keeps it up to date afterwards.
 * - Icon: follows the app theme ('auto') or is fixed light or dark. It decides the in-app logo,
 *   the favicon and the apple-touch-icon. iOS reads the latter once, when the app is added to the
 *   home screen; it cannot be swapped on an installed web app.
 * - Diary macros: the P/K/F line of each diary row as plain numbers (default) or with colored dots
 *   and a small energy split bar (`MacroSummary`). Nothing of it matters before the first paint.
 * - Assistant: whether the floating button shows (the add sheet always has it), how big it is, and
 *   which figure it wears ('standard', a built-in one or the id of an uploaded pack).
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type IconPref = 'auto' | 'light' | 'dark';
export type Mode = 'light' | 'dark';
export type DiaryMacrosPref = 'numbers' | 'bar';
export type AssistantSize = 'small' | 'medium' | 'large';

/** Scale of the assistant button per size (small is the 56 px button). */
export const ASSISTANT_SCALE: Record<AssistantSize, number> = { small: 1, medium: 1.5, large: 2 };

const THEME_KEY = 'ft.theme';
const ICON_KEY = 'ft.icon';
const DIARY_MACROS_KEY = 'ft.diaryMacros';
const ASSISTANT_BUTTON_KEY = 'ft.assistant.button';
const ASSISTANT_SKIN_KEY = 'ft.assistant.skin';
const ASSISTANT_SIZE_KEY = 'ft.assistant.size';
/** Status bar / browser chrome color per theme (`--background`). */
const THEME_COLOR: Record<Mode, string> = { light: '#faf8f6', dark: '#151312' };

export const ICON_FILES: Record<Mode, { logo: string; favicon: string; touch: string }> = {
  light: { logo: '/logo.svg', favicon: '/favicon.svg', touch: '/apple-touch-icon-180x180.png' },
  dark: { logo: '/logo-dark.svg', favicon: '/favicon-dark.svg', touch: '/apple-touch-icon-dark-180x180.png' },
};

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string, isDefault: boolean) {
  try {
    if (isDefault) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode etc.: the choice holds until the app is closed.
  }
}

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export interface Appearance {
  theme: ThemePref;
  icon: IconPref;
  /** The theme the app shows now. */
  mode: Mode;
  /** The logo variant shown now. */
  iconMode: Mode;
  /** How diary rows show their macros. */
  diaryMacros: DiaryMacrosPref;
  /** The assistant's floating button is shown (when the server offers the assistant). */
  assistantButton: boolean;
  /** The figure of the assistant button. */
  assistantSkin: string;
  /** Size of the assistant button. */
  assistantSize: AssistantSize;
}

export function resolveAppearance(
  theme: ThemePref,
  icon: IconPref,
  systemDark: boolean,
  diaryMacros: DiaryMacrosPref = 'numbers',
  assistant: { button: boolean; skin: string; size: AssistantSize } = {
    button: true,
    skin: 'standard',
    size: 'small',
  },
): Appearance {
  const mode: Mode = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  return {
    theme,
    icon,
    mode,
    iconMode: icon === 'auto' ? mode : icon,
    diaryMacros,
    assistantButton: assistant.button,
    assistantSkin: assistant.skin,
    assistantSize: assistant.size,
  };
}

let theme: ThemePref = 'system';
let icon: IconPref = 'auto';
let diaryMacros: DiaryMacrosPref = 'numbers';
let assistant: { button: boolean; skin: string; size: AssistantSize } = {
  button: true,
  skin: 'standard',
  size: 'small',
};
let current: Appearance = resolveAppearance('system', 'auto', false);
const listeners = new Set<() => void>();

function update() {
  current = resolveAppearance(theme, icon, media()?.matches ?? false, diaryMacros, assistant);
  apply(current);
  listeners.forEach((l) => l());
}

/** Writes the appearance into the document: theme class, browser colors, favicon, touch icon. */
function apply(a: Appearance) {
  const root = document.documentElement;
  root.classList.toggle('dark', a.mode === 'dark');
  root.classList.toggle('light', a.mode === 'light');
  root.style.colorScheme = a.mode;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute('media');
    meta.content = THEME_COLOR[a.mode];
  }
  const files = ICON_FILES[a.iconMode];
  document
    .querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
    ?.setAttribute('href', files.favicon);
  document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.setAttribute('href', files.touch);
}

/** Reads the saved choices, applies them and follows the system theme while it matters. */
export function startAppearance(): void {
  theme = read(THEME_KEY, ['system', 'light', 'dark'], 'system');
  icon = read(ICON_KEY, ['auto', 'light', 'dark'], 'auto');
  diaryMacros = read(DIARY_MACROS_KEY, ['numbers', 'bar'], 'numbers');
  assistant = {
    button: read(ASSISTANT_BUTTON_KEY, ['on', 'off'], 'on') === 'on',
    skin: readSkin(),
    size: read(ASSISTANT_SIZE_KEY, ['small', 'medium', 'large'], 'small'),
  };
  media()?.addEventListener('change', update);
  update();
}

export function setThemePref(next: ThemePref): void {
  theme = next;
  write(THEME_KEY, next, next === 'system');
  update();
}

export function setIconPref(next: IconPref): void {
  icon = next;
  write(ICON_KEY, next, next === 'auto');
  update();
}

export function setDiaryMacrosPref(next: DiaryMacrosPref): void {
  diaryMacros = next;
  write(DIARY_MACROS_KEY, next, next === 'numbers');
  update();
}

function readSkin(): string {
  try {
    const v = localStorage.getItem(ASSISTANT_SKIN_KEY);
    return v && /^[\w-]{1,64}$/.test(v) ? v : 'standard';
  } catch {
    return 'standard';
  }
}

export function setAssistantButton(on: boolean): void {
  assistant = { ...assistant, button: on };
  write(ASSISTANT_BUTTON_KEY, on ? 'on' : 'off', on);
  update();
}

export function setAssistantSkin(skin: string): void {
  assistant = { ...assistant, skin };
  write(ASSISTANT_SKIN_KEY, skin, skin === 'standard');
  update();
}

export function setAssistantSize(size: AssistantSize): void {
  assistant = { ...assistant, size };
  write(ASSISTANT_SIZE_KEY, size, size === 'small');
  update();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current);
}
