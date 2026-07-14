import { useRef, useState } from 'react';
import type { Message } from '@agent-room/shared';
import { AttachmentList, MessageText, systemEventLabel } from './Bubble.js';
import { messageTime } from '../lib/relativeTime.js';
import { MessageMenu } from './MessageMenu.js';

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

function SenderAvatar({ message, sizeClass = 'h-9 w-9', textClass = 'text-[11px]' }: { message: Message; sizeClass?: string; textClass?: string }) {
  const agent = message.client === 'cc';
  const logo = agent ? AGENT_LOGOS[message.name.trim().toLowerCase()] : undefined;
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
      <span className={`text-[11px] font-semibold ${onDark ? 'text-white/90' : 'text-accent-deep'}`}>{reply.name}</span>
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

export function MessageRow({ message, self, grouped, ambiguousNames, now, onReply, onJumpToQuote }: Props) {
  const body = message.text ?? '';
  const swipe = useSwipeReply(onReply && message.type === 'msg' ? () => onReply(message) : undefined);

  if (message.type === 'sys') {
    return (
      <div className="flex justify-center px-4 py-0.5">
        <div className="max-w-[90%] rounded-md bg-surface-softer px-2.5 py-1 text-center text-[11px] leading-snug text-ink-faint [overflow-wrap:anywhere]">
          {systemEventLabel(message)}
        </div>
      </div>
    );
  }

  if (self) {
    // Own messages: subtle right alignment, compact tinted block, no
    // avatar/name (you know who you are). Timestamp inside, quiet.
    return (
      <div id={`msg-${message.id}`} {...swipe.bind} className={`group relative flex items-start justify-end gap-1 pl-10 pr-3 sm:pl-16 sm:pr-4 ${grouped ? 'mt-0.5' : 'mt-3'}`}>
        <SwipeReplyIndicator progress={swipe.progress} />
        <div className="pt-1"><MessageMenu message={message} onReply={onReply} /></div>
        <div style={swipe.style} className="relative z-10 min-w-0 max-w-[88%] sm:max-w-[70%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-white shadow-sm break-words [overflow-wrap:anywhere]">
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} onDark />}
          {body.trim() && (
            <div className="text-[16px] leading-[1.7] sm:text-[15px] sm:leading-[1.75]">
              <MessageText text={body} />
            </div>
          )}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          <div className="mt-0.5 text-right text-[10px] leading-none text-white/60" title={exactTime(message.time)}>{messageTime(message.time, now)}</div>
        </div>
      </div>
    );
  }

  const ambiguous = ambiguousNames?.has(message.name);

  // Host feedback ("you guys have boxes, you should have bubbles too"): every
  // incoming sender now gets a rounded chat bubble in their own identity color
  // (soft tinted fill + faint colored border), left-aligned beside the avatar,
  // separated by white space — mirroring the host's own message bubbles. The
  // tint stays low-saturation so long technical text keeps full contrast.
  const bubble = { backgroundColor: `${message.color}1f`, borderColor: `${message.color}3d` };
  const agentSender = message.client === 'cc';
  // T-56 (host: "wasting space at top", "empty margin on the right"): incoming
  // bubbles are capped-width and left-aligned (pr-* leaves a right margin for
  // the left/right rhythm); the top is tight — a small avatar overlaps the top
  // corner, name + time sit on ONE line (no divider, no wrap), role hidden on
  // mobile.
  const rowClass = 'group relative pl-3 pr-10 sm:pr-16';
  const bubbleShape = 'relative z-10 inline-block max-w-full break-words rounded-2xl border sm:max-w-[86%] [overflow-wrap:anywhere]';
  const bodyText = 'text-[16px] leading-[1.55] sm:text-[15px] sm:leading-[1.6]';

  if (grouped) {
    // Follow-up in a group: a plain capped bubble under the first, no header.
    return (
      <div id={`msg-${message.id}`} {...swipe.bind} className={`${rowClass} mt-0.5`} title={exactTime(message.time)}>
        <SwipeReplyIndicator progress={swipe.progress} />
        <div className={`${bubbleShape} px-3.5 py-2 ${bodyText}`} style={{ ...bubble, ...swipe.style }}>
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {body.trim() && <MessageText text={body} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
        <div className="absolute right-3 top-1"><MessageMenu message={message} onReply={onReply} /></div>
      </div>
    );
  }

  return (
    <div id={`msg-${message.id}`} {...swipe.bind} className={`${rowClass} mt-3`}>
      <SwipeReplyIndicator progress={swipe.progress} />
      <div className={bubbleShape} style={{ ...bubble, ...swipe.style }}>
        {/* small avatar badge overlapping the bubble's top-right corner */}
        <div className={`absolute -top-2 right-1 z-20 ring-2 ring-surface-sunken ${agentSender ? 'rounded-md' : 'rounded-full'}`}>
          <SenderAvatar message={message} sizeClass="h-6 w-6" textClass="text-[9px]" />
        </div>
        <div className="flex items-center gap-x-2 px-3.5 pr-9 pt-1.5">
          <span className="text-[13px] font-bold" style={{ color: message.color }}>{message.name}</span>
          {ambiguous && <span className="text-[10px] text-ink-faint">{message.client}</span>}
          {message.role && <span className="hidden truncate text-[10px] text-ink-faint sm:inline">{message.role}</span>}
          <span className="text-[10px] text-ink-faint" title={exactTime(message.time)}>{messageTime(message.time, now)}</span>
          <MessageMenu message={message} onReply={onReply} />
        </div>
        <div className={`px-3.5 pb-2 pt-0.5 ${bodyText}`}>
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {body.trim() && <MessageText text={body} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
      </div>
    </div>
  );
}
