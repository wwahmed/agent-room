import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { createRoom, joinRoom } from './rooms.js';
import { appendMessage, listMessages, getMessageTotalCount } from './messages.js';
import { backfillRoomArtifacts, ensureArtifactIndex, listRoomArtifacts, artifactsKey, ARTIFACT_INDEX_VERSION } from './artifactIndex.js';
import { artifactAppendCommands, artifactBackfillKey } from './artifactStore.js';

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

describe('T-71 durable index — review failure modes', () => {
  let client: UpstashClient;
  const code = 'dur-fix-two';

  beforeEach(async () => {
    client = listMemoryClient();
    await createRoom(client, { code, topic: 'Failure-mode fixture', createdBy: 'GateA' });
    await joinRoom(client, code, { name: 'GateA', role: '', color: '#000', initials: 'GA', client: 'cc', joinedAt: 1, lastSeenAt: 1 });
  });

  it('ordinary messages still refresh the index TTL (EXPIRE always emitted)', () => {
    const cmds = artifactAppendCommands(code, []);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]![0]).toBe('EXPIRE');
  });

  it('backfill MERGES legacy work even when a post-deploy artifact already exists', async () => {
    await appendMessage(client, code, msg(1, '[DECISION] Legacy decision from before the index.'));
    await client.command(['DEL', artifactsKey(code)]); // simulate pre-index world
    await appendMessage(client, code, msg(2, '[RESULT] Fresh post-deploy result.'));
    expect(await listRoomArtifacts(client, code)).toHaveLength(1);
    await backfillRoomArtifacts(client, code);
    const merged = await listRoomArtifacts(client, code);
    expect(merged.map(a => a.kind).sort()).toEqual(['decision', 'result']);
  });

  it('a concurrent caller holding the lock cannot double-seed; read dedupes by id', async () => {
    await appendMessage(client, code, msg(1, '[DECISION] Only once.'));
    // Second backfill after the lock exists is a no-op.
    await backfillRoomArtifacts(client, code);
    await backfillRoomArtifacts(client, code);
    expect(await listRoomArtifacts(client, code)).toHaveLength(1);
    // Even a raw duplicate row (lost race) never reaches readers.
    const dup = (await listRoomArtifacts(client, code))[0]!;
    await client.command(['RPUSH', artifactsKey(code), JSON.stringify(dup)]);
    expect(await listRoomArtifacts(client, code)).toHaveLength(1);
  });

  it('pagination cannot change the returned set (window-independent reads)', async () => {
    await appendMessage(client, code, msg(1, '[DECISION] Anchor decision.'));
    const before = await listRoomArtifacts(client, code);
    for (let i = 2; i <= MAX_MESSAGES_PER_ROOM + 10; i++) await appendMessage(client, code, msg(i, `filler ${i}`));
    expect(await listRoomArtifacts(client, code)).toEqual(before);
    expect(artifactBackfillKey(code)).toContain(code);
  });
});

describe('T-71 durable index — lock correctness (rev15 review)', () => {
  const code = 'dur-fix-three';

  async function seedLegacy(client: UpstashClient) {
    await createRoom(client, { code, topic: 'Lock fixture', createdBy: 'GateA' });
    await joinRoom(client, code, { name: 'GateA', role: '', color: '#000', initials: 'GA', client: 'cc', joinedAt: 1, lastSeenAt: 1 });
    await appendMessage(client, code, msg(1, '[DECISION] Legacy work to recover.'));
    await client.command(['DEL', artifactsKey(code)]); // pre-index world
  }

  it('a failure between lock and write does NOT suppress recovery: retry succeeds', async () => {
    const client = listMemoryClient();
    await seedLegacy(client);
    const failing: UpstashClient = {
      command: (c: readonly (string | number)[]) => {
        if (String(c[0]).toUpperCase() === 'LRANGE' && String(c[1]).startsWith('room-msgs:')) {
          throw new Error('boom mid-merge');
        }
        return client.command(c as never);
      },
      pipeline: (cs: readonly (readonly (string | number)[])[]) => client.pipeline(cs as never),
    } as UpstashClient;
    await expect(backfillRoomArtifacts(failing, code)).rejects.toThrow('boom');
    // version key must NOT be set; retry with a healthy client recovers.
    expect(await client.command(['GET', `room-artifacts-version:${code}`])).toBeNull();
    await backfillRoomArtifacts(client, code);
    expect(await listRoomArtifacts(client, code)).toHaveLength(1);
  });

  it('two OVERLAPPING first reads cannot duplicate the stored list', async () => {
    const client = listMemoryClient();
    await seedLegacy(client);
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const slow: UpstashClient = {
      command: async (c: readonly (string | number)[]) => {
        if (String(c[0]).toUpperCase() === 'LRANGE' && String(c[1]).startsWith('room-msgs:')) await gate;
        return client.command(c as never);
      },
      pipeline: async (cs: readonly (readonly (string | number)[])[]) => client.pipeline(cs as never),
    } as UpstashClient;
    const a = ensureArtifactIndex(slow, code);
    const b = ensureArtifactIndex(slow, code); // lock NX fails
    const bResult = await b;
    // The contended reader is TOLD the rebuild is pending — the API layer
    // must answer Loading, never a false empty (rev16 item 2).
    expect(bResult.pending).toBe(true);
    release();
    const aResult = await a;
    expect(aResult.pending).toBe(false);
    // The RAW stored list — not a deduped read — has exactly one entry.
    expect(await client.command(['LLEN', artifactsKey(code)])).toBe(1);
  });
});

describe('T-71 durable index — rev16 review items', () => {
  const code = 'dur-fix-four';

  async function fresh(client: UpstashClient) {
    await createRoom(client, { code, topic: 'Rev16 fixture', createdBy: 'GateA' });
    await joinRoom(client, code, { name: 'GateA', role: '', color: '#000', initials: 'GA', client: 'cc', joinedAt: 1, lastSeenAt: 1 });
  }

  it('lock expiry/takeover: a slow first holder cannot delete the successor lock', async () => {
    const client = listMemoryClient();
    await fresh(client);
    await appendMessage(client, code, msg(1, '[DECISION] Anchor.'));
    await client.command(['DEL', artifactsKey(code)]);
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const slow: UpstashClient = {
      command: async (c: readonly (string | number)[]) => {
        if (String(c[0]).toUpperCase() === 'LRANGE' && String(c[1]).startsWith('room-msgs:')) await gate;
        return client.command(c as never);
      },
      pipeline: async (cs: readonly (readonly (string | number)[])[]) => client.pipeline(cs as never),
    } as UpstashClient;
    const a = ensureArtifactIndex(slow, code);
    // Simulate the 30s TTL expiring while A is still mid-rebuild, then B takes over.
    await client.command(['DEL', `room-artifacts-backfill-lock:${code}`]);
    const b = await ensureArtifactIndex(client, code);
    expect(b.pending).toBe(false);
    const bLockGone = await client.command(['GET', `room-artifacts-backfill-lock:${code}`]);
    expect(bLockGone).toBeNull(); // B released its own lock after finishing
    release();
    await a; // A finishes; its compare-and-delete must NOT touch anything it no longer owns
    expect(await listRoomArtifacts(client, code)).toHaveLength(1);
    expect(await client.command(['GET', `room-artifacts-version:${code}`])).toBe(ARTIFACT_INDEX_VERSION);
  });

  it('migrates a pre-rev16 index: truncated legacy rows upgrade, trimmed-source rows survive', async () => {
    const client = listMemoryClient();
    await fresh(client);
    // A retained multiline decision whose legacy row was truncated + globally numbered.
    await appendMessage(client, code, msg(1, '[DECISION] Locked:\n1. one\n2. two'));
    await client.command(['DEL', artifactsKey(code)]);
    await client.command(['RPUSH', artifactsKey(code), JSON.stringify({ id: '1-7', kind: 'decision', text: 'Locked:', sourceMessageId: 1, author: 'GateA', time: 1 })]);
    // A legacy row whose source message no longer exists anywhere.
    await client.command(['RPUSH', artifactsKey(code), JSON.stringify({ id: '999-3', kind: 'result', text: 'Ancient result.', sourceMessageId: 999, author: 'GateA', time: 0 })]);
    // Simulate the rev15 done key that would have skipped migration forever.
    await client.command(['SET', `room-artifacts-backfilled:${code}`, '1']);

    const r = await ensureArtifactIndex(client, code);
    expect(r.pending).toBe(false);
    const rows = await listRoomArtifacts(client, code);
    expect(rows).toHaveLength(2);
    const upgraded = rows.find(a => a.sourceMessageId === 1)!;
    expect(upgraded.id).toBe('1-0');
    expect(upgraded.text).toBe('Locked:\n1. one\n2. two');
    expect(rows.find(a => a.sourceMessageId === 999)!.text).toBe('Ancient result.');
    // Idempotent: a second ensure changes nothing.
    await ensureArtifactIndex(client, code);
    expect(await listRoomArtifacts(client, code)).toHaveLength(2);
  });
});
