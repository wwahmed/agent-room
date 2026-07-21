import { describe, expect, it } from 'vitest';
import { ROOM_SORT_DEFAULT, resolveRoomSort, sortRooms } from './roomSort.js';

const rooms = [
  { code: 'AAA', createdAt: 100, lastActivityAt: 500 },
  { code: 'BBB', createdAt: 300, lastActivityAt: null },
  { code: 'CCC', createdAt: 200, lastActivityAt: 900 },
  { code: 'DDD', createdAt: 400, lastActivityAt: 250 },
];

describe('sortRooms', () => {
  it('defaults to most-recent activity first', () => {
    expect(ROOM_SORT_DEFAULT).toBe('activity-desc');
    expect(sortRooms(rooms, 'activity-desc').map(r => r.code)).toEqual(['CCC', 'AAA', 'BBB', 'DDD']);
  });

  it('a silent room ranks by creation, not "no activity"', () => {
    // BBB has no lastActivityAt; its activity is its createdAt (300).
    const order = sortRooms(rooms, 'activity-desc').map(r => r.code);
    expect(order.indexOf('BBB')).toBeLessThan(order.indexOf('DDD')); // 300 > 250
  });

  it('created orders use createdAt in both directions', () => {
    expect(sortRooms(rooms, 'created-desc').map(r => r.code)).toEqual(['DDD', 'BBB', 'CCC', 'AAA']);
    expect(sortRooms(rooms, 'created-asc').map(r => r.code)).toEqual(['AAA', 'CCC', 'BBB', 'DDD']);
  });

  it('does not mutate its input and is stable on ties', () => {
    const tied = [
      { code: 'ZZZ', createdAt: 100, lastActivityAt: 700 },
      { code: 'MMM', createdAt: 100, lastActivityAt: 700 },
    ];
    const copy = [...tied];
    expect(sortRooms(tied, 'activity-desc').map(r => r.code)).toEqual(['ZZZ', 'MMM']);
    expect(tied).toEqual(copy);
  });

  it('order is preserved across paging: sorting the merged list equals sorting the whole', () => {
    const pageOne = rooms.slice(0, 2);
    const pageTwo = rooms.slice(2);
    const merged = sortRooms([...sortRooms(pageOne, 'activity-desc'), ...pageTwo], 'activity-desc');
    expect(merged.map(r => r.code)).toEqual(sortRooms(rooms, 'activity-desc').map(r => r.code));
  });

  it('resolveRoomSort falls back to the default on junk', () => {
    expect(resolveRoomSort('activity-asc')).toBe('activity-asc');
    expect(resolveRoomSort('by-vibes')).toBe('activity-desc');
    expect(resolveRoomSort(null)).toBe('activity-desc');
  });
});
