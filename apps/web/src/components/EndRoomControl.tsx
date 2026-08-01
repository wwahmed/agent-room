// P0 End truthfulness — one shared implementation for every End surface.
//
// Room.tsx has three places that can end a room (settings Danger, the idle
// prompt, and the header's `onEndRoom`). Duplicating the rule in each is how
// the original defect survived: the catch in one of them set ended=true on
// every failure. `useEndRoom` is the single source — Room calls it once and
// passes the result to all three, so there is no second copy to drift.

import { useRef, useState } from 'react';
import { endOutcome, canOfferEnd } from '../lib/endRoomOutcome.js';

export interface EndRoomState {
  /** True only when the viewer may end this room. */
  canEnd: boolean;
  /** In-flight; drives disabled state on every surface. */
  busy: boolean;
  /** Safe, actionable failure text. Null when there is nothing to report. */
  error: string | null;
  /** Idempotent while in flight. Never transitions except on real success. */
  endRoom: () => Promise<EndRoomAttempt>;
}

export type EndRoomAttempt = 'ended' | 'failed' | 'ignored';

export function useEndRoom(opts: {
  isHost: boolean;
  /** Resolves on authoritative success; rejects on refusal/network/parse. */
  onEnd: () => Promise<void>;
  /** Called only after an authoritative success. */
  onEnded: () => void;
}): EndRoomState {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not the state above: `setBusy(true)` does not apply until React
  // re-renders, so two clicks in the same tick would both read busy === false
  // and both fire a request. The state only drives the disabled attribute.
  const inFlight = useRef(false);

  async function endRoom() {
    if (inFlight.current) return 'ignored' as const;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    try {
      await opts.onEnd();
      opts.onEnded();
      return 'ended' as const;
    } catch (e) {
      const outcome = endOutcome({ thrown: e });
      if (outcome.ended) {
        opts.onEnded();
        return 'ended' as const;
      }
      setError(outcome.error);
      return 'failed' as const;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { canEnd: canOfferEnd(opts.isHost), busy, error, endRoom };
}

/**
 * The one shared End failure announcement. Room mounts this in persistent
 * chrome outside every tab panel and scroll container, so a Settings or header
 * failure remains visible regardless of the selected destination.
 */
export function EndRoomAlert({
  state,
  mobileHeaderOffset = false,
}: {
  state: Pick<EndRoomState, 'error'>;
  /** Phone Chat is full-bleed under a fixed 96px header; clear it explicitly. */
  mobileHeaderOffset?: boolean;
}) {
  if (!state.error) return null;
  return (
    <div
      data-room-persistent-end-alert=""
      className={`w-full flex-shrink-0 px-2 py-2 sm:px-3 ${mobileHeaderOffset ? 'mt-[96px] sm:mt-0' : ''}`}
    >
      <div
        role="alert"
        data-end-error=""
        className="mx-auto w-full max-w-2xl rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-300"
      >
        {state.error}
      </div>
    </div>
  );
}

/** Presentational End button + its failure surface. Holds no logic of its own. */
export function EndRoomControl({
  state, label = 'End meeting', className = '', hideError = false,
}: { state: EndRoomState; label?: string; className?: string; hideError?: boolean }) {
  if (!state.canEnd) return null;
  // A bare fragment made the error a horizontal flex sibling of the action
  // buttons wherever this sits inside a `flex` row. When this renders its own
  // error it owns a block wrapper so the message is a full-width row ABOVE the
  // control; with `hideError` it stays a bare button so callers can place it in
  // their own row. `hideError` is for screens with ONE shared alert covering
  // every End surface — including surfaces that render no control at all.
  if (hideError || !state.error) {
    return (
      <button
        type="button"
        onClick={() => { void state.endRoom(); }}
        disabled={state.busy}
        aria-busy={state.busy}
        className={className}
      >
        {state.busy ? 'Ending…' : label}
      </button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <p role="alert" className="w-full text-xs text-red-300">{state.error}</p>
      <button
        type="button"
        onClick={() => { void state.endRoom(); }}
        disabled={state.busy}
        aria-busy={state.busy}
        className={className}
      >
        {state.busy ? 'Ending…' : label}
      </button>
    </div>
  );
}
