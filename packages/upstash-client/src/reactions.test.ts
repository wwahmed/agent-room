import { describe, it, expect } from 'vitest';
import type { Message } from '@agent-room/shared';
import { applyMessageReaction, MessageNotFoundError } from './messages.js';
import type { UpstashClient } from './client.js';

// T-121 applyMessageReaction: an in-memory list-backed fake client. LRANGE
// returns the stored rows; LSET rewrites one in place — exactly the two
// commands the implementation uses.
function fakeClient(rows: Message[]): { client: UpstashClient; rows: string[] } {
  const list = rows.map(r => JSON.stringify(r));
  const client: UpstashClient = {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      if (cmd[0] === 'LRANGE') return list.slice() as unknown as T;
      throw new Error(`unexpected command ${String(cmd[0])}`);
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      for (const cmd of cmds) {
        if (cmd[0] === 'LSET') list[Number(cmd[2])] = String(cmd[3]);
        // EXPIRE is a no-op in the fake
      }
      return cmds.map(() => 'OK') as unknown as T[];
    },
  };
  return { client, rows: list };
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

describe('T-121 applyMessageReaction', () => {
  it('adds a reaction and persists it on the stored row', async () => {
    const { client, rows } = fakeClient([msg(1), msg(2)]);
    const out = await applyMessageReaction(client, 'abc-def-ghj', 2, { name: 'Waqas', client: 'web' }, 'ack');
    expect(out.added).toBe(true);
    expect(out.reactions).toHaveLength(1);
    expect(out.reactions[0]).toMatchObject({ kind: 'ack', name: 'Waqas', client: 'web' });
    expect(out.target).toMatchObject({ id: 2, name: 'Claude' });
    const stored = JSON.parse(rows[1]!) as Message;
    expect(stored.reactions).toHaveLength(1);
    expect(stored.reactions![0]!.kind).toBe('ack');
  });

  it('toggles the same reaction off on a second application', async () => {
    const { client, rows } = fakeClient([msg(1)]);
    await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'ack');
    const out = await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'ack');
    expect(out.added).toBe(false);
    expect(out.reactions).toHaveLength(0);
    expect((JSON.parse(rows[0]!) as Message).reactions).toHaveLength(0);
  });

  it('makes ack and reject mutually exclusive per person', async () => {
    const { client, rows } = fakeClient([msg(1)]);
    await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'ack');
    const out = await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'reject');
    expect(out.added).toBe(true);
    expect(out.reactions).toHaveLength(1);
    expect(out.reactions[0]!.kind).toBe('reject');
    expect((JSON.parse(rows[0]!) as Message).reactions).toHaveLength(1);
  });

  it('keeps other reactors intact while toggling one person', async () => {
    const { client } = fakeClient([msg(1, { reactions: [{ kind: 'ack', name: 'Codex', client: 'cc', time: 5 }] })]);
    const out = await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'reject');
    expect(out.reactions).toHaveLength(2);
    expect(out.reactions.map(r => r.name).sort()).toEqual(['Codex', 'Waqas']);
  });

  it('distinguishes same-name reactors on different clients', async () => {
    const { client } = fakeClient([msg(1, { reactions: [{ kind: 'ack', name: 'Waqas', client: 'cc', time: 5 }] })]);
    const out = await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'ack');
    expect(out.reactions).toHaveLength(2);
  });

  it('throws MessageNotFoundError for an unknown id', async () => {
    const { client } = fakeClient([msg(1)]);
    await expect(applyMessageReaction(client, 'abc-def-ghj', 999, { name: 'Waqas', client: 'web' }, 'ack'))
      .rejects.toBeInstanceOf(MessageNotFoundError);
  });

  it('refuses to react to a sys row', async () => {
    const { client } = fakeClient([msg(1, { type: 'sys', name: 'system' })]);
    await expect(applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'ack'))
      .rejects.toThrow(/system rows/);
  });

  it('truncates the target snippet and collapses whitespace', async () => {
    const { client } = fakeClient([msg(1, { text: `  a${'x'.repeat(200)}\n\nb  ` })]);
    const out = await applyMessageReaction(client, 'abc-def-ghj', 1, { name: 'Waqas', client: 'web' }, 'ack');
    expect(out.target.text.length).toBeLessThanOrEqual(80);
    expect(out.target.text).not.toMatch(/\n/);
  });
});
