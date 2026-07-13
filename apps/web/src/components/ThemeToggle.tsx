import { useState } from 'react';
import { currentTheme, nextTheme, setTheme, type Theme } from '../lib/theme.js';

// T-43: one-tap light/dark switch. The pre-paint script (index.html) has already
// stamped <html data-theme> before React mounts, so we read the live value and
// never cause a flash. Shows the icon of the destination (sun = go light,
// moon = go dark) to match the action label.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());

  const flip = () => {
    const to = nextTheme(theme);
    setTheme(to);
    setThemeState(to);
  };

  const isLight = theme === 'light';
  return (
    <button
      type="button"
      onClick={flip}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Dark mode' : 'Light mode'}
      className={
        className ??
        'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface-softer hover:text-ink'
      }
    >
      {isLight ? (
        // moon → tapping switches to dark
        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.2 9.4A5.2 5.2 0 0 1 6.6 2.8a5.4 5.4 0 1 0 6.6 6.6Z" />
        </svg>
      ) : (
        // sun → tapping switches to light
        <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="3.1" />
          <path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4 3.3 3.3" />
        </svg>
      )}
    </button>
  );
}
