import { useEffect, useRef, useState } from 'react';
import type { Message } from '@agent-room/shared';
import { showToast } from './Toast.js';

// T-52: per-message actions. A ⋯ button (revealed on hover, always focusable)
// and long-press on touch both open a small popover; "Copy text" copies the
// message body to the clipboard. Structured so a future "Reply" action slots in
// beside Copy. Dismisses on outside-click or Escape.
export function MessageMenu({ message, align = 'right' }: { message: Message; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function copyText() {
    setOpen(false);
    const text = message.text ?? '';
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
    } catch {
      // Fallback for browsers without async clipboard (older Safari / non-secure ctx)
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Copied');
      } catch {
        showToast('Copy failed');
      }
    }
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-surface-softer hover:text-ink focus:opacity-100 focus:outline-none ${open ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 sm:opacity-0'}`}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute top-7 z-30 min-w-[128px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={copyText}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink transition hover:bg-surface-softer"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="5" width="8.5" height="9.5" rx="1.5" />
              <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5" />
            </svg>
            Copy text
          </button>
        </div>
      )}
    </div>
  );
}
