import { readFileSync } from 'node:fs';
import type { Participant } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { PRESENCE_DISCONNECTED_MS } from './health.js';
import {
  NOBODY_LISTENING_MARKER,
  canStillAnswer,
  departureEmptiedRoom,
  lastAgentLeftText,
  nobodyListeningText,
  shouldWarnNobodyListening,
} from './nobodyListening.js';

const serverIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const NOW = 1_700_000_000_000;
function p(name: string, over: Partial<Participant> = {}): Participant {
  return {
    name, role: '', color: '#000', initials: 'XX', client: 'cc',
    joinedAt: NOW - 60_000, lastSeenAt: NOW - 1_000,
    ...over,
  };
}
const dead = (name: string) => p(name, { lastSeenAt: NOW - PRESENCE_DISCONNECTED_MS - 1 });

// T-39: Waqas asked the Customer Service room a question and waited 90 MINUTES
// before paging an admin to discover the agent had vanished 21 hours earlier —
// no row, no registry entry, no terminal. WakiDrive was the same shape over 14
// hours. Nothing could poll for it; the detectable moment is the send itself.
describe('Nobody is listening', () => {
  it('warns a human who speaks into a room where every agent is disconnected', () => {
    expect(shouldWarnNobodyListening({
      senderClient: 'web', participants: [dead('CustService'), p('Waqas', { client: 'web' })], now: NOW,
    })).toBe(true);
  });

  it('stays silent while any agent can still answer — including a merely stale one', () => {
    // 60 seconds of quiet is a normal model turn. Warning there would fire in
    // every busy room and be learned as noise within a day.
    const stale = p('OpusCoder', { lastSeenAt: NOW - 90_000 });
    expect(canStillAnswer(stale, NOW)).toBe(true);
    expect(shouldWarnNobodyListening({ senderClient: 'web', participants: [stale], now: NOW })).toBe(false);
    // A live one alongside dead ones is enough.
    expect(shouldWarnNobodyListening({
      senderClient: 'web', participants: [dead('A'), dead('B'), p('C')], now: NOW,
    })).toBe(false);
  });

  it('never nags an agent, and never a room that has no agents by design', () => {
    // An agent posting a result into a quiet room does not need telling.
    expect(shouldWarnNobodyListening({ senderClient: 'cc', participants: [dead('A')], now: NOW })).toBe(false);
    // A solo notes room was never expecting an agent.
    expect(shouldWarnNobodyListening({
      senderClient: 'web', participants: [p('Waqas', { client: 'web' })], now: NOW,
    })).toBe(false);
  });

  it('a read-only viewer does not count as someone who can answer', () => {
    const viewer = p('AuditorDemo', { viewer: true });
    expect(canStillAnswer(viewer, NOW)).toBe(false);
    expect(shouldWarnNobodyListening({
      senderClient: 'web', participants: [dead('Dev'), viewer], now: NOW,
    })).toBe(true);
  });

  it('warns once, not on every line typed into the silence', () => {
    const participants = [dead('CustService')];
    const first = nobodyListeningText(participants, NOW);
    expect(first).toContain(NOBODY_LISTENING_MARKER);
    expect(shouldWarnNobodyListening({
      senderClient: 'web', participants, now: NOW, lastMessageText: first,
    })).toBe(false);
    // A normal previous message does not suppress it.
    expect(shouldWarnNobodyListening({
      senderClient: 'web', participants, now: NOW, lastMessageText: 'any other message',
    })).toBe(true);
  });

  it('names who is missing and states the consequence, without guessing the cure', () => {
    expect(nobodyListeningText([dead('CustService')], NOW)).toContain('CustService is disconnected');
    expect(nobodyListeningText([dead('A'), dead('B')], NOW)).toContain('A, B are disconnected');
    const text = nobodyListeningText([dead('A')], NOW);
    // The consequence is the part the host did not know.
    expect(text).toContain('nobody will read it until an agent rejoins');
    // No instructions: the fix depends on how that agent was started, and a wrong
    // instruction is worse than none.
    expect(text).not.toMatch(/restart|rejoin the room|run |tmux/i);
  });

  // T-40: the room lost its only agent to a SILENT self-leave — no removal line, no
  // sweep line, nothing. T-32 keeps self-leaves quiet on the reasoning that they are
  // voluntary and narrated by the agent; that agent narrated nothing, and the host
  // talked to an empty room for 21 hours.
  it('announces a departure that empties the room, and stays quiet otherwise', () => {
    // The last agent leaving is the case that must speak up.
    expect(departureEmptiedRoom({ departedClient: 'cc', remaining: [p('Waqas', { client: 'web' })], now: NOW })).toBe(true);
    // Another live agent remains: T-32's quiet-leave reasoning still holds.
    expect(departureEmptiedRoom({ departedClient: 'cc', remaining: [p('OpusCoder')], now: NOW })).toBe(false);
    // Only DEAD agents remain — still an empty room in practice.
    expect(departureEmptiedRoom({ departedClient: 'cc', remaining: [dead('X')], now: NOW })).toBe(true);
    // A human closing a tab is not an agent outage.
    expect(departureEmptiedRoom({ departedClient: 'web', remaining: [dead('X')], now: NOW })).toBe(false);
  });

  it('the departure notice names who left and what it means', () => {
    expect(lastAgentLeftText('CustService Dev Fresh', [])).toContain('CustService Dev Fresh left the room');
    expect(lastAgentLeftText('A', [])).toContain('No agents are left in this room');
    expect(lastAgentLeftText('A', [dead('B')])).toContain('other agent');
    expect(lastAgentLeftText('A', [dead('B'), dead('C')])).toContain('other 2 agents');
    expect(lastAgentLeftText('A', [])).toContain('Messages will wait here');
  });

  it('is wired into the send path as advisory-only, after a real append', () => {
    const hook = serverIndex.slice(serverIndex.indexOf('shouldWarnNobodyListening') - 1400);
    expect(hook).toContain('if (!appendResult.appended) return;');
    expect(hook).toContain("eventType: 'nobody_listening'");
    // Must never break a send: the whole block is fire-and-forget and swallows.
    expect(hook).toContain('advisory only — never fail a send over the warning');
    // T-40 fires on the removal path for BOTH a self-leave and a host kick.
    expect(serverIndex).toContain('departureEmptiedRoom({');
    expect(serverIndex).toContain("eventType: 'last_agent_left'");
  });
});
