import type { Participant } from '@agent-room/shared';

// T-66: per-participant listen-loop health.
//
// Agent presence is NOT self-healing: the listen loop is driven by the agent's
// turn, so a usage-limit pause or a dead process stops it silently. The room
// identity survives, nobody is listening, and from the outside that is
// indistinguishable from an agent that is simply thinking. This is the surface
// that stops presence from lying.
//
// Thresholds are lifted verbatim from scripts/room-health.mjs (ProdMgr-Codex's
// CLI) ON PURPOSE — the failure mode we keep hitting is two components with
// subtly different ideas of "dead", so there is exactly one definition and both
// callers import it.
export const PRESENCE_STALE_MS = 60_000;
export const PRESENCE_DISCONNECTED_MS = 300_000;

export type PresenceState = 'listening' | 'online' | 'stale' | 'disconnected';

export interface ParticipantHealth {
  name: string;
  client: Participant['client'];
  role: string;
  state: PresenceState;
  /** ms since we last heard anything at all from this participant. */
  lastSeenAgoMs: number;
  /** ms of listen window still parked; 0 when no loop is armed. */
  listenRemainingMs: number;
}

// `listening` is the only state that proves a loop is actually ARMED — the
// participant has a blocking listen call parked right now. Everything else is
// inferred from how long ago we last heard from them, which is why a
// participant can be "online" (recently sent a message) while having no
// listener at all. That gap is exactly the "transport works while presence
// lies" failure, so the two signals stay separate rather than collapsing into
// a single boolean.
export function presenceState(p: Participant, now: number): PresenceState {
  if (Number(p.listenUntil || 0) > now) return 'listening';
  const age = Math.max(0, now - Number(p.lastSeenAt || 0));
  if (age <= PRESENCE_STALE_MS) return 'online';
  if (age <= PRESENCE_DISCONNECTED_MS) return 'stale';
  return 'disconnected';
}

// Built from room-visible fields only. No memberKeyHash / authIdHash /
// agentIdHash ever appears here — this payload is handed to every member, and
// the whole T-66 redaction pass exists because we were shipping those.
export function participantHealth(p: Participant, now: number): ParticipantHealth {
  return {
    name: p.name,
    client: p.client,
    role: p.role,
    state: presenceState(p, now),
    lastSeenAgoMs: Math.max(0, now - Number(p.lastSeenAt || 0)),
    listenRemainingMs: Math.max(0, Number(p.listenUntil || 0) - now),
  };
}

export function roomHealth(participants: Participant[], now: number): ParticipantHealth[] {
  return participants.map((p) => participantHealth(p, now));
}
