import { useSyncExternalStore } from 'react';

/**
 * Appearance of this device (not synced: a phone and a desktop may want different themes).
 *
 * - App theme: system, light or dark. `public/theme-init.js` applies it before the first paint
 *   (class `dark`/`light` on `<html>`); this module keeps it up to date afterwards.
 * - Icon: follows the app theme ('auto') or is fixed light or dark. It decides the in-app logo,
 *   the favicon and the apple-touch-icon. iOS reads the latter once, when the app is added to the
 *   home screen; it cannot be swapped on an installed web app.
 */
export type ThemePref = 'system' | 'light' | 'dark';
export type IconPref = 'auto' | 'light' | 'dark';
export type Mode = 'light' | 'dark';

const THEME_KEY = 'ft.theme';
const ICON_KEY = 'ft.icon';
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
}

export function resolveAppearance(theme: ThemePref, icon: IconPref, systemDark: boolean): Appearance {
  const mode: Mode = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  return { theme, icon, mode, iconMode: icon === 'auto' ? mode : icon };
}

let theme: ThemePref = 'system';
let icon: IconPref = 'auto';
let current: Appearance = resolveAppearance('system', 'auto', false);
const listeners = new Set<() => void>();

function update() {
  current = resolveAppearance(theme, icon, media()?.matches ?? false);
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

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current);
}
