import { useEffect, useState } from 'react';
import { RELEASE_NOTES, formatReleaseDate, markReleaseNotesSeen } from '../lib/releaseNotes.js';
import { WHATS_NEW_EVENT } from '../lib/whatsNew.js';

// T-137: the "What's new" panel. Mounted once at the app root; opens when any
// surface fires WHATS_NEW_EVENT (the account menu row, the update banner link).
// Renders the bundled release notes newest-first and marks them seen on open.
export function WhatsNew() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => { markReleaseNotesSeen(); setOpen(true); };
    window.addEventListener(WHATS_NEW_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={() => setOpen(false)}
    >
      <div
        data-gate="whats-new"
        role="dialog"
        aria-modal="true"
        aria-label="What's new"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-[16px] font-bold text-ink">What's new</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-softer hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {RELEASE_NOTES.map((note) => (
            <section key={note.date} data-gate="release-entry" className="mb-5 last:mb-1">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-[14px] font-bold text-ink">{note.title}</span>
                <span className="text-[12px] text-ink-faint">{formatReleaseDate(note.date)}</span>
              </div>
              <ul className="space-y-1.5">
                {note.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-ink-soft">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent/70" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
