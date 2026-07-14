import { describe, it, expect } from 'vitest';
import { presenceView, canRecover, recoveryPrompt, indexHealth, healthKey, type ParticipantHealth } from './presence.js';

const h = (over: Partial<ParticipantHealth> = {}): ParticipantHealth => ({
  name: 'Frontend-Claude',
  client: 'cc',
  role: 'Web UI',
  state: 'listening',
  lastSeenAgoMs: 0,
  listenRemainingMs: 60_000,
  ...over,
});

describe('listen-loop health (T-68: server is the source of truth)', () => {
  it('renders the server state verbatim — the web never re-classifies', () => {
    // The point of T-68: no thresholds live here. Whatever the server says, we show.
    // A second definition of "dead" is what let presence lie in the first place.
    expect(presenceView(h({ state: 'listening' })).label).toBe('Listening now');
    expect(presenceView(h({ state: 'online' })).label).toBe('Online');
    expect(presenceView(h({ state: 'stale' })).label).toBe('Stale');
    expect(presenceView(h({ state: 'disconnected' })).label).toBe('Disconnected');
  });

  it('keeps listening and online DISTINCT', () => {
    // `listening` = a loop is genuinely armed. `online` = we merely heard from them
    // recently, with no listener parked. Collapsing these into one green dot re-hides
    // the exact "transport works while presence lies" failure the host hit.
    const listening = presenceView(h({ state: 'listening', listenRemainingMs: 30_000 }));
    const online = presenceView(h({ state: 'online', listenRemainingMs: 0, lastSeenAgoMs: 5_000 }));
    expect(listening.label).not.toBe(online.label);
    expect(online.detail).toBe('not in a listen window');
  });

  it('a long-quiet agent with an armed loop is still listening — silence is not death', () => {
    const v = presenceView(h({ state: 'listening', lastSeenAgoMs: 10 * 60_000 }));
    expect(v.label).toBe('Listening now');
  });

  describe('recovery control visibility', () => {
    it('is offered for a stale or disconnected CLI agent', () => {
      expect(canRecover(h({ state: 'stale' }), false)).toBe(true);
      expect(canRecover(h({ state: 'disconnected' }), false)).toBe(true);
    });

    it('is NOT offered to an agent that is listening or merely online', () => {
      expect(canRecover(h({ state: 'listening' }), false)).toBe(false);
      expect(canRecover(h({ state: 'online' }), false)).toBe(false);
    });

    it('is NOT offered for web participants — a browser tab is not recoverable this way', () => {
      expect(canRecover(h({ state: 'disconnected', client: 'web' }), false)).toBe(false);
    });

    it('is NOT offered once the room has ended', () => {
      expect(canRecover(h({ state: 'disconnected' }), true)).toBe(false);
    });
  });

  describe('recovery prompt', () => {
    it('names the room, the exact identity, and the listen loop', () => {
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

    it('carries no credential material', () => {
      const s = recoveryPrompt('D64-2UJ-FNR', 'Frontend-Claude', 'Web UI').toLowerCase();
      for (const secret of ['key', 'token', 'secret', 'memberkey', 'session', 'anchor']) {
        expect(s).not.toContain(secret);
      }
    });
  });

  describe('indexing', () => {
    it('keys on name AND client, so the same name on two clients does not collide', () => {
      const idx = indexHealth([
        h({ name: 'Waqas', client: 'web', state: 'online' }),
        h({ name: 'Waqas', client: 'cc', state: 'disconnected' }),
      ]);
      expect(idx.get(healthKey('Waqas', 'web'))?.state).toBe('online');
      expect(idx.get(healthKey('Waqas', 'cc'))?.state).toBe('disconnected');
    });

    it('a crafted name cannot forge another participant\'s key', () => {
      // The key is JSON-encoded, so a name that embeds the separator is escaped
      // rather than colliding with a real (name, client) pair.
      expect(healthKey('Waqas","cc', 'web')).not.toBe(healthKey('Waqas', 'cc'));
    });

    it('the key is plain text — no control characters', () => {
      // Regression: a NUL separator here made the whole source file binary to git.
      expect(healthKey('Waqas', 'web')).not.toMatch(/[\u0000-\u001f]/);
    });
  });
});
