import { describe, it, expect, beforeEach } from 'vitest';
import { markRoomRead, unreadCount } from './unread.js';

// The suite runs in node (no DOM), so stand up the bit of Storage we depend on.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;

describe('unread counts (T-62)', () => {
  beforeEach(() => localStorage.clear());

  it('seeds an unseen room to read rather than crying wolf with a huge count', () => {
    // Every room predates the feature; showing "59 unread" on a room he read to
    // the end would be a lie.
    expect(unreadCount('AAA-BBB-CCC', 59)).toBe(0);
    // ...and the seed sticks, so later messages DO count.
    expect(unreadCount('AAA-BBB-CCC', 62)).toBe(3);
  });

  it('counts messages that arrived after the reader last caught up', () => {
    markRoomRead('R', 10);
    expect(unreadCount('R', 14)).toBe(4);
  });

  it('reports zero when caught up', () => {
    markRoomRead('R', 10);
    expect(unreadCount('R', 10)).toBe(0);
  });

  it('never goes negative if the server count trails the marker', () => {
    markRoomRead('R', 20);
    expect(unreadCount('R', 5)).toBe(0);
  });

  it('keeps the marker monotonic so a stale poll cannot resurrect read messages', () => {
    markRoomRead('R', 30);
    markRoomRead('R', 12); // stale/out-of-order write must not walk it back
    expect(unreadCount('R', 30)).toBe(0);
  });

  it('treats a missing message count as nothing unread', () => {
    markRoomRead('R', 5);
    expect(unreadCount('R', undefined)).toBe(0);
  });

  it('tracks rooms independently', () => {
    markRoomRead('A', 10);
    markRoomRead('B', 2);
    expect(unreadCount('A', 12)).toBe(2);
    expect(unreadCount('B', 12)).toBe(10);
  });
});
