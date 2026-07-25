import { useRef, useState } from 'react';
import type { Message } from '@agent-room/shared';
import { AttachmentList, systemEventLabel } from './Bubble.js';
import { messageTime } from '../lib/relativeTime.js';
import { MessageMenu } from './MessageMenu.js';
import { EdgeActionRail, HoverActionTray, readActionTreatment } from './MessageActionTray.js';
import { ThumbDownIcon, ThumbUpIcon } from './ThumbIcons.js';
import { CollapsibleMessageBody } from './CollapsibleMessageBody.js';
import { BrandedLogoAvatar, GenericAgentBadge } from './AgentAvatar.js';
import type { AgentBrand } from '../lib/agentBrand.js';

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

// T-111: a chat row with no text, no attachments, and no artifact metadata is
// a storage artifact of a malformed agent send (wrong room_send parameter),
// not a message. Runs of them render as a wall of empty bubbles — the host's
// "blank screen". The server now rejects new ones; this hides the ones
// already stored, so history heals without a data migration. System rows and
// question artifacts always render.
export function hasRenderableContent(m: Message): boolean {
  // T-113: rows stored without a type are participant speech from a raw-send
  // client — treat them as 'msg' so the content check below applies.
  if (m.type && m.type !== 'msg') return true;
  if (m.metadata?.eventType || m.metadata?.questionId) return true;
  const hasText = typeof m.text === 'string' && m.text.trim().length > 0;
  const hasAttachments = Array.isArray(m.attachments) && m.attachments.length > 0;
  return hasText || hasAttachments;
}

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

// T-47: ONE avatar system (host direction 04:14 kept). Known providers show
// their real app mark as the BASE with the participant's colored initials
// chip overlaid — so two Claudes stay distinguishable, which the old
// whole-logo swap lost. Unknown agents keep the colored monogram + bot badge;
// humans stay the plain monogram.
function SenderAvatar({ message, brand, sizeClass = 'h-9 w-9', textClass = 'text-[12px]' }: { message: Message; brand?: AgentBrand | null; sizeClass?: string; textClass?: string }) {
  const agent = message.client === 'cc';
  if (brand && (brand.mark === 'claude' || brand.mark === 'codex' || brand.mark === 'copilot')) {
    return <BrandedLogoAvatar brand={brand} initials={message.initials} color={message.color} sizeClass={sizeClass} />;
  }
  return (
    <div
      className={`relative flex ${sizeClass} flex-shrink-0 select-none items-center justify-center ${textClass} font-bold text-white ${agent ? 'rounded-md' : 'rounded-full'}`}
      style={{ backgroundColor: message.color }}
      aria-hidden="true"
    >
      {message.initials}
      {brand && <GenericAgentBadge />}
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
  /** T-121: toggle an acknowledge/reject reaction on this message. */
  onReact?: (m: Message, kind: 'ack' | 'reject') => void;
  /** T-12: the VIEWER's display name, for the you-were-mentioned highlight. */
  selfName?: string;
  /** T-47: provider brand for the sender (resolved by Room from participant
   *  harness metadata, name fallback), rendered as the avatar base/badge. */
  senderBrand?: AgentBrand | null;
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

// T-121: structured acknowledge/reject chips rendered for EVERYONE under the
// message body. One chip per kind carrying the reactor names in full — agents
// and humans read the same record. Tapping a chip toggles the viewer's own
// reaction of that kind.
function ReactionChips({ message, onReact, selfName }: { message: Message; onReact?: (m: Message, kind: 'ack' | 'reject') => void; selfName?: string }) {
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;
  // T-124 owner ruling: thumbs, not check/cross — a verdict ABOUT the
  // message, not an action on it.
  const kinds: Array<{ kind: 'ack' | 'reject'; glyph: React.ReactNode; label: string }> = [
    { kind: 'ack', glyph: <ThumbUpIcon size={12} />, label: 'Acknowledged by' },
    { kind: 'reject', glyph: <ThumbDownIcon size={12} />, label: 'Rejected by' },
  ];
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5" data-gate="reactions">
      {kinds.map(({ kind, glyph, label }) => {
        const who = reactions.filter(r => r.kind === kind);
        if (who.length === 0) return null;
        const mine = Boolean(selfName && who.some(r => r.name === selfName && r.client === 'web'));
        const names = who.map(r => r.name).join(', ');
        return (
          <button
            key={kind}
            type="button"
            onClick={onReact ? () => onReact(message, kind) : undefined}
            aria-label={`${label} ${names}${onReact ? (mine ? ' — tap to remove yours' : ' — tap to add yours') : ''}`}
            className={`flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] leading-tight transition ${
              kind === 'ack'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
            } ${mine ? 'ring-1 ring-current' : ''} ${onReact ? 'cursor-pointer hover:bg-surface-softer' : 'cursor-default'}`}
          >
            <span aria-hidden="true" className="flex items-center">{glyph}</span>
            <span className="truncate">{names}</span>
          </button>
        );
      })}
    </div>
  );
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

export function MessageRow({ message, self, grouped, ambiguousNames, now, onReply, onJumpToQuote, onReact, selfName, senderBrand }: Props) {
  const body = message.text ?? '';
  const swipe = useSwipeReply(onReply && message.type === 'msg' ? () => onReply(message) : undefined);
  // T-124 prototype flag (default 'legacy' = shipped behavior). When a hover
  // treatment is active, the legacy anchor stays for PHONE only (sm:hidden
  // wrapper) and desktop gets the candidate overlay instead.
  const treatment = readActionTreatment();
  const legacyMenuClass = treatment === 'legacy' ? '' : 'sm:hidden';
  // T-124/T-136: the tray is a CARD child (anchored to the bubble's top-right),
  // so it hugs the card at every width. The rail variant stays a row overlay.
  const cardTray = treatment === 'tray' && message.type === 'msg'
    ? <HoverActionTray message={message} onReact={onReact} onReply={onReply} selfName={selfName} />
    : null;
  const hoverOverlay = treatment === 'rail' && message.type === 'msg'
    ? <EdgeActionRail message={message} onReact={onReact} onReply={onReply} selfName={selfName} mirror={self} />
    : null;

  if (message.type === 'sys') {
    return (
      <div className="flex justify-center px-4 py-0.5">
        <div className="max-w-[90%] rounded-md bg-surface-softer px-2.5 py-1 text-center text-[12px] leading-snug text-ink-faint [overflow-wrap:anywhere]">
          {systemEventLabel(message)}
        </div>
      </div>
    );
  }

  // T-72: heartbeat/status pings never reach this component anymore — Room
  // routes them (run-collapsed) to ActivityNote, whose two-row anatomy cannot
  // squeeze the update text into a vertical ribbon.

  if (self) {
    // Own messages: keep the conversational right alignment, but use the
    // quiet accent-tint surface. Saturated accent is reserved for actions and
    // unread state so a long self-authored message never dominates the feed.
    return (
      <div id={`msg-${message.id}`} {...swipe.bind} className={`group relative flex items-start justify-end gap-1 pl-10 pr-3 sm:pl-16 sm:pr-4 ${grouped ? 'mt-2' : 'mt-6'}`}>
        <SwipeReplyIndicator progress={swipe.progress} />
        {hoverOverlay}
        <div className={`pt-1 ${legacyMenuClass}`}><MessageMenu message={message} onReply={onReply} onReact={onReact} selfName={selfName} /></div>
        <div style={swipe.style} data-gate="msg-content" data-gate-self="true" className="relative z-10 min-w-0 max-w-[88%] break-words rounded-xl rounded-br-md border border-accent/20 bg-accent-tint/40 px-3 py-2 text-ink sm:max-w-[70%] [overflow-wrap:anywhere]">
          {cardTray}
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {/* T-30/T-48: keep 15px type and a deliberate readable measure;
              80ch uses large desktop canvases without turning prose into an
              edge-to-edge scan. */}
          {body.trim() && (
            <div className="msg-prose">
              <CollapsibleMessageBody text={body} selfName={selfName} />
            </div>
          )}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          <ReactionChips message={message} onReact={onReact} selfName={selfName} />
          <div className="msg-meta mt-1 text-right leading-none" title={exactTime(message.time)}>{messageTime(message.time, now)}</div>
        </div>
      </div>
    );
  }

  const ambiguous = ambiguousNames?.has(message.name);

  // T-41 host correction: peers are cards too, but restrained neutral ones.
  // Identity color stays on the avatar/name instead of saturating the whole
  // report and competing with unread/action accents.
  const agentSender = message.client === 'cc';
  // T-56 (host: "wasting space at top", "empty margin on the right"): incoming
  // bubbles are capped-width and left-aligned (pr-* leaves a right margin for
  // the left/right rhythm); the top is tight — a small avatar overlaps the top
  // corner, name + time sit on ONE line (no divider, no wrap), role hidden on
  // mobile.
  const rowClass = 'group relative pl-5 pr-12 sm:pl-6 sm:pr-20';
  const bubbleShape = 'relative z-10 inline-block max-w-full break-words rounded-xl border border-border-faint bg-surface-softer sm:max-w-[80ch] [overflow-wrap:anywhere]';
  // T-41 acceptance sheet: stay on the deliberate token scale. Perceived
  // shouting is solved by flat peer rows and hierarchy, not off-scale thin
  // glyphs that become harder to read on a dark canvas.
  const bodyText = 'msg-prose';

  if (grouped) {
    // Follow-up in a group: a plain capped bubble under the first, no header.
    return (
      <div id={`msg-${message.id}`} {...swipe.bind} className={`${rowClass} mt-2`} title={exactTime(message.time)}>
        <SwipeReplyIndicator progress={swipe.progress} />
        <div data-gate="msg-content" className={`${bubbleShape} px-4 py-3 ${bodyText}`} style={swipe.style}>
          {cardTray}
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {body.trim() && <CollapsibleMessageBody text={body} selfName={selfName} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          <ReactionChips message={message} onReact={onReact} selfName={selfName} />
        </div>
        {hoverOverlay}
        <div className={`absolute right-3 top-1 ${legacyMenuClass}`}><MessageMenu message={message} onReply={onReply} onReact={onReact} selfName={selfName} /></div>
      </div>
    );
  }

  return (
    <div id={`msg-${message.id}`} {...swipe.bind} className={`${rowClass} mt-6`}>
      <SwipeReplyIndicator progress={swipe.progress} />
      {hoverOverlay}
      <div data-gate="msg-content" className={bubbleShape} style={swipe.style}>
        {cardTray}
        {/* T-58 (host: "others on the left", "can barely read the name"): the
            avatar badge sits on the bubble's OUTER (left) edge, overlapping the
            top corner, and is legible-sized. */}
        <div className={`absolute -top-1 -left-2 z-20 ring-2 ring-surface-sunken ${agentSender ? 'rounded-lg' : 'rounded-full'}`}>
          <SenderAvatar message={message} brand={senderBrand} sizeClass="h-8 w-8 sm:h-7 sm:w-7" textClass="text-[13px] sm:text-[12px]" />
        </div>
        <div className="flex items-start gap-x-2 pl-10 pr-3 pt-2">
          {/* T-110: the NAME never letter-stacks. It keeps its content width
              (capped at 60% of the row, then ellipsis); the ROLE is the
              flexible element - min-w-0 lets it actually shrink instead of
              demanding its full text width, which crushed a long name to 1ch
              and break-words then stacked it vertically (host screenshot). */}
          <span className="msg-author max-w-[60%] shrink-0 truncate">{message.name}{senderBrand && <span className="sr-only">, {senderBrand.label}</span>}</span>
          {ambiguous && <span className="msg-meta shrink-0">{message.client}</span>}
          {message.role && <span className="msg-meta hidden min-w-0 flex-1 truncate sm:block">{message.role}</span>}
          {!message.role && <span className="hidden flex-1 sm:block" aria-hidden="true" />}
          <span className="flex-1 sm:hidden" aria-hidden="true" />
          <span className="msg-meta shrink-0 whitespace-nowrap" title={exactTime(message.time)}>{messageTime(message.time, now)}</span>
          <span className={legacyMenuClass}><MessageMenu message={message} onReply={onReply} onReact={onReact} selfName={selfName} /></span>
        </div>
        <div className={`px-4 pb-3 pt-1 ${bodyText}`}>
          {message.replyTo && <ReplyQuote reply={message.replyTo} onJump={onJumpToQuote} />}
          {body.trim() && <CollapsibleMessageBody text={body} selfName={selfName} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          <ReactionChips message={message} onReact={onReact} selfName={selfName} />
        </div>
      </div>
    </div>
  );
}
