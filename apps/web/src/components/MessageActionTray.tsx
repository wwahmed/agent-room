import type { Message } from '@agent-room/shared';
import { MessageMenu } from './MessageMenu.js';

// T-124 (T-38i) PROTOTYPE: two hover-treatment candidates for the message
// action cluster, shipped INERT behind a local flag so the live experience is
// unchanged until the owner picks a frame:
//   'tray' — floating horizontal pill at the message's top corner on hover
//   'rail' — slim vertical bar hugging the message wall edge, marking the
//            hovered message's full height, carrying the same actions
// Both are overlays (absolute, z-30): they appear in the margins and never
// reflow text (reading-anchor law). Glyphs come from our existing SVG
// vocabulary (the chips' check/cross), not emoji — emoji render
// inconsistently across platforms and fight the premium look.
// Desktop only (hidden below sm); the phone keeps its always-visible dots.

export type ActionTreatment = 'legacy' | 'tray' | 'rail';

export function readActionTreatment(): ActionTreatment {
  try {
    const v = localStorage.getItem('ui:action-treatment');
    return v === 'tray' || v === 'rail' ? v : 'legacy';
  } catch {
    return 'legacy';
  }
}

function GlyphButton({ label, onClick, floating, children }: { label: string; onClick?: () => void; floating?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-softer hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${floating ? 'border border-border bg-surface shadow-sm' : ''}`}
    >
      {children}
    </button>
  );
}

function ActionGlyphs({ message, onReact, onReply, selfName, floating }: {
  message: Message;
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  onReply?: (m: Message) => void;
  selfName?: string;
  floating?: boolean;
}) {
  return (
    <>
      {onReact && (
        <GlyphButton label="Acknowledge message" floating={floating} onClick={() => onReact(message, 'ack')}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 8.5 3.2 3.2L13 4.5" />
          </svg>
        </GlyphButton>
      )}
      {onReact && (
        <GlyphButton label="Reject message" floating={floating} onClick={() => onReact(message, 'reject')}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </GlyphButton>
      )}
      {onReply && (
        <GlyphButton label="Reply to message" floating={floating} onClick={() => onReply(message)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 4 3 8l4 4M3.4 8H10a3.5 3.5 0 0 1 3.5 3.5V13" />
          </svg>
        </GlyphButton>
      )}
      <MessageMenu message={message} onReply={onReply} selfName={selfName} />
    </>
  );
}

/** Treatment A: floating horizontal tray at the message's top corner. */
export function HoverActionTray({ message, onReact, onReply, selfName, align = 'right' }: {
  message: Message;
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  onReply?: (m: Message) => void;
  selfName?: string;
  align?: 'left' | 'right';
}) {
  return (
    <div
      data-gate="action-tray"
      className={`absolute -top-3 z-30 hidden items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-0.5 shadow-md transition-opacity sm:flex ${align === 'right' ? 'right-6' : 'left-6'} opacity-0 focus-within:opacity-100 group-hover:opacity-100`}
    >
      <ActionGlyphs message={message} onReact={onReact} onReply={onReply} selfName={selfName} />
    </div>
  );
}

/** Treatment B: slim accent rail hugging the message wall edge, marking the
 *  hovered message's full height, CARRYING the action pill at its top (the
 *  spec's "thin vertical bar alongside the message wall" reading). The pill
 *  sits in the top margin like treatment A but anchored to the wall side,
 *  visually connected to the bar. */
export function EdgeActionRail({ message, onReact, onReply, selfName }: {
  message: Message;
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  onReply?: (m: Message) => void;
  selfName?: string;
}) {
  return (
    <div
      data-gate="action-rail"
      className="absolute inset-y-0 left-0 z-30 hidden transition-opacity sm:block opacity-0 focus-within:opacity-100 group-hover:opacity-100"
    >
      <span className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-accent/60" aria-hidden="true" />
      <div className="absolute -top-3.5 left-2 flex items-center gap-0.5 rounded-full border border-accent/40 bg-surface px-1.5 py-0.5 shadow-md">
        <ActionGlyphs message={message} onReact={onReact} onReply={onReply} selfName={selfName} />
      </div>
    </div>
  );
}
