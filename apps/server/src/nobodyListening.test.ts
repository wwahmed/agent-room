import { readFileSync } from 'node:fs';
import type { Participant } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { PRESENCE_DISCONNECTED_MS, WORKING_WINDOW_MS } from './health.js';
import { canStillAnswer, departureEmptiedRoom, lastAgentLeftText } from './nobodyListening.js';

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

describe('explicit agent departure notices', () => {
  it('treats every non-disconnected or wake-ready agent as able to answer', () => {
    const listening = p('Listener', { listenUntil: NOW + 45_000 });
    const online = p('Online', { lastSeenAt: NOW - 1_000 });
    const working = p('Working', { workingUntil: NOW + WORKING_WINDOW_MS });
    const stale = p('Stale', { lastSeenAt: NOW - 90_000 });
    const wakeReady = dead('WakeReady');
    wakeReady.wakeUntil = NOW + 45_000;

    for (const participant of [listening, online, working, stale, wakeReady]) {
      expect(canStillAnswer(participant, NOW)).toBe(true);
    }
    expect(canStillAnswer(dead('Gone'), NOW)).toBe(false);
    expect(canStillAnswer(p('Viewer', { viewer: true }), NOW)).toBe(false);
  });

  it('announces only an explicit departure that empties the room', () => {
    expect(departureEmptiedRoom({
      departedClient: 'cc', remaining: [p('Waqas', { client: 'web' })], now: NOW,
    })).toBe(true);
    expect(departureEmptiedRoom({
      departedClient: 'cc', remaining: [p('Listener', { listenUntil: NOW + 45_000 })], now: NOW,
    })).toBe(false);
    expect(departureEmptiedRoom({ departedClient: 'cc', remaining: [dead('X')], now: NOW })).toBe(true);
    expect(departureEmptiedRoom({ departedClient: 'web', remaining: [dead('X')], now: NOW })).toBe(false);
  });

  it('keeps the explicit-departure receipt useful', () => {
    expect(lastAgentLeftText('CustService', [])).toContain('CustService left the room');
    expect(lastAgentLeftText('CustService', [])).toContain('No agents are left in this room');
    expect(lastAgentLeftText('A', [dead('B'), dead('C')])).toContain('other 2 agents');
    expect(lastAgentLeftText('A', [])).toContain('Messages will wait here');
  });

  it('never emits a durable send-time nobody-listening event', () => {
    expect(serverIndex).not.toContain("eventType: 'nobody_listening'");
    expect(serverIndex).not.toContain('shouldWarnNobodyListening');
    expect(serverIndex).toContain('departureEmptiedRoom({');
    expect(serverIndex).toContain("eventType: 'last_agent_left'");
  });
});
