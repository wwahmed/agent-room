import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ROOM_SORTS, applyFrozenOrder, isRoomSort, resolveRoomSort, sortRooms } from './roomSort.js';

const rail = readFileSync(new URL('../components/RoomListPane.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../screens/Home.tsx', import.meta.url), 'utf8');

const room = (code: string, topic: string, lastActivityAt: number) =>
  ({ code, topic, lastActivityAt, createdAt: 1 });

// T-38: the host typed into the wrong room three times in one afternoon and
// diagnosed it himself — "sometimes I start typing in the wrong room because room
// position changes." Every pre-existing sort was time-keyed, so every one of them
// reshuffles while you look away.
describe('Room order that holds still', () => {
  it('offers a name order at all — every other option is time-keyed', () => {
    expect(isRoomSort('name-asc')).toBe(true);
    expect(ROOM_SORTS.map(o => o.value)).toContain('name-asc');
    const timeKeyed = ROOM_SORTS.filter(o => o.value !== 'name-asc');
    expect(timeKeyed.every(o => /activity|created/.test(o.value))).toBe(true);
  });

  it('ignores activity entirely, so a busy room does not jump the queue', () => {
    const rooms = [
      room('a-a-a', 'Zebra', 9_000),      // busiest
      room('b-b-b', 'apple', 1_000),
      room('c-c-c', 'Mango', 5_000),
    ];
    expect(sortRooms(rooms, 'name-asc').map(r => r.topic)).toEqual(['apple', 'Mango', 'Zebra']);
    // Same input, wildly different activity — same order. That is the point.
    const busier = rooms.map(r => ({ ...r, lastActivityAt: r.code === 'b-b-b' ? 99_999 : 1 }));
    expect(sortRooms(busier, 'name-asc').map(r => r.topic)).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('breaks ties on the room code, so duplicate topics never swap places', () => {
    // Without a deterministic tiebreak, two rooms sharing a topic can trade
    // positions between renders and "fixed order" still moves under the cursor.
    const dupes = [room('z-z-z', 'Chat Admin', 5), room('a-a-a', 'Chat Admin', 9)];
    expect(sortRooms(dupes, 'name-asc').map(r => r.code)).toEqual(['a-a-a', 'z-z-z']);
    expect(sortRooms([...dupes].reverse(), 'name-asc').map(r => r.code)).toEqual(['a-a-a', 'z-z-z']);
  });

  it('sorts numbers like a human and tolerates a missing topic or createdAt', () => {
    const numbered = [room('a-a-a', 'Room 10', 1), room('b-b-b', 'Room 2', 1)];
    expect(sortRooms(numbered, 'name-asc').map(r => r.topic)).toEqual(['Room 2', 'Room 10']);
    // The rail's payload omits createdAt on some rows; that must not throw.
    const sparse = [{ code: 'b-b-b' }, { code: 'a-a-a', topic: 'A' }];
    expect(() => sortRooms(sparse, 'name-asc')).not.toThrow();
    expect(() => sortRooms(sparse, 'created-desc')).not.toThrow();
    expect(resolveRoomSort('nonsense')).toBe('activity-desc');
  });

  it('the desktop rail now honours the preference and can change it', () => {
    // It previously rendered the server's activity order and ignored the
    // preference, so a fixed order chosen on Home left the rail reshuffling —
    // and the rail is the surface being mis-clicked.
    expect(rail).toContain('sortRooms((rooms ?? []).filter((r) => !r.archived), sort)');
    expect(rail).toContain('data-gate="rail-room-sort"');
    expect(rail).toContain('subscribeRoomSort(setSort)');
  });

  it('both surfaces share one preference, written through one path', () => {
    // localStorage does not notify the tab that wrote it, so a plain setItem
    // would leave the other surface stale until reload.
    expect(home).toContain('saveRoomSort(value)');
    expect(home).toContain('subscribeRoomSort(setRoomSort)');
    expect(home).not.toContain('localStorage.setItem(ROOM_SORT_STORAGE_KEY');
    expect(rail).toContain('saveRoomSort(next)');
  });
});

// T-45: the reading pane never swaps, but a ROW moving out from under a click has
// the same outcome — a message in the wrong room. Freeze the order while the rail
// is being used.
describe('Frozen order while the rail is in use', () => {
  const r = (code: string) => ({ code, topic: code, createdAt: 1, lastActivityAt: 1 });

  it('holds the snapshot order even after the live order changes', () => {
    const live = [r('c'), r('a'), r('b')];           // activity reshuffled to c,a,b
    const frozen = ['a', 'b', 'c'];                   // what was on screen when entered
    expect(applyFrozenOrder(live, frozen).map(x => x.code)).toEqual(['a', 'b', 'c']);
  });

  it('drops rooms that vanished and APPENDS new ones instead of inserting them', () => {
    // Inserting a new room at its "correct" position is exactly the shift this
    // prevents; appending keeps every row already on screen where it was.
    const live = [r('new'), r('a'), r('b')];
    expect(applyFrozenOrder(live, ['a', 'gone', 'b']).map(x => x.code)).toEqual(['a', 'b', 'new']);
  });

  it('is a no-op when nothing is frozen, and never mutates the input', () => {
    const live = [r('a'), r('b')];
    expect(applyFrozenOrder(live, null).map(x => x.code)).toEqual(['a', 'b']);
    expect(applyFrozenOrder(live, []).map(x => x.code)).toEqual(['a', 'b']);
    const copy = applyFrozenOrder(live, ['b', 'a']);
    expect(copy).not.toBe(live);
    expect(live.map(x => x.code)).toEqual(['a', 'b']);
  });

  it('the rail freezes on pointer/focus entry and thaws on leave', () => {
    const rail = readFileSync(new URL('../components/RoomListPane.tsx', import.meta.url), 'utf8');
    expect(rail).toContain('onPointerEnter={freeze}');
    expect(rail).toContain('onPointerLeave={thaw}');
    expect(rail).toContain('onFocusCapture={freeze}');
    // Keyboard: only thaw when focus actually left the rail, not when it moves
    // between rows inside it.
    expect(rail).toContain('if (!e.currentTarget.contains(e.relatedTarget as Node)) thaw();');
    expect(rail).toContain('applyFrozenOrder(ordered, frozen)');
  });
});
