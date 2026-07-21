import { describe, expect, it } from 'vitest';
import { mergeRoomPages, roomsUrl, type RoomSummary } from './identity.js';

const room = (code: string, lastActivityAt: number): RoomSummary => ({
  code,
  topic: code,
  status: 'active',
  createdBy: 'Waqas',
  createdAt: lastActivityAt - 1,
  participants: 1,
  lastActivityAt,
  messageCount: 0,
});

describe('paged room list client', () => {
  it('builds a bounded initial URL and includes a continuation cursor', () => {
    expect(roomsUrl()).toBe('/api/rooms?limit=30');
    expect(roomsUrl('60', 25)).toBe('/api/rooms?limit=25&cursor=60');
  });

  it('merges pages by stable room code and preserves recent-first ordering', () => {
    const merged = mergeRoomPages(
      [room('newest', 30), room('duplicate', 20)],
      [room('duplicate', 25), room('oldest', 10)],
    );
    expect(merged.map(item => item.code)).toEqual(['newest', 'duplicate', 'oldest']);
    expect(merged[1]?.lastActivityAt).toBe(25);
  });
});
