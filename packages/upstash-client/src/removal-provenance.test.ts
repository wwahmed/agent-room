import { describe, it, expect, beforeEach } from 'vitest';
import { joinRoom, createRoom, removeParticipant, getRoom } from './rooms.js';
import type { UpstashClient } from './client.js';

// T-32 rev4: no participant row is ever removed without provenance. Every
// server-side removal (host kick, same-name join displacement, anchor
// recovery) stamps room.lastRemovals, and the identity's NEXT join pops that
// record as `removalNotice` — the paper trail the glue-vow-soap kicks lacked.

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

const agent = (name: string, live = false) => ({
  name,
  role: 'builder',
  color: '#F43F5E',
  initials: 'AG',
  client: 'cc' as const,
  joinedAt: 1,
  lastSeenAt: live ? Date.now() : 1,
  ...(live ? { listenUntil: Date.now() + 60_000 } : {}),
});

describe('T-32 removal provenance', () => {
  let client: UpstashClient;
  let code: string;

  beforeEach(async () => {
    client = memoryClient();
    const room = await createRoom(client, { code: 'ABC-DEF-GHJ', topic: 't', createdBy: 'Waqas' });
    code = room.code;
  });

  it('host kick stamps lastRemovals and the target pops the notice on rejoin', async () => {
    await joinRoom(client, code, agent('Builder'));
    await removeParticipant(client, code, 'Waqas', 'Builder', 'cc');

    const stored = await getRoom(client, code);
    expect(stored.lastRemovals?.['Builder\ncc']).toMatchObject({
      mechanism: 'host_removal',
      byName: 'Waqas',
    });

    const back = await joinRoom(client, code, agent('Builder'));
    expect(back.removalNotice).toMatchObject({
      name: 'Builder',
      mechanism: 'host_removal',
      byName: 'Waqas',
    });

    // Delivered exactly once: the stored record is cleared by the rejoin.
    const after = await getRoom(client, code);
    expect(after.lastRemovals?.['Builder\ncc']).toBeUndefined();
  });

  it('self-leave is voluntary: no provenance, no notice on rejoin', async () => {
    await joinRoom(client, code, agent('Builder'));
    await removeParticipant(client, code, 'Builder', 'Builder', 'cc');
    const stored = await getRoom(client, code);
    expect(stored.lastRemovals?.['Builder\ncc']).toBeUndefined();
    const back = await joinRoom(client, code, agent('Builder'));
    expect(back.removalNotice).toBeUndefined();
  });

  it('anchor recovery over a LIVE row reports the displacement', async () => {
    // Session A: keyed + anchored, actively listening.
    const a = await joinRoom(client, code, agent('Builder', true), {
      issueMemberKey: true,
      agentId: 'anchor-1',
    });
    expect(a.participant.name).toBe('Builder');

    // Same identity rejoins WITHOUT the key (lost store) — the anchor
    // recovers the row and rotates the credential out from under session A.
    const b = await joinRoom(client, code, agent('Builder', true), {
      issueMemberKey: true,
      agentId: 'anchor-1',
    });
    expect(b.participant.name).toBe('Builder');
    expect(b.anchorAudit?.outcome).toBe('anchor_recovery');
    expect(b.displaced).toEqual([
      { name: 'Builder', client: 'cc', mechanism: 'anchor_recovery' },
    ]);

    // Session A's next join (as the same name) learns what happened.
    const stored = await getRoom(client, code);
    expect(stored.lastRemovals?.['Builder\ncc']?.mechanism).toBe('anchor_recovery');
  });

  it('a quiet reclaim of a STALE row is recovery, not displacement', async () => {
    await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-1' });
    const back = await joinRoom(client, code, agent('Builder'), { issueMemberKey: true, agentId: 'anchor-1' });
    expect(back.displaced).toEqual([]);
  });

  it('an anchor-bound notice survives a name squatter and reaches the real victim', async () => {
    await joinRoom(client, code, agent('Builder'), { agentId: 'anchor-victim' });
    await removeParticipant(client, code, 'Waqas', 'Builder', 'cc');
    // A stranger takes the name before the victim returns: the record is bound
    // to the victim's anchor, so the squatter must NOT pop it.
    const squatter = await joinRoom(client, code, agent('Builder'));
    expect(squatter.participant.name).toBe('Builder');
    expect(squatter.removalNotice).toBeUndefined();
    // The real victim rejoins with its anchor — suffixed, but still notified.
    const victim = await joinRoom(client, code, agent('Builder'), { agentId: 'anchor-victim' });
    expect(victim.participant.name).toBe('Builder (2)');
    expect(victim.removalNotice).toMatchObject({ name: 'Builder', mechanism: 'host_removal' });
    // The server-only anchor hash never rides along on the handed-out notice.
    expect(victim.removalNotice).not.toHaveProperty('anchorHash');
  });
});
