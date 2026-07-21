import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { createRoom, joinRoom } from './rooms.js';
import { appendMessage, listMessages, getMessageTotalCount } from './messages.js';
import { backfillRoomArtifacts, listRoomArtifacts, artifactsKey } from './artifactIndex.js';

// T-71 durability proof: the exact regression the review found — produced
// work must survive transcript truncation (client pagination AND Redis
// LTRIM), byte-for-byte identical before and after.

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
      if (op === 'SET') { kv.set(key, parts[2] ?? ''); return 'OK' as T; }
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
  id, type: 'msg', name: 'GateA', initials: 'GA', color: '#000', role: '', client: 'cc', text, time: id,
} as unknown as Message);

describe('T-71 durable artifact index', () => {
  let client: UpstashClient;
  let code: string;

  beforeEach(async () => {
    client = listMemoryClient();
    code = 'dur-fix-one';
    await createRoom(client, { code, topic: 'Durability fixture room', createdBy: 'GateA' });
    await joinRoom(client, code, { name: 'GateA', role: '', color: '#000', initials: 'GA', client: 'cc', joinedAt: 1, lastSeenAt: 1 });
  });

  it('an early Decision survives LTRIM truncation that removes its source message', async () => {
    await appendMessage(client, code, msg(1, '[DECISION] The early decision that must never vanish.'));
    const before = await listRoomArtifacts(client, code);
    expect(before).toHaveLength(1);

    for (let i = 2; i <= MAX_MESSAGES_PER_ROOM + 40; i++) {
      await appendMessage(client, code, msg(i, `filler message ${i}`));
    }
    const total = (await getMessageTotalCount(client, code)) ?? 0;
    const retained = await listMessages(client, code, Math.max(0, total - MAX_MESSAGES_PER_ROOM));
    expect(retained.some(m => (m.text ?? '').includes('early decision'))).toBe(false);

    const after = await listRoomArtifacts(client, code);
    expect(after).toEqual(before);
  });

  it('backfill seeds legacy rooms from retained history once, idempotently, skipping prose mentions', async () => {
    await appendMessage(client, code, msg(1, '[RESULT] Legacy result stored before the index existed.'));
    await appendMessage(client, code, msg(2, 'Prose discussing the [TODO] tag inline must not count.'));
    // Simulate the pre-index world: wipe the index the hook just wrote.
    await client.command(['DEL', artifactsKey(code)]);
    expect(await listRoomArtifacts(client, code)).toHaveLength(0);

    await backfillRoomArtifacts(client, code);
    const seeded = await listRoomArtifacts(client, code);
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.kind).toBe('result');

    await backfillRoomArtifacts(client, code);
    expect(await listRoomArtifacts(client, code)).toHaveLength(1);
  });
});
