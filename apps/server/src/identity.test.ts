// T-30 tests for the identity primitives in @agent-room/upstash-client:
// verifyHostKey fail-closed (F1) and joinRoom credential issuance (F2),
// exercised against an in-memory UpstashClient (no Redis).
import { describe, expect, it, beforeEach } from 'vitest';
import {
  createRoom,
  joinRoom,
  verifyHostKey,
  getRoom,
  HostNameTakenError,
  type UpstashClient,
} from '@agent-room/upstash-client';

// Minimal in-memory Redis stand-in covering the commands these functions use
// (GET/SET). Enough for room reads/writes; TTL args are ignored.
function memClient(): UpstashClient {
  const store = new Map<string, string>();
  return {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      const [op, key, val] = cmd as (string)[];
      if (op === 'GET') return (store.has(key) ? store.get(key)! : null) as unknown as T;
      if (op === 'SET') { store.set(key, val); return 'OK' as unknown as T; }
      throw new Error(`memClient: unsupported ${op}`);
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      const out: unknown[] = [];
      for (const c of cmds) out.push(await this.command(c));
      return out as T[];
    },
  };
}

const P = (name: string, client: 'web' | 'cc') => ({
  name, role: '', color: '#123456', initials: 'XX', client, joinedAt: 1, lastSeenAt: 1,
});

describe('verifyHostKey — F1 fail-closed', () => {
  let client: UpstashClient;
  let hostKey: string;
  beforeEach(async () => {
    client = memClient();
    const created = await createRoom(client, { code: 'AAA-BBB-CCC', topic: 't', createdBy: 'Host' });
    hostKey = created.hostKey;
  });

  it('accepts the correct hostKey', async () => {
    await expect(verifyHostKey(client, 'AAA-BBB-CCC', hostKey)).resolves.toBeUndefined();
  });
  it('rejects a missing hostKey', async () => {
    await expect(verifyHostKey(client, 'AAA-BBB-CCC', undefined)).rejects.toBeInstanceOf(HostNameTakenError);
  });
  it('rejects a wrong hostKey', async () => {
    await expect(verifyHostKey(client, 'AAA-BBB-CCC', 'deadbeef')).rejects.toBeInstanceOf(HostNameTakenError);
  });

  it('a room with NO stored hash FAILS CLOSED by default (no legacy bypass)', async () => {
    // Simulate a legacy room: strip hostKeyHash.
    const room = await getRoom(client, 'AAA-BBB-CCC');
    delete (room as { hostKeyHash?: string }).hostKeyHash;
    await client.command(['SET', 'room:AAA-BBB-CCC', JSON.stringify(room)]);
    await expect(verifyHostKey(client, 'AAA-BBB-CCC', undefined)).rejects.toBeInstanceOf(HostNameTakenError);
    // ...unless the server explicitly opts into the migration flag.
    await expect(verifyHostKey(client, 'AAA-BBB-CCC', undefined, { allowLegacyNoHash: true })).resolves.toBeUndefined();
  });
});

describe('verifyHostKey — T-69 authenticated host across devices', () => {
  it('accepts the same verified account without a browser-local hostKey', async () => {
    const client = memClient();
    await createRoom(client, {
      code: 'AAA-BBB-CCC',
      topic: 't',
      createdBy: 'Host',
      hostAuthId: 'host@example.com',
    });

    await expect(
      verifyHostKey(client, 'AAA-BBB-CCC', undefined, { authId: 'host@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('rejects a different verified account', async () => {
    const client = memClient();
    await createRoom(client, {
      code: 'AAA-BBB-CCC',
      topic: 't',
      createdBy: 'Host',
      hostAuthId: 'host@example.com',
    });

    await expect(
      verifyHostKey(client, 'AAA-BBB-CCC', undefined, { authId: 'other@example.com' }),
    ).rejects.toBeInstanceOf(HostNameTakenError);
  });

  it('stores only a hash, never the raw authenticated identity', async () => {
    const client = memClient();
    await createRoom(client, {
      code: 'AAA-BBB-CCC',
      topic: 't',
      createdBy: 'Host',
      hostAuthId: 'host@example.com',
    });
    const room = await getRoom(client, 'AAA-BBB-CCC');
    expect(room.hostAuthIdHash).toBeTruthy();
    expect(JSON.stringify(room)).not.toContain('host@example.com');
  });

  it('recovers a pre-T-69 room from its verified host participant row', async () => {
    const client = memClient();
    const created = await createRoom(client, { code: 'AAA-BBB-CCC', topic: 't', createdBy: 'Host' });
    // The original browser proved the host key, then its authenticated join
    // stamped authIdHash on the host row. A second device has neither key.
    await verifyHostKey(client, 'AAA-BBB-CCC', created.hostKey);
    await joinRoom(client, 'AAA-BBB-CCC', P('Host', 'web'), {
      issueMemberKey: true,
      authId: 'host@example.com',
    });

    await expect(
      verifyHostKey(client, 'AAA-BBB-CCC', undefined, { authId: 'host@example.com' }),
    ).resolves.toBeUndefined();
    await expect(
      verifyHostKey(client, 'AAA-BBB-CCC', undefined, { authId: 'other@example.com' }),
    ).rejects.toBeInstanceOf(HostNameTakenError);
  });

  it('same-host rejoin preserves unrelated agents and keeps one host row', async () => {
    const client = memClient();
    await createRoom(client, {
      code: 'AAA-BBB-CCC',
      topic: 't',
      createdBy: 'Host',
      hostAuthId: 'host@example.com',
    });
    await joinRoom(client, 'AAA-BBB-CCC', P('CustomerService', 'cc'));
    await joinRoom(client, 'AAA-BBB-CCC', P('AppManager', 'cc'));

    // Device 1, then device 2: neither has to share browser storage.
    await joinRoom(client, 'AAA-BBB-CCC', P('Host', 'web'), {
      issueMemberKey: true,
      authId: 'host@example.com',
    });
    await joinRoom(client, 'AAA-BBB-CCC', P('Host', 'web'), {
      issueMemberKey: true,
      authId: 'host@example.com',
    });

    const room = await getRoom(client, 'AAA-BBB-CCC');
    expect(room.participants.filter(p => p.name === 'Host' && p.client === 'web')).toHaveLength(1);
    expect(room.participants.filter(p => p.name === 'CustomerService' && p.client === 'cc')).toHaveLength(1);
    expect(room.participants.filter(p => p.name === 'AppManager' && p.client === 'cc')).toHaveLength(1);
  });
});

describe('joinRoom — F2 member credential', () => {
  let client: UpstashClient;
  beforeEach(async () => {
    client = memClient();
    await createRoom(client, { code: 'AAA-BBB-CCC', topic: 't', createdBy: 'Host' });
  });

  it('issues a one-time memberKey and stores only its hash when opted in', async () => {
    const res = await joinRoom(client, 'AAA-BBB-CCC', P('Alice', 'web'), { issueMemberKey: true });
    expect(res.memberKey).toBeTruthy();
    const room = await getRoom(client, 'AAA-BBB-CCC');
    const row = room.participants.find(p => p.name === 'Alice');
    expect(row?.memberKeyHash).toBeTruthy();
    expect(row?.memberKeyHash).not.toBe(res.memberKey); // hash, never the plaintext
  });

  it('leaves the row keyless when NOT opted in (MCP path)', async () => {
    const res = await joinRoom(client, 'AAA-BBB-CCC', P('Bot', 'cc'));
    expect(res.memberKey).toBeUndefined();
    const room = await getRoom(client, 'AAA-BBB-CCC');
    expect(room.participants.find(p => p.name === 'Bot')?.memberKeyHash).toBeUndefined();
  });

  it('ignores a client-supplied memberKeyHash on the incoming row (A9: never trust client-supplied credentials)', async () => {
    const forged = { ...P('Mallory', 'web'), memberKeyHash: 'forged-hash' } as ReturnType<typeof P>;
    await joinRoom(client, 'AAA-BBB-CCC', forged);
    const room = await getRoom(client, 'AAA-BBB-CCC');
    expect(room.participants.find(p => p.name === 'Mallory')?.memberKeyHash).toBeUndefined();
  });
});
