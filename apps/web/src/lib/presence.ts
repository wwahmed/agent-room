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
  /** T-30 (client-build): build stamp of the bundle this agent's PROCESS loaded. */
  clientBuildAt?: number;
  /** T-30 (client-build): ms that running code trails the newest build the room
   *  can prove exists. Absent/0 = current, or no evidence either way. */
  clientBehindMs?: number;
  /** T-30 (client-build): the agent reported no build stamp while the beacon is
   *  operational — its client predates build reporting. A known-unknown, kept
   *  separate from the measured gap above. */
  clientBuildUnknown?: true;
}

/** T-30 (client-build): is this row executing pre-deploy code? Deliberately
 *  independent of presence — a stale-BUILD agent is usually perfectly alive,
 *  which is exactly why it goes unnoticed. The server owns the threshold (it
 *  holds the watermark); the web only asks whether it reported a gap, so the
 *  two components can never disagree about what "behind" means. */
export function clientOutdated(h: ParticipantHealth | null | undefined): boolean {
  return Boolean(h && h.client === 'cc' && Number(h.clientBehindMs) > 0);
}

/** T-30 (client-build): the client is old enough that it does not report its
 *  build at all. Same remedy as an outdated one (restart), different claim — so
 *  the copy says "unknown", never a delta we cannot measure. */
export function clientBuildUnknown(h: ParticipantHealth | null | undefined): boolean {
  return Boolean(h && h.client === 'cc' && h.clientBuildUnknown === true);
}

/** Either reason to restart an agent's process. Presence-independent: none of
 *  this means the agent is unhealthy, only that it is running yesterday's code. */
export function clientNeedsRestart(h: ParticipantHealth | null | undefined): boolean {
  return clientOutdated(h) || clientBuildUnknown(h);
}

/** Coarse, honest phrasing for a build gap. Rounded DOWN to the unit — "3h
 *  behind" must never overstate the gap it is asking someone to act on. */
export function behindLabel(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m behind`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h behind`;
  return `${Math.floor(hours / 24)}d behind`;
}

/** The only action that lands a new client: the agent's process must restart.
 *  Same shape as recoveryPrompt() — text the host can paste into that agent's
 *  terminal — because "restart" is not a button the web app can press. */
export function restartForBuildPrompt(code: string, name: string): string {
  return `Exit this session and start a fresh one, then rejoin Agent Room ${code} as "${name}" and stay in the room_listen loop. Your current process is running an older Agent Room client build; only a new process picks up the fixed one.`;
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
  // T-29: the prompt also teaches the habit that PREVENTS the next nudge — a
  // heads-down agent that never pings reads as disconnected after 5 minutes,
  // so every recovery doubles as the lesson (room_status arms T-04's honest
  // `working` window). Byte-identical to the summoner's injected copy.
  return `Rejoin Agent Room ${code} as "${name}"${withRole} and stay in the room_listen loop until the host says stop. During long work, send a room_status ping every few minutes so the room can tell you are busy instead of dead.`;
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
