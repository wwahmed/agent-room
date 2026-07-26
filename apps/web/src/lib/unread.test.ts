import { describe, it, expect, beforeEach } from 'vitest';
import {
  firstUnreadMessageIndex,
  getReadCount,
  isSelfAuthored,
  isStatusPing,
  markRoomRead,
  markSelfMessageSeen,
  unmarkSelfMessageSeen,
  unreadCount,
} from './unread.js';

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

  it('a seed is DEVICE-LOCAL: no earned marker, no sync announcement (cross-room badge-clear bug)', () => {
    // When seeding wrote a real marker, T-126's sync pushed "fully read" for
    // every room a fresh browser profile merely LISTED — clearing badges on
    // every other device for rooms never actually read.
    const events: unknown[] = [];
    const g = globalThis as unknown as { window?: { dispatchEvent: (e: unknown) => void } };
    const priorWindow = g.window;
    g.window = { dispatchEvent: (e: unknown) => { events.push(e); } };
    try {
      expect(unreadCount('SEED-ONLY-ROOM', 40)).toBe(0); // seeds
      expect(getReadCount('SEED-ONLY-ROOM')).toBe(null); // nothing earned → nothing to sync
      expect(events).toHaveLength(0);                    // and nothing announced
      expect(unreadCount('SEED-ONLY-ROOM', 45)).toBe(5); // seed still counts new traffic
    } finally {
      if (priorWindow === undefined) delete g.window; else g.window = priorWindow;
    }
  });

  it('an earned marker at/above the seed retires it; below it, the seed still masks', () => {
    expect(unreadCount('SEEDED', 20)).toBe(0); // seed at 20
    markRoomRead('SEEDED', 10);                // read partway on this device
    expect(unreadCount('SEEDED', 20)).toBe(0); // seed (20) still masks, as before
    markRoomRead('SEEDED', 25);                // read past the seed
    expect(localStorage.getItem('wakichat:read-seed:SEEDED')).toBe(null);
    expect(unreadCount('SEEDED', 27)).toBe(2); // earned marker governs from here
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

  it('excludes a locally-authored message immediately while preserving other unread messages', () => {
    markRoomRead('R', 10, 'Waqas');
    markSelfMessageSeen('R', 'Waqas');
    expect(unreadCount('R', 11, 'Waqas')).toBe(0);
    expect(unreadCount('R', 12, 'Waqas')).toBe(1);
  });

  it('keeps pending self-authored counts isolated by browser identity', () => {
    markRoomRead('R', 3, 'Waqas');
    markSelfMessageSeen('R', 'Waqas');
    expect(unreadCount('R', 4, 'Waqas')).toBe(0);
    expect(unreadCount('R', 4, 'Claude')).toBe(1);
  });

  it('clears the pending self subtraction after the reader catches up', () => {
    markRoomRead('R', 10, 'Waqas');
    markSelfMessageSeen('R', 'Waqas');
    markRoomRead('R', 11, 'Waqas');
    expect(unreadCount('R', 12, 'Waqas')).toBe(1);
  });

  it('rolls back the pending self subtraction when send fails', () => {
    markRoomRead('R', 10, 'Waqas');
    markSelfMessageSeen('R', 'Waqas');
    unmarkSelfMessageSeen('R', 'Waqas');
    expect(unreadCount('R', 11, 'Waqas')).toBe(1);
  });

  it('recognizes only messages from the current web identity as self-authored', () => {
    expect(isSelfAuthored({ type: 'msg', client: 'web', name: 'Waqas' }, 'waqas')).toBe(true);
    expect(isSelfAuthored({ type: 'msg', client: 'cc', name: 'Waqas' }, 'Waqas')).toBe(false);
    expect(isSelfAuthored({ type: 'sys', client: 'web', name: 'Waqas' }, 'Waqas')).toBe(false);
  });

  it('places the unread divider on the first unread message from someone else', () => {
    const messages = [
      { type: 'msg', client: 'web', name: 'Claude' },
      { type: 'msg', client: 'web', name: 'Waqas' },
      { type: 'msg', client: 'cc', name: 'Claude' },
    ];
    expect(firstUnreadMessageIndex(messages, 13, 11, 'Waqas')).toBe(2);
  });

  it('returns no divider when every unread message is self-authored', () => {
    const messages = [
      { type: 'msg', client: 'cc', name: 'Claude' },
      { type: 'msg', client: 'web', name: 'Waqas' },
    ];
    expect(firstUnreadMessageIndex(messages, 2, 1, 'Waqas')).toBe(-1);
  });

  // T-20: stamped heartbeat/status pings are operational noise.
  it('classifies only metadata.kind === "status" as a status ping', () => {
    expect(isStatusPing({ metadata: { kind: 'status' } })).toBe(true);
    expect(isStatusPing({ metadata: { modeAtSend: 'open' } })).toBe(false);
    expect(isStatusPing({})).toBe(false);
  });

  it('skips status pings when placing the unread divider', () => {
    const messages = [
      { type: 'msg', client: 'cc', name: 'Claude' },
      { type: 'msg', client: 'cc', name: 'Codex', metadata: { kind: 'status' } },
      { type: 'msg', client: 'cc', name: 'Codex' },
    ];
    expect(firstUnreadMessageIndex(messages, 3, 1, 'Waqas')).toBe(2);
  });

  it('returns no divider when the only unread traffic is status pings', () => {
    const messages = [
      { type: 'msg', client: 'cc', name: 'Claude' },
      { type: 'msg', client: 'cc', name: 'Codex', metadata: { kind: 'status' } },
    ];
    expect(firstUnreadMessageIndex(messages, 2, 1, 'Waqas')).toBe(-1);
  });
});

// T-126: READ-STATE IS USER-STATE — the account-sync seam.
describe('account-level marker sync (T-126)', () => {
  beforeEach(() => localStorage.clear());

  it('mergeServerReadMarker folds in a HIGHER server count', async () => {
    const { mergeServerReadMarker, getReadCount } = await import('./unread.js');
    markRoomRead('AAA-BBB-CCC', 10);
    expect(mergeServerReadMarker('AAA-BBB-CCC', 25)).toBe(true);
    expect(getReadCount('AAA-BBB-CCC')).toBe(25);
  });

  it('mergeServerReadMarker never regresses a local marker', async () => {
    const { mergeServerReadMarker, getReadCount } = await import('./unread.js');
    markRoomRead('AAA-BBB-CCC', 30);
    expect(mergeServerReadMarker('AAA-BBB-CCC', 12)).toBe(false);
    expect(getReadCount('AAA-BBB-CCC')).toBe(30);
  });

  it('mergeServerReadMarker seeds a room with no local marker', async () => {
    const { mergeServerReadMarker, getReadCount } = await import('./unread.js');
    expect(mergeServerReadMarker('DDD-EEE-FFF', 8)).toBe(true);
    expect(getReadCount('DDD-EEE-FFF')).toBe(8);
  });

  it('markRoomRead announces marker advances for the push layer', () => {
    const events: Array<{ code: string; total: number }> = [];
    (globalThis as unknown as { window: unknown }).window = {
      dispatchEvent: (e: { detail: { code: string; total: number } }) => { events.push(e.detail); return true; },
    };
    (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
      detail: unknown;
      constructor(_type: string, init: { detail: unknown }) { this.detail = init.detail; }
    };
    try {
      markRoomRead('AAA-BBB-CCC', 5);
      markRoomRead('AAA-BBB-CCC', 3); // no advance, no event
      markRoomRead('AAA-BBB-CCC', 9);
      expect(events).toEqual([
        { code: 'AAA-BBB-CCC', total: 5 },
        { code: 'AAA-BBB-CCC', total: 9 },
      ]);
    } finally {
      delete (globalThis as { window?: unknown }).window;
      delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
    }
  });
});
