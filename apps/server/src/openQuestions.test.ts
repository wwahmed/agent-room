import { describe, expect, it } from 'vitest';
import { openQuestionCount, type RoomIndexEntry, type RoomIndexRecord } from './roomlist.js';
import { listIndexedRoomPage, type RoomListStore } from './roomlist.js';

// The host's report: "when a room needs me to answer a question, a question is
// popped up but there is no indication of that in the room badges, not even an
// unread message counter."
//
// The unread counter cannot cover this by construction — the question appears
// while he is IN the room, and being in the room marks it read — so the room
// summary carries the open count directly. These lock down the reading of that
// counter, because a badge that cries wolf is worse than no badge.

describe('open-question counter parsing', () => {
  it('reads a real count', () => {
    expect(openQuestionCount(3)).toBe(3);
    expect(openQuestionCount('3')).toBe(3);
  });

  // Everything below must read as "nothing waiting". Redis hands back strings,
  // missing keys, and occasionally junk; none of it may invent a badge.
  it.each([
    ['a missing key', null],
    ['an undefined field', undefined],
    ['an empty string', ''],
    ['a zero', 0],
    ['a zero string', '0'],
    ['a negative (double-decrement)', -2],
    ['a negative string', '-2'],
    ['non-numeric junk', 'many'],
    ['NaN', Number.NaN],
    ['whitespace', '   '],
  ])('reads %s as no badge', (_label, raw) => {
    expect(openQuestionCount(raw as string | number | null | undefined)).toBe(0);
  });

  it('floors a fractional count rather than rendering "1.5 waiting"', () => {
    expect(openQuestionCount(1.9)).toBe(1);
  });

  it('does not saturate a large backlog into a wrong number', () => {
    expect(openQuestionCount('250')).toBe(250);
  });
});

function storeFor(records: Array<{ code: string; raw: unknown; open?: string | number | null }>): RoomListStore {
  const entries: RoomIndexEntry[] = records.map((r, i) => ({ code: r.code, score: 1000 - i }));
  return {
    async count() { return entries.length; },
    async range(start, stop) { return entries.slice(start, stop + 1); },
    async read(asked) {
      return asked.map((entry): RoomIndexRecord => {
        const found = records.find(r => r.code === entry.code)!;
        return {
          raw: typeof found.raw === 'string' ? found.raw : JSON.stringify(found.raw),
          messageCountRaw: 10,
          openQuestionsRaw: found.open ?? null,
        };
      });
    },
    async remove() { /* no-op */ },
  };
}

const room = (code: string) => ({ code, topic: `Room ${code}`, status: 'active', createdBy: 'Waqas', createdAt: 1, participants: [] });

describe('the room summary carries the open-question count', () => {
  it('surfaces a waiting question on the card', async () => {
    const page = await listIndexedRoomPage(storeFor([{ code: 'a', raw: room('a'), open: 2 }]), 0, 30);
    expect(page.rooms[0]!.openQuestionCount).toBe(2);
  });

  it('reports zero for a room with nothing waiting', async () => {
    const page = await listIndexedRoomPage(storeFor([{ code: 'a', raw: room('a') }]), 0, 30);
    expect(page.rooms[0]!.openQuestionCount).toBe(0);
  });

  it('keeps each room\'s count on its OWN row', async () => {
    // The store reads three keys per room in one pipeline; an off-by-one in
    // that striding would attribute one room's questions to another, which is
    // worse than no badge — it sends the owner to the wrong room.
    const page = await listIndexedRoomPage(
      storeFor([
        { code: 'a', raw: room('a'), open: 0 },
        { code: 'b', raw: room('b'), open: 5 },
        { code: 'c', raw: room('c'), open: 1 },
      ]),
      0,
      30,
    );
    expect(page.rooms.map(r => [r.code, r.openQuestionCount])).toEqual([['a', 0], ['b', 5], ['c', 1]]);
  });
});
