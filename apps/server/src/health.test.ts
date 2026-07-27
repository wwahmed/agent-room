import { describe, it, expect } from 'vitest';
import {
  presenceState, participantHealth, roomHealth, ghostRows,
  clampWorkingUntil, WORKING_WINDOW_MS, WORKING_WINDOW_CAP_MS,
} from './health.js';
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

  // T-04: a declared work window means "heads-down", not "dying". The ladder
  // is listening → working → online → stale → disconnected, and expiry falls
  // straight back to the silence clock — the alarm is deferred, never lost.
  describe('T-04 working state — a busy agent is not a dying agent', () => {
    it('an unexpired work window reads working, even after 60s+ of silence', () => {
      expect(presenceState(p({ lastSeenAt: NOW - 120_000, workingUntil: NOW + 60_000 }), NOW)).toBe('working');
    });

    it('working outranks online: a fresh ping inside a window is still working', () => {
      expect(presenceState(p({ lastSeenAt: NOW, workingUntil: NOW + 60_000 }), NOW)).toBe('working');
    });

    it('an armed listen loop outranks the work window', () => {
      expect(presenceState(p({ listenUntil: NOW + 1_000, workingUntil: NOW + 60_000 }), NOW)).toBe('listening');
    });

    it('an expired window degrades exactly like silence — stale, then disconnected', () => {
      expect(presenceState(p({ lastSeenAt: NOW - 120_000, workingUntil: NOW - 1 }), NOW)).toBe('stale');
      expect(presenceState(p({ lastSeenAt: NOW - 600_000, workingUntil: NOW - 1 }), NOW)).toBe('disconnected');
    });

    it('clampWorkingUntil: default window, cap, and garbage fall-back', () => {
      expect(clampWorkingUntil(NOW)).toBe(NOW + WORKING_WINDOW_MS);
      expect(clampWorkingUntil(NOW, NOW + 5_000)).toBe(NOW + 5_000);
      // a crashed agent that pinged once must not look busy forever
      expect(clampWorkingUntil(NOW, NOW + 10 * WORKING_WINDOW_CAP_MS)).toBe(NOW + WORKING_WINDOW_CAP_MS);
      expect(clampWorkingUntil(NOW, NaN)).toBe(NOW + WORKING_WINDOW_MS);
      expect(clampWorkingUntil(NOW, NOW - 1)).toBe(NOW + WORKING_WINDOW_MS);
    });
  });

  // T-13: the ghost selector feeds the host's one-tap sweep — only cc rows
  // the server considers disconnected qualify; live agents and web humans
  // must never be sweepable.
  it('ghostRows selects only disconnected cc rows', () => {
    const rows = [
      p({ name: 'live', listenUntil: NOW + 1000 }),
      p({ name: 'busy', workingUntil: NOW + 1000, lastSeenAt: NOW - 120_000 }),
      p({ name: 'stale-not-ghost', lastSeenAt: NOW - 120_000 }),
      p({ name: 'ghost', lastSeenAt: NOW - 900_000 }),
      p({ name: 'ghost-viewer', lastSeenAt: NOW - 900_000, viewer: true }),
      p({ name: 'dead-human', client: 'web', lastSeenAt: NOW - 900_000 }),
    ];
    expect(ghostRows(rows, NOW).map(g => g.name)).toEqual(['ghost', 'ghost-viewer']);
  });

  // T-143: a server restart can leave a rejoined row with a null lastSeenAt.
  // Presence must not lie about it as "last heard 1969".
  describe('T-143 null-timestamp rows must not render as epoch-0', () => {
    it('falls back to joinedAt: a just-joined row with null lastSeenAt reads online', () => {
      expect(presenceState(p({ lastSeenAt: undefined, joinedAt: NOW - 5_000 }), NOW)).toBe('online');
      const h = participantHealth(p({ lastSeenAt: undefined, joinedAt: NOW - 5_000 }), NOW);
      expect(h.lastSeenAgoMs).toBe(5_000); // real age from joinedAt, not ~56 years
    });

    it('a row with NO timestamps yields the unknown sentinel (-1), not a 56-year age', () => {
      const h = participantHealth(p({ lastSeenAt: undefined, joinedAt: 0 }), NOW);
      expect(h.lastSeenAgoMs).toBe(-1);            // UI renders "unknown", never 1969
      expect(h.lastSeenAgoMs).not.toBeGreaterThan(NOW - 1); // the old bug produced ~NOW
      expect(h.state).toBe('disconnected');        // no proof of life
    });

    it('an armed listen window still reads listening even with null lastSeenAt', () => {
      expect(presenceState(p({ lastSeenAt: undefined, joinedAt: 0, listenUntil: NOW + 60_000 }), NOW)).toBe('listening');
    });

    it('a real recent lastSeenAt still wins and reads online with a real age', () => {
      const h = participantHealth(p({ lastSeenAt: NOW - 10_000, joinedAt: NOW - 999_999 }), NOW);
      expect(h.state).toBe('online');
      expect(h.lastSeenAgoMs).toBe(10_000);
    });
  });
});
