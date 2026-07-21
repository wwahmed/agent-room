import { useRef, useState } from 'react';
import type { Message } from '@agent-room/shared';
import { AttachmentList, systemEventLabel } from './Bubble.js';
import { messageTime } from '../lib/relativeTime.js';
import { isStatusPing } from '../lib/unread.js';
import { MessageMenu } from './MessageMenu.js';
import { CollapsibleMessageBody } from './CollapsibleMessageBody.js';

// T-05 editorial message rows. Sender identity is the primary visual
// anchor (host feedback: "I am having a very hard time distinguishing
// you two"):
//   - 32px avatar per group; agents (client 'cc') get a rounded-SQUARE
//     avatar, humans (web) a circle, so shape distinguishes them before
//     color or text does.
//   - Sender name at 15px bold in the sender's color; role/client are
//     secondary text, not micro badges.
//   - Other people's messages are full-width text-first rows; own
//     messages keep a subtle right alignment (accent-tinted block, no
//     avatar) without oversized bubbles.
//   - Consecutive messages from the same sender within 5 minutes group
//     under one header, Slack-style, for density.
//
// A message can arrive with no `text` (agent client bug or
// attachment-only send) — every read goes through `text ?? ''` so one
// malformed message can't take the feed down.

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function isSameGroup(prev: Message | undefined, m: Message): boolean {
  return Boolean(
    prev &&
    prev.type === 'msg' &&
    m.type === 'msg' &&
    prev.name === m.name &&
    prev.client === m.client &&
    m.time - prev.time < GROUP_WINDOW_MS,
  );
}

// Host direction (04:14): the well-known agents use their real public
// app marks (fetched from claude.ai / Wikimedia Commons at his request);
// everyone else keeps the initials block until per-user avatars land.
const AGENT_LOGOS: Record<string, string> = {
  claude: '/brand/agents/claude.png',
  codex: '/brand/agents/codex.png',
};

function SenderAvatar({ message, sizeClass = 'h-9 w-9', textClass = 'text-[12px]' }: { message: Message; sizeClass?: string; textClass?: string }) {
  const agent = message.client === 'cc';
  const logo = agent ? AGENT_LOGOS[String(message.name ?? '').trim().toLowerCase()] : undefined;
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={`${sizeClass} flex-shrink-0 select-none rounded-md`}
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      className={`flex ${sizeClass} flex-shrink-0 select-none items-center justify-center ${textClass} font-bold text-white ${agent ? 'rounded-md' : 'rounded-full'}`}
      style={{ backgroundColor: message.color }}
      aria-hidden="true"
    >
      {message.initials}
    </div>
  );
}

interface Props {
  message: Message;
  self: boolean;
  grouped: boolean;
  ambiguousNames?: Set<string>;
  /** Live clock for relative timestamps (T-49); ticks every ~30s from Room. */
  now?: number;
  /** T-54: start a quote-reply to this message. */
  onReply?: (m: Message) => void;
  /** T-54: jump to a quoted original by id. */
  onJumpToQuote?: (id: number) => void;
  /** T-12: the VIEWER's display name, for the you-were-mentioned highlight. */
  selfName?: string;
}

// Exact clock for the hover/title tooltip — precise time behind the relative label.
function exactTime(t: number): string {
  return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// T-54: the quoted-message block rendered atop a reply. Denormalized (name +
// snippet travel on the reply) so it shows even after the original pages out;
// tapping it jumps to the original when still loaded.
function ReplyQuote({ reply, onJump, onDark }: { reply: NonNullable<Message['replyTo']>; onJump?: (id: number) => void; onDark?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(reply.id)}
      className={`mb-1.5 flex w-full flex-col items-start gap-0.5 rounded-md border-l-2 px-2.5 py-1 text-left transition ${
        onDark ? 'border-white/60 bg-white/10 hover:bg-white/20' : 'border-accent/60 bg-black/10 hover:bg-black/20'
      }`}
    >
      <span className={`text-[12px] font-semibold ${onDark ? 'text-white/90' : 'text-accent-deep'}`}>{reply.name}</span>
      <span className={`line-clamp-2 text-[12px] leading-snug [overflow-wrap:anywhere] ${onDark ? 'text-white/70' : 'text-ink-faint'}`}>{reply.text || '…'}</span>
    </button>
  );
}

// T-54/T-55: swipe-right (touch) to reply — the WhatsApp gesture WITH live
// feedback. As the finger drags right the bubble follows (up to MAX), a reply
// arrow fades in behind it, and on release it snaps back — firing the reply if
// dragged past TRIGGER. Bails to vertical scroll when the motion is mostly
// vertical. Returns handlers to spread, a transform style, and a progress value
// (0..1) for the arrow indicator.
const SWIPE_MAX = 72;
const SWIPE_TRIGGER = 52;

function useSwipeReply(onReply: (() => void) | undefined) {
  const start = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const dxRef = useRef(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  if (!onReply) return { bind: {}, style: undefined as React.CSSProperties | undefined, progress: 0 };

  const reset = () => {
    dxRef.current = 0;
    setDx(0);
    setDragging(false);
  };

  return {
    bind: {
      onTouchStart: (e: React.TouchEvent) => {
        const t = e.touches[0];
        start.current = t ? { x: t.clientX, y: t.clientY, active: false } : null;
      },
      onTouchMove: (e: React.TouchEvent) => {
        const s = start.current;
        const t = e.touches[0];
        if (!s || !t) return;
        const rawX = t.clientX - s.x;
        const rawY = t.clientY - s.y;
        if (!s.active) {
          if (Math.abs(rawX) < 8 && Math.abs(rawY) < 8) return;
          if (Math.abs(rawY) >= Math.abs(rawX)) { start.current = null; return; } // vertical → let it scroll
          s.active = true;
          setDragging(true);
        }
        const d = Math.max(0, Math.min(SWIPE_MAX, rawX));
        dxRef.current = d;
        setDx(d);
      },
      onTouchEnd: () => {
        const trigger = dxRef.current >= SWIPE_TRIGGER;
        start.current = null;
        reset();
        if (trigger) onReply();
      },
    },
    style: {
      transform: dx ? `translateX(${dx}px)` : undefined,
      transition: dragging ? 'none' : 'transform .18s ease-out',
    } as React.CSSProperties,
    progress: Math.min(1, dx / SWIPE_TRIGGER),
  };
}

// The reply-arrow that fades in behind a bubble as it's swiped.
function SwipeReplyIndicator({ progress }: { progress: number }) {
  if (progress <= 0) return null;
  return (
    <span
      className="pointer-events-none absolute left-1 top-1/2 z-0 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-accent-tint text-accent"
      style={{ opacity: progress, transform: `translateY(-50%) scale(${0.5 + progress * 0.5})` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4 3 8l4 4M3.4 8H10a3.5 3.5 0 0 1 3.5 3.5V13" />
      </svg>
    </span>
  );
}

export function MessageRow({ message, self, grouped, ambiguousNames, now, onReply, onJumpToQuote, selfName }: Props) {
  const body = message.text ?? '';
  const swipe = useSwipeReply(onReply && message.type === 'msg' ? () => onReply(message) : undefined);

  if (message.type === 'sys') {
    return (
      <div className="flex justify-center px-4 py-0.5">
        <div className="max-w-[90%] rounded-md bg-surface-softer px-2.5 py-1 text-center text-[12px] leading-snug text-ink-faint [overflow-wrap:anywhere]">
          {systemEventLabel(message)}
        </div>
      </div>
    );
  }

  // T-20 (host: "special status chip ... so that I don't get distracted by
  // noise"): stamped heartbeat/status pings render as a quiet centered row —
  // sender-attributed but visually operational, not conversational. They are
  // also excluded from every unread surface (see lib/unread.ts).
  if (isStatusPing(message)) {
    return (
      <div id={`msg-${message.id}`} className="flex justify-center px-4 py-0.5" title={exactTime(message.time)}>
        {/* T-20 rev2 per the UX review: one quiet line — labels are
            shrink-proof/nowrap, overflow-wrap lives ONLY on the wrapping text
            span, chip uses real theme tokens (bg-black/10 vanished on dark),
            relative time closes the line. */}
        <div className="flex max-w-[90%] items-baseline gap-1.5 rounded-md border border-border-faint bg-surface-softer px-2.5 py-1 text-[12px] leading-snug text-ink-soft">
          <span className="flex-shrink-0 whitespace-nowrap rounded border border-border-faint bg-surface px-1 py-0.5 text-[12px] font-semibold text-ink-soft" aria-label="Status update">Status</span>
          <span className="flex-shrink-0 whitespace-nowrap font-semibold" style={{ color: message.color }}>{message.name}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{message.text}</span>
          <span className="flex-shrink-0 whitespace-nowrap text-ink-faint">{messageTime(message.time, now)}</span>
        </div>
      </div>
    );
  }

  if (self) {
    // Own messages: keep the conversational right alignment, but use the
    // quiet accent-tint surface. Saturated accent is reserved for actions and
    // unread state so a long self-authored message never dominates the feed.
    return (
      <div id={`msg-${message.id}`} {...swipe.bind} className={`group relative flex items-start justify-end gap-1 pl-10 pr-3 sm:pl-16 sm:pr-4 ${grouped ? 'mt-2' : 'mt-5'}`}>
        <SwipeReplyIndicator progress={swipe.progress} />
        <div className="pt-1"><MessageMenu message={message} onReply={onReply} /></div>
        <div style={swipe.style} className="relative z-10 min-w-0 max-w-[88%] break-words rounded-xl rounded-br-md border border-accent/20 bg-accent-tint/40 px-3 py-2 text-ink sm:max-w-[70%] [overflow-wrap:anywhere]">
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {/* T-30 rev3 per UX: the SHOUTING was the measure, not the glyphs —
              cap the line length at ~68ch and keep 15-16px type. */}
          {body.trim() && (
            <div className="text-[14px] font-[350] leading-[1.7] [&_strong]:font-medium">
              <CollapsibleMessageBody text={body} selfName={selfName} />
            </div>
          )}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          <div className="mt-1 text-right text-[12px] leading-none text-ink-faint" title={exactTime(message.time)}>{messageTime(message.time, now)}</div>
        </div>
      </div>
    );
  }

  const ambiguous = ambiguousNames?.has(message.name);

  // T-41 host correction: identity color belongs to the avatar/name, not a
  // giant saturated card behind every agent report. The incoming surface is
  // deliberately near-neutral so long work updates read like a calm Slack/
  // Teams transcript instead of a stack of alerts.
  const bubble = { backgroundColor: 'transparent', borderColor: `${message.color}14` };
  const agentSender = message.client === 'cc';
  // T-56 (host: "wasting space at top", "empty margin on the right"): incoming
  // bubbles are capped-width and left-aligned (pr-* leaves a right margin for
  // the left/right rhythm); the top is tight — a small avatar overlaps the top
  // corner, name + time sit on ONE line (no divider, no wrap), role hidden on
  // mobile.
  const rowClass = 'group relative pl-5 pr-12 sm:pl-6 sm:pr-20';
  const bubbleShape = 'relative z-10 inline-block max-w-full break-words rounded-xl border sm:max-w-[min(36rem,82%)] [overflow-wrap:anywhere]';
  // Calm transcript type: stable 15px, explicitly normal weight, and enough
  // leading to separate dense technical prose without enlarging it.
  const bodyText = 'text-[14px] font-[350] leading-[1.7] [&_strong]:font-medium';

  if (grouped) {
    // Follow-up in a group: a plain capped bubble under the first, no header.
    return (
      <div id={`msg-${message.id}`} {...swipe.bind} className={`${rowClass} mt-2`} title={exactTime(message.time)}>
        <SwipeReplyIndicator progress={swipe.progress} />
        <div className={`${bubbleShape} px-3 py-2 ${bodyText}`} style={{ ...bubble, ...swipe.style }}>
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {body.trim() && <CollapsibleMessageBody text={body} selfName={selfName} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
        <div className="absolute right-3 top-1"><MessageMenu message={message} onReply={onReply} /></div>
      </div>
    );
  }

  return (
    <div id={`msg-${message.id}`} {...swipe.bind} className={`${rowClass} mt-5`}>
      <SwipeReplyIndicator progress={swipe.progress} />
      <div className={bubbleShape} style={{ ...bubble, ...swipe.style }}>
        {/* T-58 (host: "others on the left", "can barely read the name"): the
            avatar badge sits on the bubble's OUTER (left) edge, overlapping the
            top corner, and is legible-sized. */}
        <div className={`absolute -top-1 -left-2 z-20 ring-2 ring-surface-sunken ${agentSender ? 'rounded-lg' : 'rounded-full'}`}>
          <SenderAvatar message={message} sizeClass="h-7 w-7" textClass="text-[12px]" />
        </div>
        <div className="flex items-center gap-x-2 pl-10 pr-3 pt-2">
          <span className="text-[13px] font-medium" style={{ color: message.color }}>{message.name}</span>
          {ambiguous && <span className="text-[12px] text-ink-faint">{message.client}</span>}
          {message.role && <span className="hidden truncate text-[12px] text-ink-faint sm:inline">{message.role}</span>}
          <span className="text-[12px] text-ink-faint" title={exactTime(message.time)}>{messageTime(message.time, now)}</span>
          <MessageMenu message={message} onReply={onReply} />
        </div>
        <div className={`px-3 pb-2 pt-0.5 ${bodyText}`}>
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {body.trim() && <CollapsibleMessageBody text={body} selfName={selfName} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
      </div>
    </div>
  );
}
