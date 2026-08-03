import { useState } from 'react';
import { respondToAgentPrompt, type PromptRespondVerb, type SummonedAgent } from '../lib/api.js';

// A summoned agent stopped on its harness's permission dialog is BLOCKED: it
// cannot do the work it was asked for until a human answers. That answer used
// to live only inside the Agent details sheet — two taps away, behind a row
// the owner had no reason to open, on a screen he was not looking at. The
// host's report: "Permissions prompt from summoned agents go into agent
// details instead of prominently pinned as chat footer."
//
// So it is pinned directly above the composer, where he is already looking and
// already typing. Deliberately NOT a toast: a toast expires, and this is a
// state that persists until someone answers it.

interface Props {
  /** Every summoned agent for this room; this component picks the blocked ones. */
  agents: SummonedAgent[] | null;
  /** Re-pull agents after an answer so the footer clears (or advances to the
   *  next pending prompt) without waiting for the next poll. */
  onAnswered?: () => void;
}

export function blockedAgents(agents: SummonedAgent[] | null): SummonedAgent[] {
  if (!agents) return [];
  return agents.filter(a => a && a.health === 'blocked-on-prompt' && !a.dismissedAt);
}

export function AgentPromptFooter({ agents, onAnswered }: Props) {
  const blocked = blockedAgents(agents);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Index into the blocked list — with several agents stuck, answer them one at
  // a time rather than stacking N cards over the conversation.
  const [index, setIndex] = useState(0);

  if (blocked.length === 0) return null;
  const current = blocked[Math.min(index, blocked.length - 1)]!;
  const responding = busyId === current.agentId;

  async function respond(verb: PromptRespondVerb) {
    if (responding) return;
    setBusyId(current.agentId);
    setError(null);
    try {
      await respondToAgentPrompt(current.agentId, verb);
      setIndex(0);
      onAnswered?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not deliver the answer.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      data-gate="agent-prompt-footer"
      role="alert"
      aria-live="assertive"
      className="pointer-events-auto mx-2 mb-2 rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 shadow-lg backdrop-blur sm:mx-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[13px] font-bold text-amber-300">
          {current.name} needs your permission
        </span>
        {blocked.length > 1 && (
          <span className="text-[12px] font-semibold text-ink-faint">
            {blocked.length - 1} other agent{blocked.length - 1 === 1 ? '' : 's'} also waiting
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">
        It is stopped on its harness&apos;s own safety prompt and cannot continue until you answer.
      </p>
      {current.promptPreview && (
        // Clamped hard: this sits over the conversation, so a long prompt must
        // not push the chat off screen. The full text stays in the details sheet.
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[12px] leading-snug text-ink-soft">
          {current.promptPreview}
        </pre>
      )}
      {error && (
        <p role="status" className="mt-2 rounded-lg bg-surface-softer px-2.5 py-1.5 text-[12px] text-ink-soft">{error}</p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={responding}
          onClick={() => { void respond('approve'); }}
          className="min-h-11 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50 sm:flex-none"
        >
          {responding ? 'Sending…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={responding}
          onClick={() => { void respond('approve-always'); }}
          className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold transition hover:border-accent disabled:opacity-50"
        >
          Always allow
        </button>
        <button
          type="button"
          disabled={responding}
          onClick={() => { void respond('deny'); }}
          className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-red-300 transition hover:border-red-400/60 disabled:opacity-50"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
