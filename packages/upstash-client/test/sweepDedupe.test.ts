import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Participant, Room } from '@agent-room/shared';
import {
  createClient,
  sweepTimeouts,
  getRoom,
  getTurnState,
  type TurnState,
} from '../src/index.js';

const ENV = { url: 'https://example.upstash.io', token: 't' };
const CODE = 'TST-CDE-FGH';

// In-memory Upstash fake that honors SET ... NX, so the dedupe claim (the only
// NX writer) round-trips: a second SET NX on an existing key returns null.
function installFakeRedis(seed: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    const args = JSON.parse(init.body) as string[];
    const [op, key, val] = args;
    let result: unknown = null;
    if (op === 'GET') result = store.has(key) ? store.get(key) : null;
    else if (op === 'SET') {
      if (args.includes('NX') && store.has(key)) { result = null; }
      else { store.set(key, val as string); result = 'OK'; }
    }
    else if (op === 'DEL') { result = store.delete(key) ? 1 : 0; }
    return new Response(JSON.stringify({ result }), { headers: { 'Content-Type': 'application/json' } });
  }));
  return store;
}

function part(name: string, joinedAt: number, client: 'web' | 'cc' = 'cc', canSpeak = true): Participant {
  return { name, client, role: '', color: '#fff', initials: 'XX', joinedAt, lastSeenAt: joinedAt, canSpeak };
}

function moderatorRoom(participants: Participant[], moderator: string): Room {
  return {
    code: CODE, topic: 'discussion', createdAt: 0, createdBy: 'host', status: 'active',
    version: 1, participants, replyMode: 'moderator',
    modeConfig: { moderatorAgentName: moderator, moderatorAgentClient: 'cc' },
  };
}

// A moderator turn whose deadline is already in the past, so the sweep skips it.
function expiredModeratorTurn(moderator: string): TurnState {
  return {
    turnId: 100, mode: 'moderator',
    moderatorName: moderator, moderatorClient: 'cc',
    currentName: moderator, currentClient: 'cc', currentRole: 'moderator',
    deadline: 500, queue: [], spoken: [],
  };
}

describe('sweepTimeouts dead-end dedupe', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls a timed-out moderator back to open and reports it', async () => {
    const r = moderatorRoom([part('Human', 0, 'web'), part('ModA', 1)], 'ModA');
    installFakeRedis({
      [`room:${CODE}`]: JSON.stringify(r),
      [`turn-state:${CODE}`]: JSON.stringify(expiredModeratorTurn('ModA')),
    });
    const client = createClient(ENV);

    const sweep = await sweepTimeouts(client, CODE, r, 10_000);

    expect(sweep.fallback?.reason).toBe('moderator_timeout');
    const room = await getRoom(client, CODE);
    expect(room.replyMode).toBe('open');
    expect(await getTurnState(client, CODE)).toBeNull();
  });

  it('dedupes concurrent sweeps of the same dead-end: only the first emits the fallback', async () => {
    // Two listen polls observe the SAME expired moderator deadline. The first
    // claims the dead-end and returns the skip + fallback; the second must
    // suppress them so the caller does not post duplicate sys messages. We
    // re-seed the pre-fallback state both racers saw between calls, while the
    // shared store keeps the dedupe lock so the second claim loses.
    const r = moderatorRoom([part('Human', 0, 'web'), part('ModA', 1)], 'ModA');
    const store = installFakeRedis({
      [`room:${CODE}`]: JSON.stringify(r),
      [`turn-state:${CODE}`]: JSON.stringify(expiredModeratorTurn('ModA')),
    });
    const client = createClient(ENV);

    const first = await sweepTimeouts(client, CODE, r, 10_000);
    expect(first.fallback?.reason).toBe('moderator_timeout');
    expect(first.skipped.length).toBe(1);

    // Reset to the pre-fallback state both racers saw; keep the dedupe lock.
    store.set(`room:${CODE}`, JSON.stringify(r));
    store.set(`turn-state:${CODE}`, JSON.stringify(expiredModeratorTurn('ModA')));

    const second = await sweepTimeouts(client, CODE, r, 10_000);
    expect(second.fallback).toBeUndefined();
    expect(second.skipped).toEqual([]);
  });
});
