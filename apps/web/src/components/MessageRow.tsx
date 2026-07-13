import type { Message } from '@agent-room/shared';
import { AttachmentList, MessageText, systemEventLabel } from './Bubble.js';

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

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function SenderAvatar({ message }: { message: Message }) {
  const agent = message.client === 'cc';
  return (
    <div
      className={`flex h-8 w-8 flex-shrink-0 select-none items-center justify-center text-[11px] font-bold text-white ${agent ? 'rounded-lg' : 'rounded-full'}`}
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
}

export function MessageRow({ message, self, grouped, ambiguousNames }: Props) {
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
      <div className={`flex justify-end px-3 sm:px-4 ${grouped ? 'mt-0.5' : 'mt-2.5'}`}>
        <div className="min-w-0 max-w-[88%] sm:max-w-[70%] rounded-xl rounded-br-sm bg-accent px-3.5 py-2 text-white shadow-sm break-words [overflow-wrap:anywhere]">
          {body.trim() && (
            <div className="text-[15px] leading-relaxed">
              <MessageText text={body} />
            </div>
          )}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
          <div className="mt-0.5 text-right text-[10px] leading-none text-white/60">{timeLabel(message.time)}</div>
        </div>
      </div>
    );
  }

  const ambiguous = ambiguousNames?.has(message.name);

  if (grouped) {
    // Follow-up message in a group: no header, body aligns with the
    // text column above (avatar gutter preserved for hover timestamp).
    return (
      <div className="group flex gap-2.5 px-3 py-0.5 hover:bg-surface-softer/60 sm:px-4">
        <div className="w-8 flex-shrink-0 pt-1 text-right text-[9px] leading-none text-ink-faint opacity-0 group-hover:opacity-100">
          {timeLabel(message.time)}
        </div>
        <div className="min-w-0 flex-1 break-words text-[15px] leading-relaxed [overflow-wrap:anywhere]">
          {body.trim() && <MessageText text={body} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="group mt-2.5 flex gap-2.5 px-3 py-0.5 hover:bg-surface-softer/60 sm:px-4">
      <div className="pt-0.5">
        <SenderAvatar message={message} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 leading-tight">
          <span className="text-[15px] font-bold" style={{ color: message.color }}>{message.name}</span>
          {ambiguous && <span className="text-[11px] text-ink-faint">{message.client}</span>}
          {message.role && <span className="truncate text-[11px] text-ink-faint">{message.role}</span>}
          <span className="text-[10px] text-ink-faint">{timeLabel(message.time)}</span>
        </div>
        <div className="mt-0.5 break-words text-[15px] leading-relaxed [overflow-wrap:anywhere]">
          {body.trim() && <MessageText text={body} />}
          {message.attachments?.length ? <AttachmentList attachments={message.attachments} /> : null}
        </div>
      </div>
    </div>
  );
}
