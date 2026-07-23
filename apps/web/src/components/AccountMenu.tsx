import { useEffect, useRef, useState } from 'react';
import { colorForName, initialsFor } from '../lib/colors.js';
import { storedThemeSetting } from '../lib/theme.js';
import { currentReadingScale } from '../lib/readingScale.js';
import { openWhatsNew } from '../lib/whatsNew.js';
import { hasUnseenReleaseNotes } from '../lib/releaseNotes.js';
import {
  AppearanceChoices,
  ReadingScaleChoices,
  readingScaleLabel,
  themeSettingLabel,
} from './PreferenceControls.js';

// T-26/T-27 account menu (design lead direction, rev2): the profile avatar
// owns every PERSONAL action. The popover is a DIALOG with natural Tab
// order, not a menu wrapping radios. Preferences are compact disclosure
// rows ("Appearance · System ›") that open an in-popover subpanel — the
// resting surface pays only for what it earns. Log out sits alone below a
// rule with a real exit-door icon. Room-scoped actions stay in the room
// overflow; neither surface duplicates the other.

interface Props {
  name: string;
  email?: string;
  /** Settings row destination — the Settings workspace surface in a room,
   *  the /settings page from Home. Always provided; the row is mandatory. */
  onOpenSettings: () => void;
}

type Panel = 'main' | 'appearance' | 'scale';

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink';

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-ink-faint">
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

export function AccountMenu({ name, email, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('main');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus(); // focus returns to the avatar
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Entering a subpanel moves focus to its Back control; the subpanel's
  // natural Tab order then covers the choice rows.
  useEffect(() => {
    if (open && panel !== 'main') backRef.current?.focus();
  }, [open, panel]);

  const openPopover = () => {
    setPanel('main');
    setOpen(v => !v);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={openPopover}
        aria-label={`Account: ${name}`}
        aria-haspopup="dialog"
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
          role="dialog"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-2xl pb-[max(0.375rem,env(safe-area-inset-bottom))]"
        >
          {panel === 'main' && (
            <>
              {/* Identity block: who this popover belongs to. Not interactive. */}
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
              <button type="button" onClick={() => { setOpen(false); onOpenSettings(); }} className={ROW}>
                <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
                  <circle cx="8" cy="8" r="2.2" />
                  <path d="M8 1.8v1.7M8 12.5v1.7M14.2 8h-1.7M3.5 8H1.8M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6" />
                </svg>
                <span className="flex-1">Settings</span>
                <Chevron />
              </button>
              <button type="button" onClick={() => setPanel('appearance')} className={ROW} aria-haspopup="true">
                <span className="flex-1">Appearance</span>
                <span className="text-[13px] text-ink-faint">{themeSettingLabel(storedThemeSetting())}</span>
                <Chevron />
              </button>
              <button type="button" onClick={() => setPanel('scale')} className={ROW} aria-haspopup="true">
                <span className="flex-1">Reading scale</span>
                <span className="text-[13px] text-ink-faint">{readingScaleLabel(currentReadingScale())}</span>
                <Chevron />
              </button>
              {/* T-137: what changed in recent releases. A dot marks a release
                  the user has not opened yet. */}
              <button type="button" data-gate="menu-whats-new" onClick={() => { setOpen(false); openWhatsNew(); }} className={ROW}>
                <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
                  <path d="M8 1.8 9.9 5.9 14.2 6.4 11 9.3 11.9 13.6 8 11.4 4.1 13.6 5 9.3 1.8 6.4 6.1 5.9z" />
                </svg>
                <span className="flex-1">What's new</span>
                {hasUnseenReleaseNotes() && <span aria-label="New updates" className="h-2 w-2 flex-shrink-0 rounded-full bg-accent" />}
              </button>
              {/* Destructive separation: Log out alone below its own rule,
                  with a real exit-door icon (a refresh glyph reads as reload). */}
              <div className="my-1 h-px bg-border-faint" aria-hidden="true" />
              <a
                href="/cdn-cgi/access/logout"
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium text-red-400 transition hover:bg-red-500/10"
              >
                <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0">
                  <path d="M10 2.5H4.5A1 1 0 0 0 3.5 3.5v9a1 1 0 0 0 1 1H10" />
                  <path d="M13.5 8H6.8M11 5.3 13.7 8 11 10.7" />
                </svg>
                Log out
              </a>
            </>
          )}
          {panel !== 'main' && (
            <>
              <button
                ref={backRef}
                type="button"
                onClick={() => setPanel('main')}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[15px] font-semibold text-ink transition hover:bg-surface-softer"
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 3.5 5.5 8l4.5 4.5" />
                </svg>
                {panel === 'appearance' ? 'Appearance' : 'Reading scale'}
              </button>
              <div className="my-1 h-px bg-border-faint" aria-hidden="true" />
              {panel === 'appearance' ? <AppearanceChoices /> : <ReadingScaleChoices />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
