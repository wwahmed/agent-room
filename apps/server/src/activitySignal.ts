// T-43: "last activity" means the conversation moved, not that something twitched.
//
// The room list is ordered by last activity and shows a relative age per room. Both
// were being driven by ANY append, including presence noise: a `[STATUS] Still
// present and listening` heartbeat marked a room freshly active, so the host saw
// "now" beside rooms where nothing had been said for an hour. His words:
// "don't let presence update be shown as room updates … activity timestamp should
// not be confused with lifecycle timestamps."
//
// It caused a second, worse problem. Heartbeats arrive every few minutes per
// agent, so activity-ordered rooms reshuffled constantly — which is exactly how he
// kept starting to type into a room that had moved under his cursor. One wrong
// signal, two visible bugs.
//
// The rule: activity is what a person would call activity. Someone said something,
// or something happened to the WORK (a task submitted, a verdict, a decision
// promoted, a release recorded). Presence — pings, nudges, joins, departures,
// sweeps, the room noticing nobody is listening — is lifecycle. It belongs in the
// People pane and the transcript, never in "what changed recently".

import type { Message } from '@agent-room/shared';

/** System events that describe PRESENCE or room membership rather than work.
 *  These are exactly the ones that fire on their own schedule, with no human or
 *  agent deciding anything. */
export const LIFECYCLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent_auto_nudged',
  'participant_removed',
  'ghost_sweep',
  'nobody_listening',
  'last_agent_left',
  'timed_out',
  'skipped_by_grace',
  'skipped_by_host',
  'lead_left',
]);

/**
 * Should this append advance the room's last-activity time?
 *
 * Deliberately allow-by-default for system messages: a new substantive event type
 * (a verdict, a promotion, a decision) should count the day it is added, without
 * anyone remembering to update a list. Only the named presence events are
 * excluded, and forgetting to exclude a NEW presence event is a visible bug in
 * the room list rather than a silent loss of a real signal.
 */
export function countsAsActivity(message: Pick<Message, 'type' | 'metadata'>): boolean {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  // room_status pings: explicitly "I am still here", the purest lifecycle signal.
  if (meta.kind === 'status') return false;
  if (message.type === 'sys') {
    const eventType = typeof meta.eventType === 'string' ? meta.eventType : '';
    if (LIFECYCLE_EVENT_TYPES.has(eventType)) return false;
  }
  return true;
}

/** Newest message that counts as activity, for rebuilding the index from history.
 *  Scans from the newest end and stops at the first real one, so a tail of
 *  heartbeats cannot make a quiet room look busy. */
export function lastActivityTime(messages: readonly Pick<Message, 'type' | 'metadata' | 'time'>[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || !countsAsActivity(m)) continue;
    const t = Number(m.time);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return undefined;
}
