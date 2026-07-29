import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@agent-room/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { suppressPreparedOwnMessages } from '../src/sendListen.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const message = (id: number, name: string, text: string, client: 'web' | 'cc' = 'cc'): Message => ({
  id,
  type: 'msg',
  name,
  role: '',
  initials: name.slice(0, 2).toUpperCase(),
  color: '#000',
  client,
  text,
  time: id,
});

describe('T-48 send -> listen cursor continuity', () => {
  it('returns the last consumed cursor, then consumes own echo without skipping concurrent messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cursor-gap-'));
    vi.stubEnv('AGENT_ROOM_STATE_DIR', dir);
    vi.stubEnv('AGENT_ROOM_STATE_FILE', join(dir, 'client-a.json'));
    const state = await import('../src/state.js');

    await state.setRoom('room', { name: 'Agent A', cursor: 10, joinedAt: 1 });
    const safeCursor = await state.prepareSend('room', 1200);
    expect(safeCursor).toBe(10);

    // While A's append was in flight, B posted message 11; A's own send became
    // message 12. The listen must start at 10 and advance over both.
    await state.finishPreparedSend('room', 1200, true, 100);
    const consumed = await state.advanceListenAndConsumeOwn('room', 12, [1200]);
    const batch = [
      message(1100, 'Agent B', '@Agent A answer this'),
      message(1200, 'Agent A', 'my send'),
    ];
    expect(suppressPreparedOwnMessages(batch, 'Agent A', consumed).map(m => m.text))
      .toEqual(['@Agent A answer this']);
    expect((await state.readState()).rooms.room?.cursor).toBe(12);
    expect((await state.readState()).rooms.room?.pendingOwnMessageIds).toEqual([]);
  });

  it('does not suppress another client on an id collision, and does not duplicate its own send', () => {
    const batch = [
      message(42, 'Agent B', 'same id, different sender'),
      message(42, 'Agent A', 'own echo'),
      message(43, 'Waqas', '@Agent A next request', 'web'),
    ];
    expect(suppressPreparedOwnMessages(batch, 'Agent A', new Set([42])).map(m => m.text))
      .toEqual(['same id, different sender', '@Agent A next request']);
  });

  it('removes suppression on failed append so a retry can reuse the path safely', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-cursor-retry-'));
    vi.stubEnv('AGENT_ROOM_STATE_DIR', dir);
    vi.stubEnv('AGENT_ROOM_STATE_FILE', join(dir, 'retry.json'));
    const state = await import('../src/state.js');

    await state.setRoom('room', { name: 'Agent A', cursor: 7, joinedAt: 1 });
    expect(await state.prepareSend('room', 70)).toBe(7);
    await state.finishPreparedSend('room', 70, false, 1);
    expect((await state.readState()).rooms.room?.pendingOwnMessageIds).toEqual([]);
    // Retry captures the same still-consumed cursor and records its new id.
    expect(await state.prepareSend('room', 71)).toBe(7);
    expect((await state.readState()).rooms.room?.pendingOwnMessageIds).toEqual([71]);
  });

  it('keeps pending ids across reconnect-state merge without regressing the cursor', async () => {
    const { mergeStates } = await import('../src/state.js');
    const merged = mergeStates([
      { version: 1, rooms: { room: { name: 'Agent A', cursor: 8, joinedAt: 1, pendingOwnMessageIds: [80] } } },
      { version: 1, rooms: { room: { name: 'Agent A', cursor: 11, joinedAt: 2, pendingOwnMessageIds: [110] } } },
    ]);
    expect(merged.rooms.room?.cursor).toBe(11);
    expect(merged.rooms.room?.pendingOwnMessageIds).toEqual([80, 110]);
  });
});
