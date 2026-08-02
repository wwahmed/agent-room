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
// Generic expandable-text primitive (design lead): callers provide honest
// semantics — ActivityNote announces a status update, ArtifactCard an output.
export function ClampedNoteBody({ text, expandLabel = 'Show the full status update', dataRole = 'status-body' }: {
  text: string;
  expandLabel?: string;
  dataRole?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  if (!text.trim()) return null;
  return (
    <div data-gate={dataRole} className="mt-1 min-w-0">
      {/* pb-5 reserves ~20px of IN-FLOW clearance inside the card, so the
          44px hit box (anchored to this wrapper's bottom) stays entirely
          within the Activity Note: it covers only the masked tail of line 3
          plus this reserved strip, contributes real height to the card, and
          can never steal taps from the updates control or the next card.
          The gate's disclosure-clearance rule audits exactly these rects. */}
      <div className={`relative ${clamped && !expanded ? 'pb-5' : ''}`}>
        <div ref={ref} className={`msg-note [overflow-wrap:anywhere] ${expanded ? '' : 'line-clamp-3'}`}>{text}</div>
        {clamped && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={expandLabel}
            data-gate="disclosure-more"
            className="absolute bottom-0 right-0 flex h-11 items-start justify-end"
          >
            {/* Deliberate '… Show more' with an opaque tail mask — the
                clamped text must END, not concatenate into the label. */}
            <span className="msg-disclosure flex items-start text-accent">
              <span aria-hidden="true" className="h-full w-8 bg-gradient-to-l from-surface-softer to-transparent" />
              <span className="bg-surface-softer pr-0.5 text-ink-faint">…&nbsp;</span>
              <span className="bg-surface-softer">Show more</span>
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
  /** A historical delivery warning can remain in the transcript after a
   * listener returns. Marking it resolved prevents past truth from reading as
   * a contradictory current alarm. */
  resolved?: boolean;
}

export function ActivityNote({ message, run, now, resolved = false }: Props) {
  const [showEarlier, setShowEarlier] = useState(false);
  const earlier = run && run.length > 1 ? run.slice(0, -1) : [];
  const isDeliveryWarning = message.metadata?.eventType === 'nobody_listening';
  const chip = isDeliveryWarning ? (resolved ? 'Resolved' : 'Waiting') : 'Status';

  return (
    <div id={`msg-${message.id}`} className="px-3 py-1 sm:px-4">
      <div data-gate="status-note" className="mx-auto w-full max-w-[68ch] rounded-lg border border-border-faint bg-surface-softer px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[12px] font-semibold ${
              isDeliveryWarning
                ? resolved
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                  : 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                : 'border-border-faint bg-surface text-ink-soft'
            }`}
            aria-label={isDeliveryWarning ? `Delivery status: ${chip}` : 'Status update'}
          >
            {chip}
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
                data-gate="disclosure-updates"
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
