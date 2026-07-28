// T-39: tell a human when they are talking to an empty room.
//
// Three agents went silent in one day and the costly one was not the agent that
// died — it was the silence afterwards. The Customer Service room lost its agent
// entirely: no participant row, no registry entry, no terminal session. Waqas
// asked it a question, waited **90 minutes**, and then had to page an admin to
// find out that nobody had been there to read it. WakiDrive was the same shape
// stretched over 14 hours.
//
// Presence alarms cannot catch that case. A watchdog needs a row to watch and a
// terminal to sniff, and a vanished agent has neither. But the room knows the one
// thing that matters at the moment it matters: a person just spoke, and there is
// nobody here who can answer.
//
// So the check runs on send, not on a timer. No polling, no new sampler, and the
// warning lands in the same second as the message that deserved it.

import type { Participant } from '@agent-room/shared';

import { presenceState } from './health.js';

/** States in which an agent can still receive and act on a message. `stale` counts
 *  as present on purpose: 60 seconds of quiet is a normal model turn, and warning
 *  there would cry wolf at every busy room. Only the 5-minute `disconnected`
 *  verdict — the same line the ghost sweep uses — counts as absent. */
export function canStillAnswer(p: Participant, now: number): boolean {
  if (p.client !== 'cc' || p.viewer === true) return false;
  return presenceState(p, now) !== 'disconnected';
}

/**
 * Should this send be followed by a "nobody is listening" notice?
 *
 * Only for a HUMAN's message: an agent posting into a quiet room is usually
 * reporting a result, and does not need to be told the room is quiet.
 *
 * `lastMessageText` suppresses repeats — a person typing three messages into an
 * empty room should get one warning, not a wall of them. Checked against the
 * previous message rather than kept in memory so a server restart cannot
 * resurrect the warning.
 */
export function shouldWarnNobodyListening(args: {
  senderClient: string;
  participants: readonly Participant[];
  now: number;
  lastMessageText?: string;
  /** A room with no agents at all was never expecting one — a solo notes room
   *  should not nag its owner on every line. */
  requireAtLeastOneAgentRow?: boolean;
}): boolean {
  const { senderClient, participants, now, lastMessageText } = args;
  if (senderClient !== 'web') return false;
  const agentRows = participants.filter(p => p.client === 'cc' && p.viewer !== true);
  if (agentRows.length === 0 && args.requireAtLeastOneAgentRow !== false) return false;
  if (agentRows.some(p => canStillAnswer(p, now))) return false;
  if (lastMessageText && lastMessageText.includes(NOBODY_LISTENING_MARKER)) return false;
  return true;
}

/** Marker used both to render the notice and to detect that the previous message
 *  already was one. Kept as a distinct constant so the two can never drift. */
export const NOBODY_LISTENING_MARKER = 'No agent is listening in this room right now';

export function nobodyListeningText(participants: readonly Participant[], now: number): string {
  const agentRows = participants.filter(p => p.client === 'cc' && p.viewer !== true);
  const names = agentRows.map(p => p.name);
  const who = names.length === 0
    ? 'There are no agents in this room.'
    : names.length === 1
      ? `${names[0]} is disconnected.`
      : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} are disconnected.`;
  // States the consequence rather than the status, because the status is what the
  // host already thought was fine. No advice about how to fix it — that depends on
  // how the agent was started, and a wrong instruction is worse than none.
  return `⚠ ${NOBODY_LISTENING_MARKER} — ${who} Your message has been saved, but nobody will read it until an agent rejoins.`;
}
