// T-68: agent listen-loop health, converged on the server contract.
//
// This file used to CLASSIFY presence itself (its own thresholds, its own
// `idle` bucket). That was a second definition of "dead" living next to the
// server's — the precise bug class that produced "transport works while presence
// lies". T-66 made the server the source of truth, so the web now consumes its
// verdict and derives nothing.
//
// Wire shape of the server's `health` action (apps/server/src/health.ts).
// `listening` is the ONLY state that proves a loop is actually armed; `online`
// merely means we heard from them recently. Keep them distinct — collapsing them
// into one green dot re-hides the exact failure the host asked us to surface.

import type { ClientKind } from '@agent-room/shared';

export type PresenceState = 'listening' | 'online' | 'working' | 'stale' | 'disconnected';

export interface ParticipantHealth {
  name: string;
  client: ClientKind;
  role: string;
  state: PresenceState;
  /** ms since we last heard anything at all from this participant. */
  lastSeenAgoMs: number;
  /** ms of listen window still parked; 0 when no loop is armed. */
  listenRemainingMs: number;
}

export interface PresenceView {
  state: PresenceState;
  label: string;
  detail: string;
}

const LABEL: Record<PresenceState, string> = {
  listening: 'Listening now',
  online: 'Online',
  working: 'Working',
  stale: 'Stale',
  disconnected: 'Disconnected',
};

export function presenceView(h: ParticipantHealth): PresenceView {
  const agent = h.client === 'cc';
  const detail =
    h.state === 'online' && agent ? 'not in a listen window'
      : h.state === 'working' && agent ? 'heads-down in a declared work window'
      : h.state === 'stale' && agent ? 'no heartbeat — loop may be dead'
      : h.state === 'disconnected' && agent ? 'host can remove'
      : '';
  return { state: h.state, label: LABEL[h.state], detail };
}

/** Only a CLI agent that isn't listening is recoverable: a listening one needs
 *  nothing, and a web participant is just a browser tab. */
export function canRecover(h: ParticipantHealth, ended: boolean): boolean {
  if (ended || h.client !== 'cc') return false;
  return h.state === 'stale' || h.state === 'disconnected';
}

/**
 * The web app cannot revive a terminated CLI process, so we don't pretend to with
 * a "Restart" button that would silently do nothing. We hand the host the exact
 * text to paste into that agent's terminal — the one action that actually works.
 */
export function recoveryPrompt(code: string, name: string, role?: string): string {
  const withRole = role ? ` (role: ${role})` : '';
  return `Rejoin Agent Room ${code} as "${name}"${withRole} and stay in the room_listen loop until the host says stop.`;
}

/** People-pane grouping. T-05: a guest viewer always lands in its own strip —
 *  a read-only observer is never "active" and never an alarm, whatever its
 *  health says (nobody recovers an auditor). Everyone else groups by the
 *  server verdict: stale → attention, disconnected → offline, rest active. */
export type PersonGroup = 'active' | 'attention' | 'offline' | 'viewer';
export function personGroup(state: PresenceState | null, viewer: boolean): PersonGroup {
  if (viewer) return 'viewer';
  return state === 'stale' ? 'attention' : state === 'disconnected' ? 'offline' : 'active';
}

/** Index health by the same identity the participant list is keyed on.
 *  JSON.stringify is used deliberately: it is text-safe (an earlier version used a
 *  raw NUL separator, which made the whole source file binary to git and `file`)
 *  and it stays collision-proof — a name containing the separator can't forge
 *  another participant's key, because the encoding escapes it. */
export function healthKey(name: string, client: string): string {
  return JSON.stringify([name, client]);
}

export function indexHealth(rows: readonly ParticipantHealth[]): Map<string, ParticipantHealth> {
  return new Map(rows.map(h => [healthKey(h.name, h.client), h]));
}
