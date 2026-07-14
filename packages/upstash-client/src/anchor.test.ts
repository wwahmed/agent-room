import { describe, it, expect, beforeEach } from 'vitest';
import { joinRoom, createRoom, AgentAnchorConflictError } from './rooms.js';
import type { UpstashClient } from './client.js';

// In-memory UpstashClient. The room lives in a single string key, exactly as it
// does in Redis, so casRoom's optimistic concurrency runs for real.
function memoryClient(): UpstashClient {
  const store = new Map<string, string>();
  return {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      const parts = cmd.map(String);
      const op = (parts[0] ?? '').toUpperCase();
      const key = parts[1] ?? '';
      if (op === 'GET') return (store.get(key) ?? null) as T;
      if (op === 'SET') { store.set(key, parts[2] ?? ''); return 'OK' as T; }
      if (op === 'DEL') { store.delete(key); return 1 as T; }
      if (op === 'EXPIRE') return 1 as T;
      throw new Error(`unsupported in test client: ${op}`);
    },
    async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
      const out: T[] = [];
      for (const c of cmds) out.push(await this.command<T>(c));
      return out;
    },
  } as UpstashClient;
}

const agent = (name: string) => ({
  name,
  role: 'builder',
  color: '#F43F5E',
  initials: 'AG',
  client: 'cc' as const,
  joinedAt: 1,
  lastSeenAt: 1,
});

// T-66. The hole: memberKey ROTATES on every join and lives only in the agent's
// key store. Lose the store before the rotated key is persisted and the row is
// unreclaimable forever — reclaim-by-key fails, and reclaim-by-priorIdentity is
// (correctly) refused on a protected row. Every rejoin then mints "Name (2)",
// and since task ownership is by NAME, the agent loses its own work.
//
// agentIdHash is the fix: a durable anchor derived from the agent's long-lived
// proxy secret, so it is reconstructible after total credential loss.
describe('T-66 durable agent anchor — lost-key recovery', () => {
  let client: UpstashClient;
  let code: string;

  beforeEach(async () => {
    client = memoryClient();
    const room = await createRoom(client, { code: 'ABC-DEF-GHJ', topic: 't', createdBy: 'Waqas' });
    code = room.code;
  });

  it('THE BUG: without an anchor, a lost key means a permanent suffix', async () => {
    await joinRoom(client, code, agent('Builder'), { issueMemberKey: true });
    // key lost (proxy died before persisting) — rejoin presents nothing
    const again = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true });
    expect(again.participant.name).toBe('Builder (2)'); // ← the failure we are fixing
  });

  it('THE FIX: the anchor reclaims the canonical row after the key is lost', async () => {
    const first = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-for-builder',
    });
    expect(first.participant.name).toBe('Builder');

    // Total credential loss: no memberKey presented at all. The anchor is
    // re-derived from the proxy secret, so it is still available.
    const back = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-for-builder',
    });

    expect(back.participant.name).toBe('Builder'); // canonical, NOT "Builder (2)"
    expect(back.participants.filter((p) => p.name.startsWith('Builder'))).toHaveLength(1);
  });

  it('issues and persists a FRESH key on recovery (the old one is dead)', async () => {
    const first = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-for-builder',
    });
    const back = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-for-builder',
    });

    expect(back.memberKey).toBeDefined();
    expect(back.memberKey).not.toBe(first.memberKey); // rotated
    const row = back.participants.find((p) => p.name === 'Builder')!;
    expect(row.memberKeyHash).toBeDefined();
    expect(row.agentIdHash).toBeDefined();
  });

  it('survives repeated total losses — recovery is not a one-shot', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await joinRoom(client, code, agent('Builder'), {
        issueMemberKey: true,
        agentId: 'anchor-for-builder',
      });
      expect(r.participant.name).toBe('Builder');
    }
  });

  it('binds the anchor to an EXISTING keyed row when the caller proves the key', async () => {
    // Migration path for rows that predate T-66: they have a key but no anchor.
    const first = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true });
    expect(first.participants.find((p) => p.name === 'Builder')!.agentIdHash).toBeUndefined();

    const bound = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      reclaimMemberKey: first.memberKey, // proves ownership
      agentId: 'anchor-for-builder',
    });
    expect(bound.participant.name).toBe('Builder');
    expect(bound.participants.find((p) => p.name === 'Builder')!.agentIdHash).toBeDefined();
  });

  it('preserves the anchor across a keyless refresh (must not strip it)', async () => {
    await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-for-builder' });
    const refreshed = await joinRoom(client, code, agent('Builder'), { agentId: 'anchor-for-builder' });
    expect(refreshed.participants.find((p) => p.name === 'Builder')!.agentIdHash).toBeDefined();
  });
});

describe('T-66 authorization — no cross-agent takeover', () => {
  let client: UpstashClient;
  let code: string;

  beforeEach(async () => {
    client = memoryClient();
    const room = await createRoom(client, { code: 'ABC-DEF-GHJ', topic: 't', createdBy: 'Waqas' });
    code = room.code;
  });

  // The takeover is blocked BEFORE it reaches the anchor guard: an impostor is
  // never matched to a protected row in the first place (priorIdentity resolves
  // only unprotected rows). So the property to assert is the OUTCOME — the
  // victim's row must come out untouched, and the impostor must land on its own
  // row. Asserting a thrown error here would have tested the wrong layer.
  it('agent B claiming A’s name does NOT touch A’s anchored row', async () => {
    const a = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-A' });
    const aRow = a.participants.find((p) => p.name === 'Builder')!;

    const b = await joinRoom(client, code, { ...agent('Builder') }, {
      issueMemberKey: true,
      agentId: 'anchor-B',
      priorIdentity: { name: 'Builder', client: 'cc' },
    });

    expect(b.participant.name).toBe('Builder (2)'); // impostor is quarantined
    const after = b.participants.find((p) => p.name === 'Builder')!;
    expect(after.agentIdHash).toBe(aRow.agentIdHash); // A's anchor intact
    expect(after.memberKeyHash).toBe(aRow.memberKeyHash); // A's key intact
    expect(b.participants.find((p) => p.name === 'Builder (2)')!.agentIdHash)
      .not.toBe(aRow.agentIdHash);
  });

  it('an anchor cannot attach to a key-protected row without the key', async () => {
    const a = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true });
    const aRow = a.participants.find((p) => p.name === 'Builder')!;

    const b = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-B',
      priorIdentity: { name: 'Builder', client: 'cc' },
    });

    expect(b.participant.name).toBe('Builder (2)');
    const after = b.participants.find((p) => p.name === 'Builder')!;
    expect(after.agentIdHash).toBeUndefined(); // never anchored by the impostor
    expect(after.memberKeyHash).toBe(aRow.memberKeyHash);
  });

  it('an agent anchor cannot attach to a HUMAN’s auth-protected row', async () => {
    const human = await joinRoom(client, code, { ...agent('Human'), client: 'web' }, {
      issueMemberKey: true,
      authId: 'wwahmed@gmail.com',
    });
    const humanRow = human.participants.find((p) => p.name === 'Human')!;
    expect(humanRow.authIdHash).toBeDefined();

    const impostor = await joinRoom(client, code, { ...agent('Human'), client: 'cc' }, {
      issueMemberKey: true,
      agentId: 'anchor-evil',
      priorIdentity: { name: 'Human', client: 'web' },
    });

    expect(impostor.participant.name).toBe('Human (2)');
    const after = impostor.participants.find((p) => p.name === 'Human')!;
    expect(after.authIdHash).toBe(humanRow.authIdHash);
    expect(after.agentIdHash).toBeUndefined(); // a human row is never agent-anchored
  });

  // The one path that DOES reach the guard: the caller authenticates to a row
  // with a valid member key, but presents a different anchor than the row
  // carries. That means credentials have been crossed — refuse loudly rather
  // than silently overwrite an anchor, because an anchor never rotates and the
  // overwrite would be irreversible.
  it('THROWS when a valid key is presented for a row anchored to someone else', async () => {
    const a = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-A' });

    await expect(
      joinRoom(client, code, agent('Builder'), {
        issueMemberKey: true,
        reclaimMemberKey: a.memberKey, // A's real key…
        agentId: 'anchor-B',           // …but B's anchor
      }),
    ).rejects.toThrow(AgentAnchorConflictError);
  });

  it('a DIFFERENT agent gets its own row, never the anchored one', async () => {
    await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-A' });
    const other = await joinRoom(client, code, agent('Reviewer'), { issueMemberKey: true, agentId: 'anchor-B' });

    expect(other.participant.name).toBe('Reviewer');
    const rows = other.participants.filter((p) => p.name === 'Builder' || p.name === 'Reviewer');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.agentIdHash).not.toBe(rows[1]!.agentIdHash);
  });

  it('the anchor is stored ONLY as a hash — the plaintext never lands on the row', async () => {
    const r = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-plaintext-must-not-appear',
    });
    const row = r.participants.find((p) => p.name === 'Builder')!;
    expect(row.agentIdHash).not.toBe('anchor-plaintext-must-not-appear');
    expect(row.agentIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(r.participants)).not.toContain('anchor-plaintext-must-not-appear');
  });
});

// T-66 (rev2, per ProdMgr-Codex): credential recovery must not be SILENT.
// A row changing hands is exactly what an operator needs to see — and a stolen
// identity would otherwise look identical to a quiet success.
describe('T-66 audit — anchor recovery is never silent', () => {
  let client: UpstashClient;
  let code: string;

  beforeEach(async () => {
    client = memoryClient();
    const room = await createRoom(client, { code: 'ABC-DEF-GHJ', topic: 't', createdBy: 'Waqas' });
    code = room.code;
  });

  it('emits NO audit on an ordinary first join (nothing changed hands)', async () => {
    const r = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-A',
    });
    expect(r.anchorAudit).toBeUndefined();
  });

  it('emits anchor_bound when the anchor attaches to a pre-T-66 keyed row', async () => {
    const first = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true });
    const bound = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      reclaimMemberKey: first.memberKey,
      agentId: 'anchor-A',
    });

    expect(bound.anchorAudit).toEqual({
      outcome: 'anchor_bound',
      name: 'Builder',
      client: 'cc',
      reclaimedProtectedRow: true, // the row WAS key-protected; ownership was proven
    });
  });

  it('emits anchor_recovery when a protected row is reclaimed with NO member key', async () => {
    await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-A' });

    // The key store is gone: no memberKey presented, only the derived anchor.
    const recovered = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-A',
    });

    expect(recovered.anchorAudit).toEqual({
      outcome: 'anchor_recovery',
      name: 'Builder',
      client: 'cc',
      reclaimedProtectedRow: true,
    });
  });

  it('does NOT cry recovery when the agent still holds its key (a normal rejoin)', async () => {
    const first = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-A',
    });
    const normal = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      reclaimMemberKey: first.memberKey, // key present → not a recovery
      agentId: 'anchor-A',
    });
    expect(normal.anchorAudit).toBeUndefined();
  });

  it('the audit record leaks NO key, anchor or hash material', async () => {
    await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-A' });
    const recovered = await joinRoom(client, code, agent('Builder'), {
      issueMemberKey: true,
      agentId: 'anchor-A',
    });

    const serialized = JSON.stringify(recovered.anchorAudit);
    expect(serialized).not.toContain('anchor-A');           // the plaintext anchor
    expect(serialized).not.toContain(recovered.memberKey!); // the freshly issued key
    expect(serialized).not.toMatch(/[a-f0-9]{32,}/);        // any hash/secret material
    expect(Object.keys(recovered.anchorAudit!).sort()).toEqual(
      ['client', 'name', 'outcome', 'reclaimedProtectedRow'],
    );
  });
});
