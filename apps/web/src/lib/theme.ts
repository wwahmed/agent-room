// T-43 theme system. The palette lives in CSS custom properties (see index.css):
// dark is the :root default, light is a [data-theme='light'] override. This
// module owns the *decision* (which theme) and the persistence; the actual
// colors are pure CSS so components never branch on theme.
//
// Split on purpose: resolveTheme/nextTheme/themeColor are pure and unit-tested
// under node; storedTheme/currentTheme/applyTheme/setTheme touch the DOM and
// localStorage and are guarded so they're inert (never throw) off the browser.

export type Theme = 'light' | 'dark';

/** T-26/T-27 ruling: theme is an explicit three-way CHOICE. 'system' follows
 *  the device live (the default for new users); 'light'/'dark' are persisted
 *  overrides. The resolved Theme stays two-valued — CSS knows only the pair. */
export type ThemeSetting = 'system' | Theme;

export const THEME_STORAGE_KEY = 'wakichat:theme';

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

export function isThemeSetting(v: unknown): v is ThemeSetting {
  return v === 'system' || isTheme(v);
}

/** Absence and junk both mean 'system' — the app never fights the device
 *  unless the person explicitly chose a side. */
export function resolveThemeSetting(stored: string | null): ThemeSetting {
  return isThemeSetting(stored) ? stored : 'system';
}

/**
 * Resolve the effective theme: an explicit stored choice always wins; with no
 * stored choice we follow the OS preference; absent both we default to dark
 * (the app's original look).
 */
export function resolveTheme(stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersLight ? 'light' : 'dark';
}

export function nextTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

/** Mobile browser-chrome color (<meta name="theme-color">) per theme. */
export function themeColor(theme: Theme): string {
  return theme === 'light' ? '#EBEDF1' : '#0B0F16';
}

// --- browser side effects (guarded: safe to call under SSR / node tests) ---

function safeStorageGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, val: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, val);
  } catch {
    /* private-mode / disabled storage: fall back to session-only theme */
  }
}

function prefersLight(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    );
  } catch {
    return false;
  }
}

export function storedTheme(): Theme | null {
  const v = safeStorageGet(THEME_STORAGE_KEY);
  return isTheme(v) ? v : null;
}

/**
 * The theme in effect right now. Prefer whatever the pre-paint inline script
 * already stamped on <html> (the single source of truth after boot); fall back
 * to a fresh resolve if that's somehow missing.
 */
export function currentTheme(): Theme {
  if (typeof document !== 'undefined') {
    const t = document.documentElement.dataset.theme;
    if (isTheme(t)) return t;
  }
  return resolveTheme(safeStorageGet(THEME_STORAGE_KEY), prefersLight());
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(theme));
}

/** Persist an explicit choice and apply it immediately. */
export function setTheme(theme: Theme): void {
  safeStorageSet(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

/** The stored three-way setting (what the CONTROL shows; currentTheme() is
 *  what the SCREEN shows). */
export function storedThemeSetting(): ThemeSetting {
  return resolveThemeSetting(safeStorageGet(THEME_STORAGE_KEY));
}

/** Persist a three-way choice and apply its resolution immediately.
 *  'system' is stored explicitly so choosing it back is itself an action. */
export function setThemeSetting(setting: ThemeSetting): void {
  safeStorageSet(THEME_STORAGE_KEY, setting);
  applyTheme(setting === 'system' ? (prefersLight() ? 'light' : 'dark') : setting);
}

/** Follow the OS live while the stored setting is 'system'. Installed once at
 *  boot (main.tsx); returns the unsubscribe for tests. */
export function watchSystemTheme(): () => void {
  try {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (storedThemeSetting() === 'system') applyTheme(mq.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  } catch {
    return () => {};
  }
}
