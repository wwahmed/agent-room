import { useState } from 'react';
import { copyText } from '../lib/copy.js';
import { bringAgentBack, type SummonedAgent } from '../lib/api.js';
import { menuPosition, useContextMenuTrigger, useDismissOnOutside } from '../lib/contextMenuTrigger.js';
import { agentStatusView, recoveryLadder, reviveCapability } from '../lib/agentRecovery.js';
import { recoveryPrompt, type ParticipantHealth } from '../lib/presence.js';

// Right-click (desktop) or long-press (touch) on an agent anywhere it is
// listed. The host asked for this after waking an agent by hand: opening a
// terminal, finding the right session, and pasting a prompt, for something the
// app already knew how to do itself.
//
// The menu does not invent its own opinion about what to offer — it renders
// `recoveryLadder()`, so the People pane, the details sheet, and this menu can
// never disagree about whether an agent can be brought back or what to try
// first.

export interface AgentMenuTarget {
  name: string;
  role?: string;
  client: string;
}

/** Press handling for an agent row; same gestures as a room card. */
export function useAgentRowMenu() {
  return useContextMenuTrigger<AgentMenuTarget>();
}

const STATUS_TONE: Record<string, string> = {
  listening: 'text-emerald-300',
  online: 'text-ink-soft',
  working: 'text-sky-300',
  stale: 'text-amber-300',
  disconnected: 'text-red-300',
};

export function AgentContextMenu({
  menu, code, health, agent, isHost = false, ended = false,
  onClose, onOpenDetails, onRemove, onChanged,
}: {
  menu: AgentMenuTarget & { x: number; y: number };
  code: string;
  health?: ParticipantHealth | null;
  /** The summoner's record, when this agent is one we launched. */
  agent?: SummonedAgent | null;
  isHost?: boolean;
  ended?: boolean;
  onClose: () => void;
  onOpenDetails: () => void;
  onRemove?: () => void;
  /** Refresh the hosting list once something actually changed. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useDismissOnOutside(onClose);

  const status = health ? agentStatusView(health) : null;
  const ladder = recoveryLadder({ health, agent, ended, isHost });
  const capability = reviveCapability(agent);
  const step = (id: string) => ladder.steps.find(s => s.id === id);
  const waitStep = step('wait');
  const bringBack = step('bring-back');
  const manual = step('manual');

  async function onBringBack() {
    if (!capability.ok || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await bringAgentBack(capability.agentId, capability.mode);
      const { showToast } = await import('./Toast.js');
      showToast(`Bringing ${menu.name} back — it should rejoin in a few seconds.`);
      onChanged();
      onClose();
    } catch (e) {
      // The summoner's own words are more accurate than a generic failure.
      setNote(e instanceof Error ? e.message : 'Could not bring the agent back.');
      setBusy(false);
    }
  }

  const item = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink disabled:opacity-50';
  const glyph = (d: string) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  return (
    <div
      role="menu"
      aria-label={`Actions for ${menu.name}`}
      data-gate="agent-context-menu"
      className="fixed z-50 w-[248px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
      style={menuPosition(menu, 256, 300)}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5">
        <div className="truncate text-[13px] font-semibold text-ink">{menu.name}</div>
        {status && (
          <div className={`mt-0.5 text-[12px] font-medium ${STATUS_TONE[status.state] ?? 'text-ink-faint'}`}>
            {status.label}
          </div>
        )}
      </div>

      {/* Waiting is a real answer, and it used to be the one the UI never gave.
          It leads for a quiet agent so nobody interrupts a long task. */}
      {waitStep && (
        <p className="mx-3 mb-1 rounded-lg bg-surface-softer/60 px-2.5 py-1.5 text-[12px] leading-snug text-ink-soft" data-gate="agent-menu-wait">
          {waitStep.detail}
        </p>
      )}

      {bringBack && (
        <button
          type="button"
          role="menuitem"
          data-gate="agent-menu-bring-back"
          disabled={busy}
          className={item}
          onClick={() => void onBringBack()}
        >
          {glyph('M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3')}
          {busy ? 'Bringing it back…' : bringBack.title}
        </button>
      )}

      {/* When the app genuinely cannot do it, say why once, here, instead of
          offering a button that fails. */}
      {ladder.needed && ladder.blocked && manual && (
        <p className="mx-3 mb-1 rounded-lg bg-surface-softer/60 px-2.5 py-1.5 text-[12px] leading-snug text-ink-soft" data-gate="agent-menu-blocked">
          {manual.detail}
        </p>
      )}

      <button type="button" role="menuitem" className={item} onClick={() => { onClose(); onOpenDetails(); }}>
        {glyph('M8 7.5v4M8 4.5h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z')}Agent details
      </button>

      {/* The terminal path stays available for the host who wants it, but it is
          no longer the headline instruction once the app can do the job. */}
      {ladder.needed && manual && (
        <button
          type="button"
          role="menuitem"
          data-gate="agent-menu-manual"
          className={item}
          onClick={() => {
            onClose();
            void copyText(
              recoveryPrompt(code, menu.name, menu.role),
              'Message copied — paste it into that agent\'s terminal',
            );
          }}
        >
          {glyph('M6.5 9.5 9.5 6.5M7.5 4.75 9 3.25a2.65 2.65 0 0 1 3.75 3.75L11.25 8.5M8.5 11.25 7 12.75a2.65 2.65 0 0 1-3.75-3.75L4.75 7.5')}
          Copy wake message
        </button>
      )}

      {isHost && onRemove && (
        <>
          <div className="mx-3 my-1 h-px bg-border-faint" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            data-gate="agent-menu-remove"
            className={`${item} text-red-300 hover:text-red-200`}
            onClick={() => { onClose(); onRemove(); }}
          >
            {glyph('M3 4.5h10M6.5 4.5V3.5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5v8a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-8')}
            Remove from room
          </button>
        </>
      )}

      {note && (
        <p role="status" className="mx-3 my-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[12px] leading-snug text-red-300" data-gate="agent-menu-error">
          {note}
        </p>
      )}
    </div>
  );
}
