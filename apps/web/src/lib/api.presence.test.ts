import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, updatePresence, appendMessage } from './api.js';
import type { Message, Participant } from '@agent-room/shared';

// T-37: the web client must present the current memberKey on presence AND send,
// and self-heal a stale/absent one by re-minting via re-join (priorIdentity),
// then retry once — without ever leaking the plaintext key.

const CODE = 'AAA-BBB-CCC';
const client = createClient();
const SELF: Participant = { name: 'Waqas', client: 'web', color: '#F59E0B', initials: 'WA' } as Participant;

// in-memory sessionStorage
function installStorage() {
  const map = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
  (globalThis as { localStorage?: unknown }).localStorage = (globalThis as { sessionStorage: unknown }).sessionStorage;
  return map;
}

// A fetch mock that routes by payload.action and records every request body.
type Handler = (body: any) => { ok?: boolean; status?: number; json: any };
function installFetch(handlers: Record<string, Handler>) {
  const calls: any[] = [];
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const h = handlers[body.action];
    const r = h ? h(body) : { ok: true, json: {} };
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json } as Response;
  });
  (globalThis as { fetch?: unknown }).fetch = fn;
  return { calls };
}

const memberAuth = { ok: false, status: 403, json: { error: 'MemberAuthError', message: 'Member credential does not match "Waqas".' } };

let store: Map<string, string>;
beforeEach(() => { store = installStorage(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('updatePresence — keyed + self-healing (T-37)', () => {
  it('presents the current stored memberKey', async () => {
    store.set(`room:${CODE}:memberKey`, 'KEY1');
    const { calls } = installFetch({ updatePresence: () => ({ json: {} }) });
    await updatePresence(client, CODE, 'Waqas', 123);
    expect(calls).toHaveLength(1);
    expect(calls[0].memberKey).toBe('KEY1');
  });

  it('re-mints via re-join on MemberAuthError and retries with the fresh key', async () => {
    store.set(`room:${CODE}:memberKey`, 'STALE');
    store.set(`room:${CODE}:self`, JSON.stringify(SELF));
    let presenceCalls = 0;
    const { calls } = installFetch({
      updatePresence: () => (++presenceCalls === 1 ? memberAuth : { json: {} }),
      join: () => ({ json: { room: {}, participant: SELF, memberKey: 'FRESH' } }),
    });
    await updatePresence(client, CODE, 'Waqas', 123);

    const joins = calls.filter(c => c.action === 'join');
    expect(joins).toHaveLength(1);
    expect(joins[0].wantMemberKey).toBe(true);
    expect(joins[0].priorIdentity).toEqual({ name: 'Waqas', client: 'web' }); // reclaims the row, no suffix
    expect(store.get(`room:${CODE}:memberKey`)).toBe('FRESH'); // new key persisted
    const retried = calls.filter(c => c.action === 'updatePresence');
    expect(retried[retried.length - 1].memberKey).toBe('FRESH'); // retry used the fresh key
  });

  it('fails closed (surfaces the error) when there is no captured self to re-mint from', async () => {
    store.set(`room:${CODE}:memberKey`, 'STALE'); // note: NO :self stored
    const { calls } = installFetch({ updatePresence: () => memberAuth, join: () => ({ json: { memberKey: 'X' } }) });
    await expect(updatePresence(client, CODE, 'Waqas', 123)).rejects.toMatchObject({ name: 'MemberAuthError' });
    expect(calls.some(c => c.action === 'join')).toBe(false); // never attempted a re-mint
  });

  it('dedupes concurrent recovery into a single re-join', async () => {
    store.set(`room:${CODE}:memberKey`, 'STALE');
    store.set(`room:${CODE}:self`, JSON.stringify(SELF));
    const seen = new Set<string>();
    const { calls } = installFetch({
      // first presence attempt from EACH concurrent caller fails until re-key
      updatePresence: (b) => { if (b.memberKey === 'STALE') return memberAuth; return { json: {} }; },
      join: () => ({ json: { memberKey: 'FRESH' } }),
    });
    await Promise.all([
      updatePresence(client, CODE, 'Waqas', 1),
      updatePresence(client, CODE, 'Waqas', 2),
      updatePresence(client, CODE, 'Waqas', 3),
    ]);
    void seen;
    expect(calls.filter(c => c.action === 'join')).toHaveLength(1); // ONE re-mint, not three
  });

  it('never puts the plaintext key into the thrown error', async () => {
    store.set(`room:${CODE}:memberKey`, 'SUPERSECRETKEY');
    installFetch({ updatePresence: () => memberAuth }); // no :self → fails closed
    const err = await updatePresence(client, CODE, 'Waqas', 1).catch(e => e);
    expect(String(err?.message ?? '') + String(err?.name ?? '')).not.toContain('SUPERSECRETKEY');
  });
});

describe('appendMessage — send self-heals the same way (T-37)', () => {
  it('re-mints and retries a send on MemberAuthError', async () => {
    store.set(`room:${CODE}:memberKey`, 'STALE');
    store.set(`room:${CODE}:self`, JSON.stringify(SELF));
    let sendCalls = 0;
    const msg = { id: 1, type: 'msg', name: 'Waqas', client: 'web', text: 'hi' } as unknown as Message;
    const { calls } = installFetch({
      send: () => (++sendCalls === 1 ? memberAuth : { json: { result: { appended: true } } }),
      join: () => ({ json: { memberKey: 'FRESH' } }),
    });
    await appendMessage(client, CODE, msg);
    expect(calls.filter(c => c.action === 'join')).toHaveLength(1);
    const sends = calls.filter(c => c.action === 'send');
    expect(sends[sends.length - 1].memberKey).toBe('FRESH');
  });
});
