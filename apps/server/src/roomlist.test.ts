import { describe, expect, it } from 'vitest';
import {
  listIndexedRoomPage,
  roomListCursor,
  roomListLimit,
  type RoomIndexEntry,
  type RoomIndexRecord,
  type RoomListStore,
} from './roomlist.js';

function fakeStore(size: number, stale = new Set<number>()) {
  const entries: RoomIndexEntry[] = Array.from({ length: size }, (_, i) => ({
    code: `room-${i}`,
    score: 10_000 - i,
  }));
  let largestRead = 0;
  let rangeCalls = 0;
  const removed: string[] = [];
  const store: RoomListStore = {
    async count() { return entries.length; },
    async range(start, stop) {
      rangeCalls += 1;
      return entries.slice(start, stop + 1);
    },
    async read(page) {
      largestRead = Math.max(largestRead, page.length);
      return page.map((entry): RoomIndexRecord => {
        const i = Number(entry.code.slice(5));
        if (stale.has(i)) return { raw: null, messageCountRaw: null };
        return {
          raw: JSON.stringify({
            code: entry.code,
            topic: `Room ${i}`,
            status: 'active',
            createdBy: 'Waqas',
            createdAt: 1_000 - i,
            participants: [{ name: 'Waqas' }],
          }),
          messageCountRaw: i,
        };
      });
    },
    async remove(codes) { removed.push(...codes); },
  };
  return { store, metrics: () => ({ largestRead, rangeCalls, removed }) };
}

describe('room list pagination', () => {
  it('clamps query values to safe bounded defaults', () => {
    expect(roomListLimit(null)).toBe(30);
    expect(roomListLimit('0')).toBe(30);
    expect(roomListLimit('250')).toBe(100);
    expect(roomListLimit('12.9')).toBe(12);
    expect(roomListCursor(null)).toBe(0);
    expect(roomListCursor('-1')).toBe(0);
    expect(roomListCursor('42.8')).toBe(42);
  });

  it('reads only the requested page from a 5,000-room corpus', async () => {
    const fake = fakeStore(5_000);
    const page = await listIndexedRoomPage(fake.store, 0, 30);
    expect(page.rooms).toHaveLength(30);
    expect(page.rooms[0]?.code).toBe('room-0');
    expect(page.rooms[29]?.code).toBe('room-29');
    expect(page.nextCursor).toBe('30');
    expect(page.hasMore).toBe(true);
    expect(fake.metrics()).toMatchObject({ largestRead: 30, rangeCalls: 1 });
  });

  it('continues after the cursor without duplicating the previous page', async () => {
    const fake = fakeStore(75);
    const page = await listIndexedRoomPage(fake.store, 30, 30);
    expect(page.rooms[0]?.code).toBe('room-30');
    expect(page.rooms[29]?.code).toBe('room-59');
    expect(page.nextCursor).toBe('60');
  });

  it('drops stale index members and still fills the page', async () => {
    const fake = fakeStore(40, new Set([1, 3, 4]));
    const page = await listIndexedRoomPage(fake.store, 0, 10);
    expect(page.rooms).toHaveLength(10);
    expect(page.rooms.map(r => r.code)).not.toContain('room-1');
    expect(fake.metrics().removed).toEqual(['room-1', 'room-3', 'room-4']);
    expect(page.nextCursor).toBe('10');
  });

  it('returns a terminal cursor for the final page', async () => {
    const fake = fakeStore(35);
    const page = await listIndexedRoomPage(fake.store, 30, 30);
    expect(page.rooms).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });
});
