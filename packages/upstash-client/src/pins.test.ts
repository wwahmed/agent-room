import { describe, it, expect } from 'vitest';
import type { Message, PinnedMessage, Room } from '@agent-room/shared';
import { applyPinToggle, pinSnippet, setMessagePinned, MAX_PINNED_MESSAGES } from './pins.js';
import { MessageNotFoundError } from './messages.js';
import type { UpstashClient } from './client.js';

// T-14 setMessagePinned: an in-memory fake covering the three commands the
// implementation uses — LRANGE (find the message), GET/SET (room CAS).
function fakeClient(rows: Message[], room: Room): { client: UpstashClient; store: { room: string } } {
  const list = rows.map(r => JSON.stringify(r));
  const store = { room: JSON.stringify(room) };
  const client: UpstashClient = {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      if (cmd[0] === 'LRANGE') return list.slice() as unknown as T;
      if (cmd[0] === 'GET') return store.room as unknown as T;
      if (cmd[0] === 'SET') { store.room = String(cmd[2]); return 'OK' as unknown as T; }
      throw new Error(`unexpected command ${String(cmd[0])}`);
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      return cmds.map(() => 'OK') as unknown as T[];
    },
  };
  return { client, store };
}

const msg = (id: number, over: Partial<Message> = {}): Message => ({
  id,
  type: 'msg',
  name: 'Claude',
  initials: 'CL',
  color: '#0EA5E9',
  role: '',
  text: `message ${id}`,
  client: 'cc',
  time: id,
  ...over,
});

const baseRoom = (over: Partial<Room> = {}): Room => ({
  code: 'abc-def-ghj',
  topic: 'test',
  createdAt: 0,
  createdBy: 'Waqas',
  status: 'active',
  version: 1,
  participants: [],
  ...over,
});

const pin = (id: number, over: Partial<PinnedMessage> = {}): PinnedMessage => ({
  id, name: 'Claude', text: `message ${id}`, by: 'Waqas', at: id, ...over,
});

describe('T-14 applyPinToggle — bound, dedup, order', () => {
  it('appends the newest pin last and unpins by id', () => {
    const one = applyPinToggle(undefined, pin(1), true);
    const two = applyPinToggle(one, pin(2), true);
    expect(two.map(p => p.id)).toEqual([1, 2]);
    expect(applyPinToggle(two, pin(1), false).map(p => p.id)).toEqual([2]);
  });

  it('re-pinning an already-pinned id dedups and moves it to the tail', () => {
    const prior = [pin(1), pin(2)];
    const next = applyPinToggle(prior, pin(1, { at: 99 }), true);
    expect(next.map(p => p.id)).toEqual([2, 1]);
    expect(next[1]!.at).toBe(99);
  });

  it(`caps at ${MAX_PINNED_MESSAGES} by dropping the OLDEST pin`, () => {
    let pins: PinnedMessage[] = [];
    for (let i = 1; i <= MAX_PINNED_MESSAGES + 3; i++) pins = applyPinToggle(pins, pin(i), true);
    expect(pins).toHaveLength(MAX_PINNED_MESSAGES);
    expect(pins[0]!.id).toBe(4); // 1..3 fell off
    expect(pins[pins.length - 1]!.id).toBe(MAX_PINNED_MESSAGES + 3);
  });

  it('pinSnippet collapses whitespace and hard-truncates', () => {
    expect(pinSnippet('  a\n\n b\tc  ')).toBe('a b c');
    expect(pinSnippet('x'.repeat(500))).toHaveLength(120);
    expect(pinSnippet(undefined)).toBe('');
  });
});

describe('T-14 setMessagePinned — room-record persistence', () => {
  it('pins a stored message: denormalized entry lands on the room record', async () => {
    const { client, store } = fakeClient([msg(1), msg(2)], baseRoom());
    const out = await setMessagePinned(client, 'abc-def-ghj', 2, { name: 'Waqas' }, true);
    expect(out.pinned).toBe(true);
    expect(out.pinnedMessages).toHaveLength(1);
    expect(out.pinnedMessages[0]).toMatchObject({ id: 2, name: 'Claude', text: 'message 2', by: 'Waqas' });
    expect(out.target).toMatchObject({ id: 2, name: 'Claude' });
    const persisted = JSON.parse(store.room) as Room;
    expect(persisted.pinnedMessages?.map(p => p.id)).toEqual([2]);
    expect(persisted.version).toBe(2);
  });

  it('rejects pinning an unknown message id', async () => {
    const { client } = fakeClient([msg(1)], baseRoom());
    await expect(setMessagePinned(client, 'abc-def-ghj', 999, { name: 'Waqas' }, true))
      .rejects.toBeInstanceOf(MessageNotFoundError);
  });

  it('rejects pinning a system row', async () => {
    const { client } = fakeClient([msg(1, { type: 'sys', name: 'system' })], baseRoom());
    await expect(setMessagePinned(client, 'abc-def-ghj', 1, { name: 'Waqas' }, true))
      .rejects.toMatchObject({ name: 'BadRequestError' });
  });

  it('UNPINNING a message already trimmed from history still works', async () => {
    // The denormalized strip entry outlives the message; unpin must not be
    // blocked by the existence check or the pin becomes permanent.
    const room = baseRoom({ pinnedMessages: [pin(777)] });
    const { client, store } = fakeClient([msg(1)], room);
    const out = await setMessagePinned(client, 'abc-def-ghj', 777, { name: 'Waqas' }, false);
    expect(out.pinned).toBe(false);
    expect(out.pinnedMessages).toEqual([]);
    expect(out.target).toBeNull();
    expect((JSON.parse(store.room) as Room).pinnedMessages).toEqual([]);
  });
});
