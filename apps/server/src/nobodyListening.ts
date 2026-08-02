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

/** Whether this exact row has a live delivery path right now.
 *
 * Process life and message delivery are deliberately different facts:
 * `online`, `working`, and `stale` can all describe an agent whose model or
 * terminal is alive while no room_listen request is parked. Calling any of
 * those states "able to answer" suppressed the one warning this module exists
 * to provide. Only the server-owned listen lease proves that a message can be
 * delivered now. */
export function canStillAnswer(p: Participant, now: number): boolean {
  if (p.client !== 'cc' || p.viewer === true) return false;
  return presenceState(p, now) === 'listening';
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
export const NOBODY_LISTENING_MARKER = 'No agent was listening when this message was sent';

export function nobodyListeningText(participants: readonly Participant[], now: number): string {
  const agentRows = participants.filter(p => p.client === 'cc' && p.viewer !== true);
  const names = agentRows.map(p => p.name);
  const who = names.length === 0
    ? 'There are no agents in this room.'
    : names.length === 1
      ? (() => {
          const state = presenceState(agentRows[0]!, now);
          if (state === 'working') return `${names[0]} was working, but not listening.`;
          if (state === 'online') return `${names[0]} was online, but not listening.`;
          if (state === 'stale') return `${names[0]} was stale and not listening.`;
          return `${names[0]} was disconnected.`;
        })()
      : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} were not listening.`;
  // This is an event receipt, not a sticky current-state banner: past tense
  // keeps it truthful after an agent returns. "Starts listening" is also the
  // exact recovery boundary — a working process need not rejoin.
  return `⚠ ${NOBODY_LISTENING_MARKER} — ${who} Your message is saved and will be delivered when an agent starts listening.`;
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
