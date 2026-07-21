import { useEffect, useRef, useState } from 'react';
import { colorForName, initialsFor } from '../lib/colors.js';
import { currentTheme, nextTheme, setTheme, type Theme } from '../lib/theme.js';
import {
  READING_SCALES,
  currentReadingScale,
  setReadingScale,
  type ReadingScale,
} from '../lib/readingScale.js';

// T-26/T-27 account menu (design lead direction): the profile avatar owns
// every PERSONAL action — identity, Settings, theme, reading scale, and Log
// out with destructive separation. Room-scoped actions (Leave room, End
// room, invite) stay in the room overflow; neither menu duplicates the other.

interface Props {
  name: string;
  email?: string;
  /** Present in room context: routes to the Settings workspace surface. */
  onOpenSettings?: () => void;
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink';

export function AccountMenu({ name, email, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());
  const [scale, setScaleState] = useState<ReadingScale>(() => currentReadingScale());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus(); // focus returns to the avatar
        return;
      }
      // Conventional menu traversal: arrows cycle the interactive rows.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-row]') ?? [])];
        if (!items.length) return;
        event.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown'
          ? items[(at + 1) % items.length]
          : items[(at - 1 + items.length) % items.length];
        next?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isLight = theme === 'light';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={`Account: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`header-glass-control flex h-11 w-11 items-center justify-center rounded-xl transition ${open ? 'header-glass-control-active' : ''}`}
      >
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: colorForName(name) }}
          aria-hidden="true"
        >
          {initialsFor(name)}
        </span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-2xl pb-[max(0.375rem,env(safe-area-inset-bottom))]"
        >
          {/* Identity block: who this menu belongs to. Not interactive. */}
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <span
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: colorForName(name) }}
              aria-hidden="true"
            >
              {initialsFor(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold text-ink">{name}</span>
              {email && <span className="block truncate text-[13px] text-ink-faint">{email}</span>}
            </span>
          </div>
          <div className="my-1 h-px bg-border-faint" aria-hidden="true" />
          {onOpenSettings && (
            <button
              type="button"
              role="menuitem"
              data-menu-row
              onClick={() => { setOpen(false); onOpenSettings(); }}
              className={ROW}
            >
              <span className="flex w-5 justify-center" aria-hidden="true">⚙</span>
              Settings
            </button>
          )}
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={isLight}
            data-menu-row
            onClick={() => {
              const to = nextTheme(theme);
              setTheme(to);
              setThemeState(to);
            }}
            className={ROW}
          >
            <span className="flex w-5 justify-center" aria-hidden="true">{isLight ? '☾' : '☀'}</span>
            {isLight ? 'Dark mode' : 'Light mode'}
          </button>
          {/* Reading scale: phone message-text size, Comfortable default. */}
          <div className="rounded-lg px-3 pb-2 pt-1.5">
            <div id="reading-scale-label" className="text-[13px] font-semibold text-ink-faint">Reading scale</div>
            <div role="radiogroup" aria-labelledby="reading-scale-label" className="mt-1.5 flex rounded-lg bg-surface-softer p-0.5">
              {READING_SCALES.map(option => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={scale === option.value}
                  data-menu-row
                  title={option.hint}
                  onClick={() => {
                    setReadingScale(option.value);
                    setScaleState(option.value);
                  }}
                  className={`min-h-11 flex-1 rounded-md px-1 text-[13px] font-semibold transition ${
                    scale === option.value ? 'bg-surface text-ink shadow-card' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {/* Destructive separation: Log out sits alone below its own rule. */}
          <div className="my-1 h-px bg-border-faint" aria-hidden="true" />
          <a
            href="/cdn-cgi/access/logout"
            role="menuitem"
            data-menu-row
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium text-red-400 transition hover:bg-red-500/10"
          >
            <span className="flex w-5 justify-center" aria-hidden="true">⎋</span>
            Log out
          </a>
        </div>
      )}
    </div>
  );
}
