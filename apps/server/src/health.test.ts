import { describe, it, expect } from 'vitest';
import { presenceState, participantHealth, roomHealth } from './health.js';
import type { Participant } from '@agent-room/shared';

const NOW = 1_000_000_000;
const p = (over: Partial<Participant>): Participant => ({
  name: 'A', role: 'r', color: '#fff', initials: 'AA', client: 'cc',
  joinedAt: 0, lastSeenAt: NOW, ...over,
});

describe('T-66 presence health — stop presence from lying', () => {
  it('reports "listening" only while a listen window is actually parked', () => {
    expect(presenceState(p({ listenUntil: NOW + 60_000 }), NOW)).toBe('listening');
    expect(presenceState(p({ listenUntil: NOW - 1 }), NOW)).not.toBe('listening');
  });

  // The exact failure that kept fooling us: an agent can send a message (so it
  // looks alive) while having NO listener armed. Transport works, presence lies.
  it('an agent that just spoke but has no listener is "online", NOT "listening"', () => {
    expect(presenceState(p({ lastSeenAt: NOW, listenUntil: undefined }), NOW)).toBe('online');
  });

  it('degrades online -> stale -> disconnected as we stop hearing from it', () => {
    expect(presenceState(p({ lastSeenAt: NOW - 30_000 }), NOW)).toBe('online');
    expect(presenceState(p({ lastSeenAt: NOW - 120_000 }), NOW)).toBe('stale');
    expect(presenceState(p({ lastSeenAt: NOW - 600_000 }), NOW)).toBe('disconnected');
  });

  it('treats a never-seen participant as disconnected rather than online', () => {
    expect(presenceState(p({ lastSeenAt: 0 }), NOW)).toBe('disconnected');
  });

  it('carries NO credential material — this payload goes to every member', () => {
    const row = p({
      memberKeyHash: 'm'.repeat(64),
      authIdHash: 'a'.repeat(64),
      agentIdHash: 'g'.repeat(64),
      listenUntil: NOW + 1_000,
    });
    const out = JSON.stringify(participantHealth(row, NOW));
    expect(out).not.toContain('m'.repeat(64));
    expect(out).not.toContain('a'.repeat(64));
    expect(out).not.toContain('g'.repeat(64));
    expect(Object.keys(participantHealth(row, NOW)).sort()).toEqual(
      ['client', 'lastSeenAgoMs', 'listenRemainingMs', 'name', 'role', 'state'],
    );
  });

  it('never reports a negative age or remaining window (clock skew)', () => {
    const h = participantHealth(p({ lastSeenAt: NOW + 5_000, listenUntil: NOW - 5_000 }), NOW);
    expect(h.lastSeenAgoMs).toBe(0);
    expect(h.listenRemainingMs).toBe(0);
  });

  it('classifies a whole room in one pass', () => {
    const states = roomHealth(
      [p({ name: 'live', listenUntil: NOW + 1000 }), p({ name: 'dead', lastSeenAt: NOW - 900_000 })],
      NOW,
    ).map((h) => `${h.name}:${h.state}`);
    expect(states).toEqual(['live:listening', 'dead:disconnected']);
  });
});
