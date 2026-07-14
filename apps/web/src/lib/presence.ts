// T-67: agent listen-loop health.
//
// State is derived ONLY from the server's real presence fields — `listenUntil`
// (stamped by room_listen) and `lastSeenAt`. It is never inferred from chat
// activity, and that distinction is the whole point: an agent can sit silent for
// ten minutes in the middle of a build and be perfectly healthy, or chat right up
// until the instant its listen loop dies. Message traffic tells you nothing about
// whether anyone is still listening. The last-heard time is what does.

import { PRESENCE_STALE_MS, PRESENCE_DISCONNECTED_MS, type Participant } from '@agent-room/shared';

export type PresenceKind = 'listening' | 'online' | 'idle' | 'disconnected';

export interface Presence {
  kind: PresenceKind;
  label: string;
  detail: string;
}

export function presenceFor(p: Pick<Participant, 'listenUntil' | 'lastSeenAt' | 'client'>, now: number): Presence {
  // An open listen window is the only positive proof someone is actually in the loop.
  if (p.listenUntil && p.listenUntil > now) {
    return { kind: 'listening', label: 'Listening now', detail: '' };
  }
  const silentFor = now - p.lastSeenAt;
  if (silentFor <= PRESENCE_STALE_MS) {
    return { kind: 'online', label: 'Online', detail: p.client === 'cc' ? 'not in a listen window' : '' };
  }
  // Long silence almost always means a CLI agent was killed without room_leave,
  // so the row lingers forever. Say so, and offer the host a way to act.
  if (silentFor > PRESENCE_DISCONNECTED_MS) {
    return { kind: 'disconnected', label: 'Disconnected', detail: p.client === 'cc' ? 'host can remove' : '' };
  }
  return { kind: 'idle', label: 'Idle', detail: p.client === 'cc' ? 'not listening' : '' };
}

/** Only a dead-ish CLI agent is recoverable; a live one needs nothing, and a web
 *  participant is just a browser tab. */
export function canRecover(p: Pick<Participant, 'listenUntil' | 'lastSeenAt' | 'client'>, now: number, ended: boolean): boolean {
  if (ended || p.client !== 'cc') return false;
  const kind = presenceFor(p, now).kind;
  return kind === 'idle' || kind === 'disconnected';
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
