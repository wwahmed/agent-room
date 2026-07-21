import { useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '@agent-room/shared';
import { messageTime } from '../lib/relativeTime.js';

// T-72: Activity Note — the mobile-safe status object. The old one-line flex
// row caged the update text between four shrink-proof spans (chip, name,
// time), so on phones the text column collapsed into a vertical ribbon a few
// characters wide (host: "Why am I seeing this 10px column?"). The note is a
// two-row object instead:
//   row 1: Status chip + readable neutral name + relative time
//   row 2: the update body at FULL note width, clamped to 3 lines with an
//          inline Show more / Show less toggle
// Consecutive heartbeats from the same agent arrive here pre-collapsed
// (lib/statusRuns.ts) and disclose as "N updates".

function exactTime(t: number): string {
  return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// Body clamp with real truncation detection: the toggle renders only when the
// clamped element actually overflows, so short notes stay one quiet block.
// Disclosure grammar (design lead ruling, the reference form for T-65):
// clamped state puts Show more at the bottom-right READING ENDPOINT of the
// faded third line — unboxed inline text, not a detached row. The 44px hit
// target extends into the dead space below the card, never over readable
// text. Expanded Show less right-aligns after the body.
function ClampedNoteBody({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  if (!text.trim()) return null;
  return (
    <div data-gate="status-body" className="mt-1 min-w-0">
      {/* pb-8 reserves in-card dead space under the clamp so the 44px+ hit
          target never sits on readable text — only on the gradient-faded tail
          of line 3 and the reserved gap. */}
      <div className={`relative ${clamped && !expanded ? 'pb-8' : ''}`}>
        <div ref={ref} className={`msg-note [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{text}</div>
        {clamped && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Show the full status update"
            className="absolute bottom-0 right-0 flex h-14 items-start justify-end"
          >
            <span className="msg-disclosure bg-gradient-to-l from-surface-softer from-55% to-transparent pl-10 text-accent">
              Show more
            </span>
          </button>
        )}
      </div>
      {expanded && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="msg-disclosure -mr-2 flex h-11 items-center px-2 text-accent transition hover:opacity-80"
          >
            Show less
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  /** The newest ping of its run (or a standalone ping). */
  message: Message;
  /** Full run oldest-first when >= 2 consecutive same-agent pings collapsed. */
  run?: Message[];
  now?: number;
}

export function ActivityNote({ message, run, now }: Props) {
  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = run && run.length > 1 ? run.slice(0, -1) : [];

  return (
    <div id={`msg-${message.id}`} className="px-3 py-1 sm:px-4">
      <div data-gate="status-note" className="mx-auto w-full max-w-[68ch] rounded-lg border border-border-faint bg-surface-softer px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap rounded border border-border-faint bg-surface px-1.5 py-0.5 text-[12px] font-semibold text-ink-soft" aria-label="Status update">
            Status
          </span>
          {/* Readable neutral name: identity color stays on avatars per the
              design lead's ruling; a status header never carries tinted ink. */}
          <span className="msg-author min-w-0 truncate">{message.name}</span>
          <span className="msg-meta ml-auto shrink-0 whitespace-nowrap" title={exactTime(message.time)}>
            {messageTime(message.time, now)}
          </span>
        </div>
        <ClampedNoteBody text={message.text ?? ''} />
        {earlier.length > 0 && (
          <div className="mt-0.5">
            {/* Same disclosure grammar: right endpoint, unboxed, one dialect. */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowEarlier(v => !v)}
                aria-expanded={showEarlier}
                className="msg-disclosure -mr-2 flex h-11 items-center gap-1 px-2 text-ink-soft transition hover:text-ink"
              >
                <span aria-hidden="true" className={`transition-transform ${showEarlier ? 'rotate-90' : ''}`}>›</span>
                {run!.length} updates
              </button>
            </div>
            {showEarlier && (
              <ol className="mt-1 flex flex-col gap-2 border-l-2 border-border-faint pl-3">
                {earlier.map(m => (
                  <li key={m.id} id={`msg-${m.id}`} className="min-w-0">
                    <span className="msg-meta block" title={exactTime(m.time)}>{messageTime(m.time, now)}</span>
                    <ClampedNoteBody text={m.text ?? ''} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
