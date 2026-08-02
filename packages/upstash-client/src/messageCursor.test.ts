import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { createRoom, joinRoom } from './rooms.js';
import { appendMessage, listMessagesPage, getMessageTotalCount, listMessages } from './messages.js';

// T-52 — the listen cursor.
//
// Reproduces the defect exactly as it was hit live in the "Chat Admin 2.0"
// room: room_join returned a cursor of 500 on a room holding ~3,300 messages,
// and every room_listen with the returned cursor re-delivered the SAME 500
// messages (~900 KB) while the cursor crawled 500 → 1000 → 1500 → 2000. The
// agent never parked a real listen. Working around it by passing a message
// timestamp as the cursor produced the opposite failure — permanent silence
// that looks exactly like a quiet room.

function listMemoryClient(): UpstashClient {
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const list = (k: string) => { if (!lists.has(k)) lists.set(k, []); return lists.get(k)!; };
  return {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      const parts = cmd.map(String);
      const op = (parts[0] ?? '').toUpperCase();
      const key = parts[1] ?? '';
      if (op === 'GET') return (kv.get(key) ?? null) as T;
      if (op === 'SET') {
        if (parts.includes('NX') && kv.has(key)) return null as T;
        kv.set(key, parts[2] ?? '');
        return 'OK' as T;
      }
      if (op === 'DEL') { kv.delete(key); lists.delete(key); return 1 as T; }
      if (op === 'EXPIRE') return 1 as T;
      if (op === 'INCR') { const v = Number(kv.get(key) ?? '0') + 1; kv.set(key, String(v)); return v as T; }
      if (op === 'RPUSH') { list(key).push(...parts.slice(2)); return list(key).length as T; }
      if (op === 'LLEN') return list(key).length as T;
      if (op === 'LRANGE') {
        const arr = list(key);
        let start = Number(parts[2]); let stop = Number(parts[3]);
        if (start < 0) start = Math.max(0, arr.length + start);
        if (stop < 0) stop = arr.length + stop;
        return arr.slice(start, stop + 1) as T;
      }
      if (op === 'LTRIM') {
        const arr = list(key);
        let start = Number(parts[2]); let stop = Number(parts[3]);
        if (start < 0) start = Math.max(0, arr.length + start);
        if (stop < 0) stop = arr.length + stop;
        lists.set(key, arr.slice(start, stop + 1));
        return 'OK' as T;
      }
      if (op === 'EVAL') return 0 as T;
      throw new Error(`unsupported in test client: ${op}`);
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      const out: T[] = [];
      for (const c of cmds) out.push(await this.command<T>(c));
      return out;
    },
  } as UpstashClient;
}

const msg = (id: number, text: string): Message => ({
  id, type: 'msg', name: 'Speaker', initials: 'SP', color: '#000', role: '', client: 'cc', text, time: id,
} as unknown as Message);

let client: UpstashClient;
const CODE = 'hail-cow-dart-fixture';

async function seed(count: number): Promise<void> {
  for (let i = 1; i <= count; i++) await appendMessage(client, CODE, msg(i, `message ${i}`));
}

beforeEach(async () => {
  client = listMemoryClient();
  await createRoom(client, { code: CODE, topic: 'Cursor fixture', createdBy: 'Host' });
  await joinRoom(client, CODE, { name: 'Speaker', role: '', color: '#000', initials: 'SP', client: 'cc', joinedAt: 1, lastSeenAt: 1 });
});

describe('T-52: a long-lived room and the listen cursor', () => {
  it('serves an absolute cursor on a room under the retention cap', async () => {
    await seed(5);
    const page = await listMessagesPage(client, CODE, 0);
    expect(page.messages).toHaveLength(5);
    expect(page.nextCursor).toBe(5);
    expect(page.totalCount).toBe(5);
    expect(page.fit).toBe('exact');
  });

  it('reports a quiet room as quiet, not as a cursor problem', async () => {
    await seed(5);
    const page = await listMessagesPage(client, CODE, 5);
    expect(page.messages).toHaveLength(0);
    expect(page.nextCursor).toBe(5);
    expect(page.fit).toBe('exact');
  });

  // ---- the replay ----

  it('does not replay the retained window: a cursor below the trim point lands past it in ONE call', async () => {
    const total = MAX_MESSAGES_PER_ROOM + 2861; // the live room's rough shape
    await seed(total);
    expect(await getMessageTotalCount(client, CODE)).toBe(total);

    // A cursor of 500 is what room_join used to hand back: the size of the
    // retained window, not the room's absolute position.
    const page = await listMessagesPage(client, CODE, MAX_MESSAGES_PER_ROOM);
    expect(page.fit).toBe('trimmed');
    // The whole surviving window comes back once...
    expect(page.messages).toHaveLength(MAX_MESSAGES_PER_ROOM);
    // ...and the cursor jumps to the TRUE end, not to 500 + 500.
    expect(page.nextCursor).toBe(total);
    expect(page.nextCursor).not.toBe(MAX_MESSAGES_PER_ROOM * 2);

    // Following the served cursor, the very next call is quiet. Under the old
    // arithmetic this took (2861 / 500) ≈ 6 calls, each re-sending the entire
    // window, before the loop could ever block.
    const second = await listMessagesPage(client, CODE, page.nextCursor);
    expect(second.messages).toHaveLength(0);
    expect(second.fit).toBe('exact');
  });

  it('the loop converges in one step for ANY cursor below the trim point', async () => {
    const total = MAX_MESSAGES_PER_ROOM + 1000;
    await seed(total);
    // Enumerate rather than sampling one convenient value.
    for (const start of [0, 1, 250, 500, 999, 1000, 1499]) {
      const page = await listMessagesPage(client, CODE, start);
      expect(page.nextCursor).toBe(total);
      const next = await listMessagesPage(client, CODE, page.nextCursor);
      expect(next.messages).toHaveLength(0);
    }
  });

  it('a following loop receives each new message exactly once after re-anchoring', async () => {
    const total = MAX_MESSAGES_PER_ROOM + 1000;
    await seed(total);
    let cursor = (await listMessagesPage(client, CODE, 0)).nextCursor;

    await appendMessage(client, CODE, msg(total + 1, 'the message that must arrive'));
    const first = await listMessagesPage(client, CODE, cursor);
    expect(first.messages.map(m => m.text)).toEqual(['the message that must arrive']);
    cursor = first.nextCursor;

    // ...and is not delivered a second time.
    const again = await listMessagesPage(client, CODE, cursor);
    expect(again.messages).toHaveLength(0);
  });

  // ---- the silence ----

  it('a cursor past the newest message is reported, not silently swallowed', async () => {
    await seed(10);
    // What I actually passed when working around the replay: a message
    // timestamp. It is astronomically past the end.
    const page = await listMessagesPage(client, CODE, 1785695304847);
    expect(page.messages).toHaveLength(0);
    expect(page.fit).toBe('ahead');
    // Re-anchored to the true end, so following the served cursor recovers.
    expect(page.nextCursor).toBe(10);

    await appendMessage(client, CODE, msg(11, 'sent while the listener was deaf'));
    const after = await listMessagesPage(client, CODE, page.nextCursor);
    expect(after.messages.map(m => m.text)).toEqual(['sent while the listener was deaf']);
  });

  it('distinguishes "past the end" from "quiet" — the two used to be identical', async () => {
    await seed(10);
    const quiet = await listMessagesPage(client, CODE, 10);
    const ahead = await listMessagesPage(client, CODE, 11);
    expect(quiet.messages).toHaveLength(0);
    expect(ahead.messages).toHaveLength(0);
    // Same empty batch, different verdict. Without this the caller cannot tell
    // "nobody spoke" from "you will never hear anything again".
    expect(quiet.fit).toBe('exact');
    expect(ahead.fit).toBe('ahead');
  });

  it('reports ahead on an empty room too', async () => {
    const page = await listMessagesPage(client, CODE, 40);
    expect(page.messages).toHaveLength(0);
    expect(page.fit).toBe('ahead');
    expect(page.nextCursor).toBe(0);
  });

  // ---- misbehaving inputs ----

  it.each([
    ['negative', -5],
    ['NaN', Number.NaN],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['fractional', 2.7],
  ])('treats a %s cursor as a position, never as a backwards index', async (_label, value) => {
    await seed(5);
    const page = await listMessagesPage(client, CODE, value as number);
    expect(page.messages.length).toBeGreaterThan(0);
    expect(page.nextCursor).toBe(5);
    expect(Number.isInteger(page.nextCursor)).toBe(true);
  });

  it('Infinity is ahead, not an error', async () => {
    await seed(5);
    const page = await listMessagesPage(client, CODE, Number.POSITIVE_INFINITY);
    expect(page.fit).toBe('ahead');
    expect(page.nextCursor).toBe(5);
  });

  it('honors limit and still returns the cursor for what it actually served', async () => {
    await seed(10);
    const page = await listMessagesPage(client, CODE, 2, 3);
    expect(page.messages.map(m => m.text)).toEqual(['message 3', 'message 4', 'message 5']);
    expect(page.nextCursor).toBe(5);
    expect(page.fit).toBe('exact');
  });

  it('keeps listMessages behaviour identical for its existing callers', async () => {
    await seed(MAX_MESSAGES_PER_ROOM + 100);
    // The messages-only wrapper must return the same rows the page does.
    const page = await listMessagesPage(client, CODE, 0);
    const plain = await listMessages(client, CODE, 0);
    expect(plain.map(m => m.id)).toEqual(page.messages.map(m => m.id));
  });
});
