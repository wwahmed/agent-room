// T-26/T-27 account menu + T-73 phone reading scale. Mirrors theme.ts: the
// pure decision logic is unit-tested under node; the DOM/localStorage side
// effects are guarded so they are inert off the browser. The actual sizes are
// pure CSS — index.css maps [data-reading-scale] onto the .msg-* reading
// roles at phone widths, so components never branch on scale.

export type ReadingScale = 'comfortable' | 'large' | 'compact';

export const READING_SCALE_STORAGE_KEY = 'wakichat:reading-scale';
export const READING_SCALE_DEFAULT: ReadingScale = 'comfortable';

export const READING_SCALES: { value: ReadingScale; label: string; hint: string }[] = [
  { value: 'comfortable', label: 'Comfortable', hint: 'Default reading size' },
  { value: 'large', label: 'Large', hint: 'Bigger message text' },
  { value: 'compact', label: 'Compact', hint: 'More on screen' },
];

export function isReadingScale(v: unknown): v is ReadingScale {
  return v === 'comfortable' || v === 'large' || v === 'compact';
}

/** An explicit stored choice wins; anything else is the Comfortable default. */
export function resolveReadingScale(stored: string | null): ReadingScale {
  return isReadingScale(stored) ? stored : READING_SCALE_DEFAULT;
}

// --- browser side effects (guarded: safe under SSR / node tests) ---

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
    /* private-mode / disabled storage: session-only scale */
  }
}

/** The scale in effect right now: the stamped attribute wins after boot. */
export function currentReadingScale(): ReadingScale {
  if (typeof document !== 'undefined') {
    const s = document.documentElement.dataset.readingScale;
    if (isReadingScale(s)) return s;
  }
  return resolveReadingScale(safeStorageGet(READING_SCALE_STORAGE_KEY));
}

export function applyReadingScale(scale: ReadingScale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.readingScale = scale;
}

/** Persist an explicit choice and apply it immediately. */
export function setReadingScale(scale: ReadingScale): void {
  safeStorageSet(READING_SCALE_STORAGE_KEY, scale);
  applyReadingScale(scale);
}
