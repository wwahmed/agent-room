// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import type { Message, Room } from '@agent-room/shared';

// T-105: deterministic reproduction of the visibility-resume race. The
// incident: a focus-debounced pull holding a PRE-BACKGROUND cursor resolved
// AFTER forceRefresh re-anchored the window; its rows (older than the new
// window's start, so untouched by the dedup) were appended AFTER the live
// tail — a day-old message rendered as the end of chat. The fix is the
// fetch-generation guard plus order-preserving merge; this test drives the
// real hook through the real interleaving with a hand-controlled transport.

const listCalls: Array<{ fromIndex: number; resolve: (m: Message[]) => void }> = [];
let serverTotal = 0;
let roomStub: Room;

vi.mock('../lib/api.js', () => ({
  createClient: () => ({}),
  getRoom: async () => roomStub,
  getMessageTotalCount: async () => serverTotal,
  updatePresence: async () => undefined,
  appendMessage: async () => ({ appended: true, metadata: {} }),
  listMessages: (_c: unknown, _code: string, fromIndex: number) =>
    new Promise<Message[]>((resolve) => { listCalls.push({ fromIndex, resolve }); }),
}));

// readSync's fetch must fail silently (no marker server in jsdom).
vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));

import { useRoom } from './useRoom.js';

const msg = (id: number): Message => ({
  id, type: 'msg', name: 'AgentPeer', initials: 'AP', color: '#7c5cff',
  role: '', text: `message ${id}`, client: 'cc', time: id,
});
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

beforeEach(() => {
  listCalls.length = 0;
  roomStub = { code: 'abc-def-ghj', topic: 'race room', createdBy: 'ProbeHost', createdAt: 1, participants: [] } as unknown as Room;
});
afterEach(() => cleanup());

describe('T-105 visibility-resume race (real hook, controlled transport)', () => {
  it('a stale pre-refresh pull can never put old rows at the live tail', async () => {
    // History longer than one page: absolute counter 100, bounded bootstrap
    // starts at 20 → the loaded window is [21..100].
    serverTotal = 100;
    const hook = renderHook(() => useRoom('abc-def-ghj', 'Waqas'));
    await waitFor(() => expect(listCalls.length).toBe(1));
    expect(listCalls[0]!.fromIndex).toBe(20);
    await act(async () => { listCalls[0]!.resolve(range(21, 100)); });
    await waitFor(() => expect(hook.result.current.messages.length).toBe(80));

    // A poll fires (the hook's immediate start() pull) and HANGS in flight.
    // Its cursor predates everything that follows.
    await waitFor(() => expect(listCalls.length).toBeGreaterThanOrEqual(2));
    const stalePull = listCalls[listCalls.length - 1]!;

    // The tab resumes: visibilitychange triggers forceRefresh, which
    // re-anchors at the new absolute counter (three more messages arrived).
    serverTotal = 103;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const refreshCall = await vi.waitFor(() => {
      const c = listCalls[listCalls.length - 1]!;
      expect(c).not.toBe(stalePull);
      return c;
    });
    expect(refreshCall.fromIndex).toBe(23);
    await act(async () => { refreshCall.resolve(range(24, 103)); });
    await waitFor(() => expect(hook.result.current.messages.at(-1)!.id).toBe(103));

    // NOW the stale pull resolves — with rows from far below the window
    // (the untrimmed prefix the old dedup never saw). On the old build these
    // land AFTER 103 and become the end of chat.
    await act(async () => { stalePull.resolve(range(1, 3)); });

    const messages = hook.result.current.messages;
    // The live tail is still the newest message...
    expect(messages.at(-1)!.id).toBe(103);
    // ...and the whole feed is in strict timeline order with no duplicates.
    const ids = messages.map(m => m.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resume never truncates the loaded window (older paged-in history survives)', async () => {
    serverTotal = 100;
    const hook = renderHook(() => useRoom('abc-def-ghj', 'Waqas'));
    await waitFor(() => expect(listCalls.length).toBe(1));
    await act(async () => { listCalls[0]!.resolve(range(21, 100)); });
    await waitFor(() => expect(hook.result.current.messages.length).toBe(80));

    // The reader pages one screen of older history in.
    let older: Promise<number> | null = null;
    await act(async () => { older = hook.result.current.loadOlder(); });
    const olderCall = listCalls[listCalls.length - 1]!;
    expect(olderCall.fromIndex).toBe(0);
    await act(async () => { olderCall.resolve(range(1, 20)); });
    await older!;
    await waitFor(() => expect(hook.result.current.messages.length).toBe(100));

    // Resume: forceRefresh delivers only the newest bounded page. The old
    // build REPLACED the window with it, throwing away the paged-in history
    // (and the reading position with it).
    serverTotal = 101;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    const refreshCall = await vi.waitFor(() => {
      const c = listCalls[listCalls.length - 1]!;
      expect(c.fromIndex).toBe(21);
      return c;
    });
    await act(async () => { refreshCall.resolve(range(22, 101)); });
    await waitFor(() => expect(hook.result.current.messages.at(-1)!.id).toBe(101));
    // Nothing lost: the full 1..101 timeline is still loaded, in order.
    expect(hook.result.current.messages.length).toBe(101);
    expect(hook.result.current.messages[0]!.id).toBe(1);
  });
});
