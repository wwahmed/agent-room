import type { Message } from '@agent-room/shared';
import { MessageMenu } from './MessageMenu.js';
import { ThumbDownIcon, ThumbUpIcon } from './ThumbIcons.js';
import { showToast } from './Toast.js';

// T-124/T-136: copy a message body to the clipboard, with a legacy fallback.
async function copyMessageText(message: Message) {
  const text = message.text ?? '';
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied');
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Copied');
    } catch { showToast('Copy failed', 'error'); }
  }
}

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
  // T-124/T-136: the auto-reveal card-anchored tray is the SHIPPED experience
  // (Waqas chose it over the dots). The flag remains only as an escape hatch to
  // force the legacy dots or the rail variant.
  try {
    const v = localStorage.getItem('ui:action-treatment');
    return v === 'legacy' || v === 'rail' ? v : 'tray';
  } catch {
    return 'tray';
  }
}

// T-124/T-136: each action is COLOR-CODED to its meaning so color is an extra
// signal, never the only one — every button also keeps a distinct icon shape
// and an aria-label, so it reads for colorblind and screen-reader users and
// stays legible on light and dark. `tone` sets the resting color and the hover
// wash; the resting state is slightly muted so the cluster is calm until used.
type Tone = 'blue' | 'green' | 'rose' | 'slate';
const TONE: Record<Tone, string> = {
  blue: 'text-blue-500/80 hover:bg-blue-500/15 hover:text-blue-500 dark:text-blue-400/90 dark:hover:text-blue-300',
  green: 'text-emerald-500/80 hover:bg-emerald-500/15 hover:text-emerald-500 dark:text-emerald-400/90 dark:hover:text-emerald-300',
  rose: 'text-rose-500/80 hover:bg-rose-500/15 hover:text-rose-500 dark:text-rose-400/90 dark:hover:text-rose-300',
  slate: 'text-slate-500/80 hover:bg-slate-500/15 hover:text-slate-600 dark:text-slate-300/80 dark:hover:text-slate-200',
};

function GlyphButton({ label, tone, onClick, children }: { label: string; tone: Tone; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${TONE[tone]}`}
    >
      {children}
    </button>
  );
}

const ReplyGlyph = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 4 3 8l4 4M3.4 8H10a3.5 3.5 0 0 1 3.5 3.5V13" />
  </svg>
);
const CopyGlyph = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="5" width="8.5" height="9.5" rx="1.5" />
    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5" />
  </svg>
);

/** T-124/T-136 shipped: the auto-reveal action panel. It is a child of the
 *  message CARD (msg-content is position:relative), anchored to the card's
 *  top-right corner — never the full-width row — so it hugs the bubble at every
 *  viewport instead of stranding in the desktop gutter (the T-136 bug). It
 *  overlays the margin above the card (absolute, z-30), fades in on hover/focus
 *  and out on leave, and reflows nothing (reading-anchor law). Desktop only
 *  (sm:flex); phones keep the always-visible dots since touch has no hover. */
function PanelButtons({ message, onReact, onReply }: {
  message: Message;
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  onReply?: (m: Message) => void;
}) {
  return (
    <>
      {onReply && (
        <GlyphButton label="Reply to message" tone="blue" onClick={() => onReply(message)}><ReplyGlyph /></GlyphButton>
      )}
      {onReact && (
        <GlyphButton label="Acknowledge message" tone="green" onClick={() => onReact(message, 'ack')}><ThumbUpIcon /></GlyphButton>
      )}
      {onReact && (
        <GlyphButton label="Reject message" tone="rose" onClick={() => onReact(message, 'reject')}><ThumbDownIcon /></GlyphButton>
      )}
      <GlyphButton label="Copy text" tone="slate" onClick={() => copyMessageText(message)}><CopyGlyph /></GlyphButton>
    </>
  );
}

export function HoverActionTray({ message, onReact, onReply }: {
  message: Message;
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  onReply?: (m: Message) => void;
  selfName?: string;
}) {
  return (
    <div
      data-gate="action-tray"
      className="absolute -top-3.5 right-1 z-30 hidden items-center gap-0.5 rounded-full border border-border bg-surface px-1 py-0.5 shadow-md transition-opacity duration-150 sm:flex opacity-0 focus-within:opacity-100 group-hover:opacity-100"
    >
      <PanelButtons message={message} onReact={onReact} onReply={onReply} />
    </div>
  );
}

/** Treatment B: slim accent rail hugging the message wall edge, marking the
 *  hovered message's full height, CARRYING the action pill at its top (the
 *  spec's "thin vertical bar alongside the message wall" reading). The pill
 *  sits in the top margin like treatment A but anchored to the wall side,
 *  visually connected to the bar. */
export function EdgeActionRail({ message, onReact, onReply, selfName, mirror = false }: {
  message: Message;
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  onReply?: (m: Message) => void;
  selfName?: string;
  /** Own messages sit against the RIGHT wall — the rail mirrors with them
   *  (verifier note on the first frame set). */
  mirror?: boolean;
}) {
  return (
    <div
      data-gate="action-rail"
      className={`absolute inset-y-0 z-30 hidden w-2 transition-opacity sm:block opacity-0 focus-within:opacity-100 group-hover:opacity-100 ${mirror ? 'right-0' : 'left-0'}`}
    >
      <span className={`absolute inset-y-0 w-[3px] rounded-full bg-accent/60 ${mirror ? 'right-0' : 'left-0'}`} aria-hidden="true" />
      <div className={`absolute -top-9 flex items-center gap-0.5 rounded-full border border-accent/40 bg-surface px-1.5 py-0.5 shadow-md ${mirror ? 'right-2' : 'left-2'}`}>
        <PanelButtons message={message} onReact={onReact} onReply={onReply} />
      </div>
    </div>
  );
}
