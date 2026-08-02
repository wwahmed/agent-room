import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_CACHE_MAX_AGE_MS,
  clearHomeCache,
  matchesIdentity,
  readHomeCache,
  writeHomeCache,
  type HomeSnapshot,
} from './homeCache.js';
import type { RoomSummary, WhoAmI } from './identity.js';

const KEY = 'wakichat:home:v1';
const ME: WhoAmI = { email: 'waqas@example.com', name: 'Waqas', role: 'Facilitator' };
const OTHER: WhoAmI = { email: 'someone-else@example.com', name: 'Someone Else', role: '' };
const NOW = 1_700_000_000_000;

function room(code: string, over: Partial<RoomSummary> = {}): RoomSummary {
  return { code, topic: code, status: 'active', createdBy: ME.email, createdAt: NOW - 1000, participants: 2, ...over };
}

/** Write a raw payload the way a corrupt/older/hostile client might have. */
function seed(raw: string): void {
  localStorage.setItem(KEY, raw);
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Home warm-start cache', () => {
  it('round-trips the snapshot so a back-navigation paints last-known rooms', () => {
    writeHomeCache(ME, [room('AAA-BBB-CCC'), room('DDD-EEE-FFF')], 'cursor-2', NOW);
    const snap = readHomeCache(NOW + 1000);
    expect(snap?.identity.email).toBe(ME.email);
    expect(snap?.rooms.map(r => r.code)).toEqual(['AAA-BBB-CCC', 'DDD-EEE-FFF']);
    // The paging cursor survives, so "Load more" is not reset by a warm start.
    expect(snap?.nextCursor).toBe('cursor-2');
  });

  it('returns null when nothing was ever cached — cold start is unchanged', () => {
    expect(readHomeCache(NOW)).toBeNull();
  });

  // ---- misbehaving inputs: every one must fail CLOSED to the loading path,
  // never throw, and never hand a half-built row to the list ----

  it('rejects unparseable JSON instead of throwing', () => {
    seed('{not json at all');
    expect(() => readHomeCache(NOW)).not.toThrow();
    expect(readHomeCache(NOW)).toBeNull();
  });

  it.each([
    ['a bare string', '"hello"'],
    ['a JSON array', '[]'],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['identity missing', JSON.stringify({ rooms: [], savedAt: NOW })],
    ['identity not an object', JSON.stringify({ identity: 7, rooms: [], savedAt: NOW })],
    ['identity without an email', JSON.stringify({ identity: { name: 'Waqas' }, rooms: [], savedAt: NOW })],
    ['savedAt missing', JSON.stringify({ identity: ME, rooms: [] })],
    ['savedAt not a number', JSON.stringify({ identity: ME, rooms: [], savedAt: 'yesterday' })],
  ])('rejects %s', (_label, raw) => {
    seed(raw);
    expect(readHomeCache(NOW)).toBeNull();
  });

  it('rejects a snapshot older than the max age', () => {
    writeHomeCache(ME, [room('AAA-BBB-CCC')], null, NOW);
    expect(readHomeCache(NOW + HOME_CACHE_MAX_AGE_MS - 1)).not.toBeNull();
    expect(readHomeCache(NOW + HOME_CACHE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('rejects a future-dated snapshot rather than trusting a moved clock', () => {
    writeHomeCache(ME, [room('AAA-BBB-CCC')], null, NOW + 60_000);
    expect(readHomeCache(NOW)).toBeNull();
  });

  it('drops individual rows that could not be rendered, keeping the good ones', () => {
    seed(JSON.stringify({
      identity: ME,
      savedAt: NOW,
      rooms: [
        room('AAA-BBB-CCC'),
        { topic: 'no code' },
        { code: '', topic: 'empty code' },
        { code: 'GGG-HHH-JJJ', createdAt: 'not a number' },
        null,
        'a string',
        room('KKK-LLL-MMM'),
      ],
    }));
    expect(readHomeCache(NOW)?.rooms.map(r => r.code)).toEqual(['AAA-BBB-CCC', 'KKK-LLL-MMM']);
  });

  it('treats a non-array rooms field as no rooms', () => {
    seed(JSON.stringify({ identity: ME, savedAt: NOW, rooms: { code: 'AAA-BBB-CCC' } }));
    expect(readHomeCache(NOW)?.rooms).toEqual([]);
  });

  it('survives a browser that refuses storage, in both directions', () => {
    const err = () => { throw new Error('SecurityError: storage disabled'); };
    vi.spyOn(localStorage, 'getItem').mockImplementation(err);
    vi.spyOn(localStorage, 'setItem').mockImplementation(err);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(err);
    expect(() => writeHomeCache(ME, [room('AAA-BBB-CCC')], null, NOW)).not.toThrow();
    expect(readHomeCache(NOW)).toBeNull();
    expect(() => clearHomeCache()).not.toThrow();
  });

  it('clears on demand so a signed-out device holds no room titles', () => {
    writeHomeCache(ME, [room('AAA-BBB-CCC')], null, NOW);
    clearHomeCache();
    expect(readHomeCache(NOW)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('snapshot ownership', () => {
  const snap = (identity: WhoAmI): HomeSnapshot => ({ identity, rooms: [], nextCursor: null, savedAt: NOW });

  it('matches only the account it was captured under', () => {
    expect(matchesIdentity(snap(ME), ME)).toBe(true);
    // One account must never flash another account's room titles.
    expect(matchesIdentity(snap(ME), OTHER)).toBe(false);
  });

  it('matches on email, not display name — a rename keeps the warm start', () => {
    expect(matchesIdentity(snap(ME), { ...ME, name: 'Waqas A.' })).toBe(true);
  });

  it('never claims a match without both sides present', () => {
    expect(matchesIdentity(null, ME)).toBe(false);
    expect(matchesIdentity(snap(ME), null)).toBe(false);
    expect(matchesIdentity(null, null)).toBe(false);
  });
});
