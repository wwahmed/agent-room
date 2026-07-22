import { describe, expect, it } from 'vitest';
import {
  isQaRoom,
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

// T-34: the facepile payload. One-room store with hand-built participants so
// the derived agents array, ordering, cap, and stale count are pinned down.
function facepileStore(participants: unknown[]) {
  const store: RoomListStore = {
    async count() { return 1; },
    async range() { return [{ code: 'room-x', score: 1 }]; },
    async read() {
      return [{
        raw: JSON.stringify({
          code: 'room-x',
          topic: 'X',
          status: 'active',
          createdBy: 'Waqas',
          createdAt: 1,
          participants,
        }),
        messageCountRaw: 0,
      }];
    },
    async remove() {},
  };
  return store;
}

const agent = (name: string, opts: { listening?: boolean; staleMs?: number } = {}) => ({
  name,
  client: 'cc',
  color: '#abc',
  initials: name.slice(0, 2).toUpperCase(),
  listenUntil: opts.listening ? Date.now() + 60_000 : 0,
  lastSeenAt: Date.now() - (opts.staleMs ?? 0),
});

describe('room list agent facepile (T-34)', () => {
  it('emits per-agent faces with server presence verdicts and a stale count', async () => {
    const store = facepileStore([
      { name: 'Waqas', client: 'web', lastSeenAt: Date.now() },
      agent('Claude', { listening: true }),
      agent('Codex', { staleMs: 60 * 60_000 }),
    ]);
    const page = await listIndexedRoomPage(store, 0, 10);
    const room = page.rooms[0]!;
    expect(room.agentCount).toBe(2);
    expect(room.agentStaleCount).toBe(1);
    expect(room.agentsAllHealthy).toBe(false);
    // Healthy faces sort first so a stale agent never hides in the overflow.
    expect(room.agents.map(a => a.name)).toEqual(['Claude', 'Codex']);
    expect(room.agents[0]).toMatchObject({ state: 'listening', color: '#abc', initials: 'CL' });
    expect(['stale', 'disconnected']).toContain(room.agents[1]!.state);
  });

  it('caps the payload while counts reflect every agent', async () => {
    const store = facepileStore([
      agent('A1', { listening: true }),
      agent('A2', { listening: true }),
      agent('A3', { staleMs: 60 * 60_000 }),
      agent('A4', { listening: true }),
      agent('A5', { listening: true }),
      agent('A6', { staleMs: 60 * 60_000 }),
    ]);
    const page = await listIndexedRoomPage(store, 0, 10);
    const room = page.rooms[0]!;
    expect(room.agentCount).toBe(6);
    expect(room.agentStaleCount).toBe(2);
    expect(room.agents).toHaveLength(4);
    // The cap keeps healthy-first ordering: all four visible payload faces are
    // the healthy ones plus the first stale never displacing a healthy face.
    expect(room.agents.slice(0, 4).every(a => a.state === 'listening')).toBe(true);
  });

  it('reports zero agents for a humans-only room', async () => {
    const store = facepileStore([{ name: 'Waqas', client: 'web', lastSeenAt: Date.now() }]);
    const page = await listIndexedRoomPage(store, 0, 10);
    expect(page.rooms[0]!.agentCount).toBe(0);
    expect(page.rooms[0]!.agentStaleCount).toBe(0);
    expect(page.rooms[0]!.agents).toEqual([]);
  });
});

// T-114: QA/harness rooms never surface in the owner's nav.
describe('QA room exclusion (T-114)', () => {
  function qaStore(rooms: Array<Record<string, unknown>>) {
    const store: RoomListStore = {
      async count() { return rooms.length; },
      async range() { return rooms.map((r, i) => ({ code: String(r.code), score: 100 - i })); },
      async read(page) {
        return page.map(entry => ({
          raw: JSON.stringify(rooms.find(r => r.code === entry.code)),
          messageCountRaw: 0,
        }));
      },
      async remove() {},
    };
    return store;
  }
  const base = { status: 'active', createdBy: 'Claude', createdAt: 1, participants: [] };

  it('classifies qa-flagged and [QA]-prefixed rooms', () => {
    expect(isQaRoom({ qa: true, topic: 'anything' })).toBe(true);
    expect(isQaRoom({ topic: '[QA] receipt probe' })).toBe(true);
    expect(isQaRoom({ topic: 'Build: WakiDrive EV Nav' })).toBe(false);
    expect(isQaRoom({ qa: 'yes', topic: 'x' })).toBe(false);
  });

  it('drops QA rooms from the list while real rooms flow through', async () => {
    const store = qaStore([
      { ...base, code: 'real-room-one', topic: 'Build: WakiDrive EV Nav' },
      { ...base, code: 'gate-fixture', topic: 'Visual gate fixture (auto test room, safe to ignore)', qa: true },
      { ...base, code: 'probe-room', topic: '[QA] T-114 receipt probe' },
      { ...base, code: 'real-room-two', topic: 'Foundation planning' },
    ]);
    const page = await listIndexedRoomPage(store, 0, 10);
    expect(page.rooms.map(r => r.code)).toEqual(['real-room-one', 'real-room-two']);
  });
});
