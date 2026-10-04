// Agent departure notices are based on an explicit lifecycle event, never on a
// point-in-time delivery guess. A send-time presence sample proved too weak for
// a durable transcript entry: an idle or wake-ready harness could be labelled
// disconnected and then answer the same message seconds later.

import type { Participant } from '@agent-room/shared';

import { presenceState } from './health.js';

/** Whether this exact row is still an agent expected to answer.
 *
 * The warning is an abandonment alarm, not a transport diagnostic. A joined
 * agent commonly moves from `listening` to `working` while it handles the
 * previous request, and `online` is the brief handoff between listen calls.
 * Warning during any non-disconnected state produces the exact false alarm
 * this surface must avoid: a quiet harness often answers seconds later. An
 * unexpired wake lease is stronger still: it proves an idle session has a
 * model-free path back into the room. */
export function canStillAnswer(p: Participant, now: number): boolean {
  if (p.client !== 'cc' || p.viewer === true) return false;
  if (Number(p.wakeUntil || 0) > now) return true;
  const state = presenceState(p, now);
  return state !== 'disconnected';
}

/**
 * T-40: did this departure leave the room with nobody who can answer?
 *
 * T-32 deliberately keeps a self-leave quiet — voluntary, and the MCP narrates its
 * own departures. That reasoning holds while other agents remain, and fails
 * completely for the LAST one: the Customer Service room lost its only agent to a
 * silent self-leave, so there was no removal line, no sweep line, nothing. The
 * host kept talking to a room that had quietly emptied, and only found out by
 * paging an admin 21 hours later.
 *
 * So the noise trade-off gets made per-case rather than once: an ordinary leave
 * stays quiet, and the leave that empties the room speaks up. Same for a host kick
 * — the kick is already announced, but "and now nobody is listening" is the part
 * the host actually needs.
 */
export function departureEmptiedRoom(args: {
  departedClient: string;
  remaining: readonly Participant[];
  now: number;
}): boolean {
  if (args.departedClient !== 'cc') return false;
  const agentRows = args.remaining.filter(p => p.client === 'cc' && p.viewer !== true);
  return !agentRows.some(p => canStillAnswer(p, args.now));
}

export function lastAgentLeftText(name: string, remaining: readonly Participant[]): string {
  const others = remaining.filter(p => p.client === 'cc' && p.viewer !== true).length;
  const tail = others === 0
    ? 'No agents are left in this room.'
    : `The ${others === 1 ? 'other agent' : `other ${others} agents`} here ${others === 1 ? 'is' : 'are'} not listening.`;
  return `👋 ${name} left the room — ${tail} Messages will wait here until an agent starts listening.`;
}
