import { describe, it, expect, beforeEach } from 'vitest';
import {
  firstUnreadMessageIndex,
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
