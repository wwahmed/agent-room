import { describe, it, expect } from 'vitest';
import { getReadMarkerState, listReadMarkers, resolveMarkerAccount, setReadMarker, stampReadMarkerTime, type MarkerRedis } from './readmarkers.js';

// T-126 READ-STATE IS USER-STATE: account-level markers, monotonic writes.
function fakeRedis(): MarkerRedis & { store: Map<string, Map<string, string>> } {
  const store = new Map<string, Map<string, string>>();
  return {
    store,
    async hget(key, field) { return store.get(key)?.get(field) ?? null; },
    async hset(key, field, value) {
      if (!store.has(key)) store.set(key, new Map());
      store.get(key)!.set(field, value);
    },
    async hgetall(key) { return Object.fromEntries(store.get(key) ?? new Map()); },
  };
}

describe('T-126 resolveMarkerAccount', () => {
  it('uses the Access JWT email for edge users, ignoring any explicit account', () => {
    expect(resolveMarkerAccount({ kind: 'user', email: 'waqas@example.com' }, 'spoof@evil.com'))
      .toBe('waqas@example.com');
  });

  it('lets loopback callers name the account explicitly', () => {
    expect(resolveMarkerAccount({ kind: 'local' }, ' Waqas@Example.com ')).toBe('waqas@example.com');
  });

  it('rejects loopback callers without a plausible account', () => {
    expect(() => resolveMarkerAccount({ kind: 'local' }, undefined)).toThrow(/account/);
    expect(() => resolveMarkerAccount({ kind: 'local' }, 'not-an-email')).toThrow(/account/);
  });

  it('rejects anonymous callers outright', () => {
    expect(() => resolveMarkerAccount({ kind: 'anonymous' }, 'a@b.com')).toThrow(/authenticated/);
  });
});

describe('T-126 setReadMarker / listReadMarkers', () => {
  it('stores and lists markers per account', async () => {
    const redis = fakeRedis();
    await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 42);
    await setReadMarker(redis, 'a@b.com', 'kkk-lll-mmm', 7);
    await setReadMarker(redis, 'other@b.com', 'abc-def-ghj', 5);
    expect(await listReadMarkers(redis, 'a@b.com')).toEqual({ 'abc-def-ghj': 42, 'kkk-lll-mmm': 7 });
    expect(await listReadMarkers(redis, 'other@b.com')).toEqual({ 'abc-def-ghj': 5 });
  });

  it('is monotonic: a stale device can never walk the marker backwards', async () => {
    const redis = fakeRedis();
    await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 100);
    const after = await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 60);
    expect(after).toBe(100);
    expect(await listReadMarkers(redis, 'a@b.com')).toEqual({ 'abc-def-ghj': 100 });
  });

  it('accepts zero and floors fractional counts', async () => {
    const redis = fakeRedis();
    expect(await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 0)).toBe(0);
    expect(await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 3.9)).toBe(3);
  });

  it('rejects missing code or negative counts', async () => {
    const redis = fakeRedis();
    await expect(setReadMarker(redis, 'a@b.com', '', 1)).rejects.toThrow(/code/);
    await expect(setReadMarker(redis, 'a@b.com', 'abc-def-ghj', -1)).rejects.toThrow(/non-negative/);
  });

  it('drops corrupt stored values on list', async () => {
    const redis = fakeRedis();
    await redis.hset('readmarkers:a@b.com', 'abc-def-ghj', 'garbage');
    await redis.hset('readmarkers:a@b.com', 'kkk-lll-mmm', '12');
    expect(await listReadMarkers(redis, 'a@b.com')).toEqual({ 'kkk-lll-mmm': 12 });
  });
});

describe('marker move timestamps (push suppress-when-reading)', () => {
  it('stamps and reads back count + movedAt together', async () => {
    const redis = fakeRedis();
    await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 42);
    await stampReadMarkerTime(redis, 'a@b.com', 'abc-def-ghj', 1_000_000);
    expect(await getReadMarkerState(redis, 'a@b.com', 'abc-def-ghj'))
      .toEqual({ count: 42, movedAt: 1_000_000 });
  });

  it('returns null fields when the account never touched the room', async () => {
    const redis = fakeRedis();
    expect(await getReadMarkerState(redis, 'a@b.com', 'abc-def-ghj'))
      .toEqual({ count: null, movedAt: null });
  });

  it('reports a count with a null movedAt for pre-timestamp markers', async () => {
    const redis = fakeRedis();
    await setReadMarker(redis, 'a@b.com', 'abc-def-ghj', 7);
    expect(await getReadMarkerState(redis, 'a@b.com', 'abc-def-ghj'))
      .toEqual({ count: 7, movedAt: null });
  });

  it('nulls corrupt stored values instead of returning NaN', async () => {
    const redis = fakeRedis();
    await redis.hset('readmarkers:a@b.com', 'abc-def-ghj', 'junk');
    await redis.hset('readmarkers:ts:a@b.com', 'abc-def-ghj', 'junk');
    expect(await getReadMarkerState(redis, 'a@b.com', 'abc-def-ghj'))
      .toEqual({ count: null, movedAt: null });
  });
});
