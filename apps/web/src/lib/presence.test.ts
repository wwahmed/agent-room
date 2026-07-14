import { describe, it, expect } from 'vitest';
import { PRESENCE_STALE_MS, PRESENCE_DISCONNECTED_MS } from '@agent-room/shared';
import { presenceFor, canRecover, recoveryPrompt } from './presence.js';

const NOW = 1_000_000_000;
const cc = (over: Partial<{ listenUntil: number; lastSeenAt: number; client: 'cc' | 'web' }> = {}) => ({
  client: 'cc' as const,
  lastSeenAt: NOW,
  ...over,
});

describe('listen-loop health (T-67)', () => {
  describe('thresholds', () => {
    it('an open listen window is "listening", however long it has been quiet', () => {
      // The whole point: silence is NOT death. A mid-build agent says nothing for
      // ten minutes and is perfectly healthy — the open window proves it.
      const p = cc({ listenUntil: NOW + 60_000, lastSeenAt: NOW - 10 * 60_000 });
      expect(presenceFor(p, NOW).kind).toBe('listening');
    });

    it('an EXPIRED listen window is not listening, even if it just expired', () => {
      expect(presenceFor(cc({ listenUntil: NOW - 1, lastSeenAt: NOW }), NOW).kind).toBe('online');
    });

    it('recently seen with no window → online', () => {
      expect(presenceFor(cc({ lastSeenAt: NOW - (PRESENCE_STALE_MS - 1) }), NOW).kind).toBe('online');
    });

    it('exactly at the stale boundary is still online (inclusive)', () => {
      expect(presenceFor(cc({ lastSeenAt: NOW - PRESENCE_STALE_MS }), NOW).kind).toBe('online');
    });

    it('past stale but within disconnected → idle', () => {
      expect(presenceFor(cc({ lastSeenAt: NOW - (PRESENCE_STALE_MS + 1) }), NOW).kind).toBe('idle');
      expect(presenceFor(cc({ lastSeenAt: NOW - PRESENCE_DISCONNECTED_MS }), NOW).kind).toBe('idle');
    });

    it('past the disconnected threshold → disconnected', () => {
      expect(presenceFor(cc({ lastSeenAt: NOW - (PRESENCE_DISCONNECTED_MS + 1) }), NOW).kind).toBe('disconnected');
    });
  });

  describe('recovery control visibility', () => {
    it('is offered for a dead CLI agent', () => {
      expect(canRecover(cc({ lastSeenAt: NOW - 6 * 60_000 }), NOW, false)).toBe(true); // disconnected
      expect(canRecover(cc({ lastSeenAt: NOW - 90_000 }), NOW, false)).toBe(true);     // idle
    });

    it('is NOT offered to an agent that is actually listening', () => {
      expect(canRecover(cc({ listenUntil: NOW + 1000, lastSeenAt: NOW - 9e6 }), NOW, false)).toBe(false);
    });

    it('is NOT offered to a healthy/online agent', () => {
      expect(canRecover(cc({ lastSeenAt: NOW }), NOW, false)).toBe(false);
    });

    it('is NOT offered for web participants — a browser tab is not recoverable this way', () => {
      expect(canRecover({ client: 'web', lastSeenAt: NOW - 9e6 }, NOW, false)).toBe(false);
    });

    it('is NOT offered once the room has ended', () => {
      expect(canRecover(cc({ lastSeenAt: NOW - 9e6 }), NOW, true)).toBe(false);
    });
  });

  describe('recovery prompt content', () => {
    it('names the room and the exact identity to reclaim, and says to keep listening', () => {
      const s = recoveryPrompt('D64-2UJ-FNR', 'Frontend-Claude', 'Web UI');
      expect(s).toContain('D64-2UJ-FNR');
      expect(s).toContain('"Frontend-Claude"');
      expect(s).toContain('role: Web UI');
      expect(s).toContain('room_listen');
    });

    it('omits the role clause when there is no role', () => {
      expect(recoveryPrompt('ABC-DEF-GHJ', 'Codex')).toBe(
        'Rejoin Agent Room ABC-DEF-GHJ as "Codex" and stay in the room_listen loop until the host says stop.',
      );
    });

    it('carries no credential or key material', () => {
      const s = recoveryPrompt('D64-2UJ-FNR', 'Frontend-Claude', 'Web UI').toLowerCase();
      for (const secret of ['key', 'token', 'secret', 'memberkey', 'session']) {
        expect(s).not.toContain(secret);
      }
    });
  });
});
