import { useEffect, useRef, useState } from 'react';
import type { Message } from '@agent-room/shared';
import { showToast } from './Toast.js';
import { ownReaction } from '../lib/reactions.js';
import { ThumbDownIcon, ThumbUpIcon } from './ThumbIcons.js';

// T-52: per-message actions. A ⋯ button (revealed on hover, always focusable)
// and long-press on touch both open a small popover; "Copy text" copies the
// message body to the clipboard. Structured so a future "Reply" action slots in
// beside Copy. Dismisses on outside-click or Escape.
//
// T-121: the SAME cluster on every message regardless of sender — Copy, Reply,
// Acknowledge, Reject. The ⋯ anchor is persistent on desktop (faint until
// hover, never fully hidden) and always visible on phone. Acknowledge/Reject
// store structured reactions the server relays to listening agents.
export function MessageMenu({ message, onReply, onReact, onPin, pinned, selfName }: {
  message: Message;
  onReply?: (m: Message) => void;
  /** T-121: toggle an ack/reject reaction on this message. */
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  /** T-14: toggle this message on the room's pinned-outcomes strip. */
  onPin?: (m: Message) => void;
  /** T-14: whether this message is currently pinned (labels the toggle). */
  pinned?: boolean;
  /** Viewer's display name, to label toggle-off state on their own reaction. */
  selfName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // T-42: the popover was absolutely positioned with `right-0`, anchoring its
  // right edge to the trigger and growing LEFTWARD. On a phone the trigger sits
  // near the left edge of an own (right-aligned) bubble, so the menu ran off the
  // screen — the host's screenshot shows three items clipped to "edge", "age",
  // "t". Unusable, and invisible on desktop where there is room to spare.
  //
  // Fixed positioning measured on open solves both halves: it is clamped inside
  // the viewport, and being out of the normal flow it also escapes any ancestor
  // that clips overflow.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const MENU_W = 184;   // min-w-[168px] plus border/padding
  const EDGE = 8;       // never touch the screen edge

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const maxLeft = Math.max(EDGE, window.innerWidth - MENU_W - EDGE);
      // Prefer right-aligned to the trigger (the original intent), then clamp.
      setPos({ top: r.bottom + 6, left: Math.min(Math.max(EDGE, r.right - MENU_W), maxLeft) });
    };
    place();
    // Recompute on resize/orientation change; close on scroll rather than let a
    // fixed menu drift away from the message it belongs to.
    const close = () => setOpen(false);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

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
        showToast('Copy failed', 'error');
      }
    }
  }

  const mine = ownReaction(message, selfName);
  // This menu is the phone action surface too. A readable 13px label does not
  // compensate for a ~32px row that is easy to miss with a thumb.
  const itemClass = 'flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink transition hover:bg-surface-softer';

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        // The control itself owns the 44px box. The old 24px wrapper +
        // negative margin made the invisible hit area widen the phone feed by
        // 8px and exposed a horizontal scrollbar at 390px.
        // T-121: persistent anchor — faint on desktop until hover, full on
        // phone. Never opacity-0: the affordance must be discoverable.
        className={`flex h-11 w-11 items-center justify-center focus:opacity-100 focus:outline-none ${open ? 'opacity-100' : 'opacity-60 group-hover:opacity-100 sm:opacity-40'}`}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-surface-softer hover:text-ink">
          <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="13" cy="8" r="1.4" />
          </svg>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          data-gate="message-menu"
          // Rendered only once measured, so it never flashes at the wrong place.
          style={pos ? { top: pos.top, left: pos.left, width: MENU_W } : { visibility: 'hidden' }}
          className="fixed z-50 max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {onReact && message.type === 'msg' && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onReact(message, 'ack'); }}
                className={itemClass}
              >
                <ThumbUpIcon />
                {mine?.kind === 'ack' ? 'Remove acknowledgment' : 'Acknowledge'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onReact(message, 'reject'); }}
                className={itemClass}
              >
                <ThumbDownIcon />
                {mine?.kind === 'reject' ? 'Remove rejection' : 'Reject'}
              </button>
            </>
          )}
          {onPin && message.type === 'msg' && (
            <button
              type="button"
              role="menuitem"
              data-gate="pin-toggle"
              onClick={() => { setOpen(false); onPin(message); }}
              className={itemClass}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9.7 1.8 4.5 4.5-1.8.6-.4 2.6-3.2 1L6 12l-4 2 2-4 1.5-2.8 1-3.2 2.6-.4z" />
                <path d="M6 10 2 14" />
              </svg>
              {pinned ? 'Unpin message' : 'Pin message'}
            </button>
          )}
          {onReply && message.type === 'msg' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onReply(message); }}
              className={itemClass}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 4 3 8l4 4M3.4 8H10a3.5 3.5 0 0 1 3.5 3.5V13" />
              </svg>
              Reply
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={copyText}
            className={itemClass}
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
