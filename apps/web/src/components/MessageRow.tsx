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
}

// Exact clock for the hover/title tooltip — precise time behind the relative label.
function exactTime(t: number): string {
  return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function MessageRow({ message, self, grouped, ambiguousNames, now }: Props) {
  const body = message.text ?? '';

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
      <div className={`group flex items-start justify-end gap-1 px-3 sm:px-4 ${grouped ? 'mt-1' : 'mt-4'}`}>
        <div className="pt-1"><MessageMenu message={message} /></div>
        <div className="min-w-0 max-w-[88%] sm:max-w-[70%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-white shadow-sm break-words [overflow-wrap:anywhere]">
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
  const headerBorder = { borderColor: `${message.color}33` };
  const bodyClass =
    'break-words px-3.5 py-2.5 text-[16px] leading-[1.7] sm:text-[15px] sm:leading-[1.75] [overflow-wrap:anywhere]';

  if (grouped) {
    // Follow-up in a group: a plain full-width bubble under the first, no
    // header; hover reveals the exact time.
    return (
      <div className="group relative mt-1 px-3 sm:px-4" title={exactTime(message.time)}>
        <div className={`rounded-2xl border ${bodyClass}`} style={bubble}>
          {body.trim() && <MessageText text={body} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
        <div className="absolute right-4 top-1 sm:right-5"><MessageMenu message={message} /></div>
      </div>
    );
  }

  // T-50 (host: "give bubbles maximum width"): the avatar + name + time live in
  // a header row INSIDE the top of the bubble (divider under it), so the bubble
  // spans the full reading width instead of surrendering a left avatar gutter.
  return (
    <div className="group mt-4 px-3 sm:px-4">
      <div className="overflow-hidden rounded-2xl border" style={bubble}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-3.5 pt-2 pb-1.5" style={headerBorder}>
          <SenderAvatar message={message} sizeClass="h-6 w-6" textClass="text-[10px]" />
          <span className="text-[14px] font-bold sm:text-[15px]" style={{ color: message.color }}>{message.name}</span>
          {ambiguous && <span className="text-[11px] text-ink-faint">{message.client}</span>}
          {message.role && <span className="truncate text-[11px] text-ink-faint">{message.role}</span>}
          <span className="ml-auto flex-shrink-0 text-[10px] text-ink-faint" title={exactTime(message.time)}>{messageTime(message.time, now)}</span>
          <MessageMenu message={message} />
        </div>
        <div className={bodyClass}>
          {body.trim() && <MessageText text={body} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
      </div>
    </div>
  );
}
