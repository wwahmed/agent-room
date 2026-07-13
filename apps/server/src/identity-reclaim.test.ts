import { describe, expect, it, beforeEach } from 'vitest';
import {
  createRoom,
  joinRoom,
  getRoom,
  type UpstashClient,
} from '@agent-room/upstash-client';

// In-memory Redis stand-in (GET/SET) — same shape as identity.test.ts. Enough
// for casRoom's read-modify-write.
function memClient(): UpstashClient {
  const store = new Map<string, string>();
  return {
    async command<T>(cmd: readonly (string | number)[]): Promise<T> {
      const [op, key, val] = cmd as string[];
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

const P = (name: string, client: 'web' | 'cc', color = '#123456') => ({
  name, role: '', color, initials: 'XX', client, joinedAt: 1, lastSeenAt: 1,
});

const CODE = 'AAA-BBB-CCC';
const members = async (client: UpstashClient) =>
  (await getRoom(client, CODE)).participants.filter(p => p.name !== 'Host');

describe('T-25 — identity reclaim (no duplicate rows)', () => {
  let client: UpstashClient;
  beforeEach(async () => {
    client = memClient();
    await createRoom(client, { code: CODE, topic: 't', createdBy: 'Host' });
  });

  it('(a) an AGENT reclaims its row by memberKey across rejoins — no "(2)"', async () => {
    // First join mints a key.
    const first = await joinRoom(client, CODE, P('Robin', 'cc'), { issueMemberKey: true });
    const key1 = first.memberKey!;
    expect(key1).toBeTruthy();
    expect((await members(client)).length).toBe(1);

    // Rejoin presenting the held key → same row reclaimed, not suffixed.
    const second = await joinRoom(client, CODE, P('Robin', 'cc'), {
      issueMemberKey: true,
      reclaimMemberKey: key1,
    });
    const rows = await members(client);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Robin'); // NOT "Robin (2)"
    // Key rotated to the freshly issued one; row still keyed.
    expect(second.memberKey).toBeTruthy();
    expect(rows[0].memberKeyHash).toBeTruthy();
  });

  it('(b) a HUMAN reclaims by verified authId across "tabs" with no key — no "(2)"', async () => {
    // Tab 1: authenticated web join, key minted (per-tab, will be "lost").
    await joinRoom(client, CODE, P('Waqas', 'web'), {
      issueMemberKey: true,
      authId: 'waqas@example.com',
    });
    expect((await members(client)).length).toBe(1);

    // Tab 2: fresh tab, sessionStorage empty → NO reclaimMemberKey, but the
    // Access cookie still identifies the same human.
    await joinRoom(client, CODE, P('Waqas', 'web'), {
      issueMemberKey: true,
      authId: 'waqas@example.com',
    });
    const rows = await members(client);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Waqas');
    // Raw email never stored; only a hash anchor.
    expect(rows[0].authIdHash).toBeTruthy();
    expect(JSON.stringify(rows[0])).not.toContain('waqas@example.com');
  });

  it('a bare priorIdentity name claim CANNOT hijack a key-protected row', async () => {
    // Real Robin joins with a key.
    const real = await joinRoom(client, CODE, P('Robin', 'cc'), { issueMemberKey: true });
    const realHash = (await members(client))[0].memberKeyHash;
    expect(realHash).toBeTruthy();

    // Attacker knows only the name — presents no key, just priorIdentity.
    await joinRoom(client, CODE, P('Robin', 'cc'), {
      priorIdentity: { name: 'Robin', client: 'cc' },
    });

    const rows = await members(client);
    // The protected row is untouched and still keyed; the attacker lands on a
    // separate suffixed row instead of displacing the real identity.
    expect(rows.length).toBe(2);
    const keyed = rows.find(r => r.memberKeyHash === realHash);
    expect(keyed).toBeTruthy();
    expect(keyed!.name).toBe('Robin');
    expect(rows.some(r => r.name === 'Robin (2)')).toBe(true);
    // Real key binding preserved.
    expect(real.memberKey).toBeTruthy();
  });

  it('genuinely distinct agents sharing a name still get suffixed', async () => {
    await joinRoom(client, CODE, P('Robin', 'cc'), { issueMemberKey: true });
    await joinRoom(client, CODE, P('Robin', 'cc'), { issueMemberKey: true }); // different agent, no reclaim
    const names = (await members(client)).map(r => r.name).sort();
    expect(names).toEqual(['Robin', 'Robin (2)']);
  });

  it('a keyless legacy rejoin still reclaims its own unprotected row by priorIdentity', async () => {
    // MCP 0.25.x style: no key issued, no key presented.
    await joinRoom(client, CODE, P('Legacy', 'cc'));
    expect((await members(client)).length).toBe(1);
    await joinRoom(client, CODE, P('Legacy', 'cc'), {
      priorIdentity: { name: 'Legacy', client: 'cc' },
    });
    const rows = await members(client);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Legacy');
  });

  it('reclaim preserves an existing memberKey binding on a keyless refresh', async () => {
    const first = await joinRoom(client, CODE, P('Robin', 'cc'), { issueMemberKey: true });
    const hash1 = (await members(client))[0].memberKeyHash;
    // Rejoin presenting the key but NOT issuing a new one → hash preserved.
    await joinRoom(client, CODE, P('Robin', 'cc'), { reclaimMemberKey: first.memberKey });
    const rows = await members(client);
    expect(rows.length).toBe(1);
    expect(rows[0].memberKeyHash).toBe(hash1);
  });
});
