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

// T-04: declared work window. A room_status ping or task claim buys this much
// "working" time by default; a caller may declare longer but never past the
// cap — a crashed agent that pinged once must not look busy forever.
export const WORKING_WINDOW_MS = 600_000;
export const WORKING_WINDOW_CAP_MS = 1_800_000;

/** Clamp a declared work window to [now, now + cap]. Non-finite / past
 *  requests fall back to the default window. */
export function clampWorkingUntil(now: number, requestedUntil?: number): number {
  const req = Number(requestedUntil);
  const fallback = now + WORKING_WINDOW_MS;
  if (!Number.isFinite(req) || req <= now) return fallback;
  return Math.min(req, now + WORKING_WINDOW_CAP_MS);
}

export type PresenceState = 'listening' | 'online' | 'working' | 'stale' | 'disconnected';

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
// T-143: the best evidence of "last heard" is an explicit lastSeenAt; a
// just-joined row with no heartbeat yet still has a joinedAt and is present, not
// ancient. Returns 0 ONLY when we genuinely have nothing — callers must never
// treat that 0 as an epoch-0 wall-clock (that produced "last heard 1969").
export function effectiveLastSeen(p: Participant): number {
  const seen = Number(p.lastSeenAt || 0);
  if (seen > 0) return seen;
  const joined = Number(p.joinedAt || 0);
  return joined > 0 ? joined : 0;
}

export function presenceState(p: Participant, now: number): PresenceState {
  if (Number(p.listenUntil || 0) > now) return 'listening';
  // T-04: an unexpired declared work window outranks the silence clock — a
  // heads-down agent is working, not decaying. Expiry falls straight through
  // to the age ladder below, so the alarm is deferred, never disabled.
  if (Number(p.workingUntil || 0) > now) return 'working';
  const seen = effectiveLastSeen(p);
  // No timestamp at all: the loop is not armed and we have no proof of life, so
  // it is disconnected — but the AGE is unknown (see participantHealth), never
  // a 56-year span computed from epoch 0.
  if (seen <= 0) return 'disconnected';
  const age = Math.max(0, now - seen);
  if (age <= PRESENCE_STALE_MS) return 'online';
  if (age <= PRESENCE_DISCONNECTED_MS) return 'stale';
  return 'disconnected';
}

// Built from room-visible fields only. No memberKeyHash / authIdHash /
// agentIdHash ever appears here — this payload is handed to every member, and
// the whole T-66 redaction pass exists because we were shipping those.
export function participantHealth(p: Participant, now: number): ParticipantHealth {
  const seen = effectiveLastSeen(p);
  return {
    name: p.name,
    client: p.client,
    role: p.role,
    state: presenceState(p, now),
    // -1 signals "unknown" — no timestamp exists, so the UI must render "unknown"
    // rather than a wall-clock (now - 0 -> the epoch -> "1969"). Real ages are >= 0.
    lastSeenAgoMs: seen > 0 ? Math.max(0, now - seen) : -1,
    listenRemainingMs: Math.max(0, Number(p.listenUntil || 0) - now),
  };
}

export function roomHealth(participants: Participant[], now: number): ParticipantHealth[] {
  return participants.map((p) => participantHealth(p, now));
}
