// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LIVE_ROOMS_INTERVAL_MS, useLiveRooms } from './useLiveRooms.js';
import type { RoomSummary } from '../lib/identity.js';

// T-75: the list surfaces poll while visible, pause while hidden, refresh on
// return, and never re-sort under a held pointer.

const ROOM = { code: 'live-room-one', topic: 'Live', status: 'active', createdBy: 'W', createdAt: 1, participants: 1, lastActivityAt: 2, messageCount: 3, agentCount: 0, agentsAllHealthy: true, agentStaleCount: 0, agents: [] } as unknown as RoomSummary;

function Probe({ enabled, apply }: { enabled: boolean; apply: (rooms: RoomSummary[]) => void }) {
  useLiveRooms(enabled, apply);
  return null;
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ rooms: [ROOM], nextCursor: null, hasMore: false }) })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useLiveRooms (T-75)', () => {
  it('polls on the live cadence while visible and applies the page', async () => {
    const apply = vi.fn();
    render(<Probe enabled apply={apply} />);
    await vi.advanceTimersByTimeAsync(LIVE_ROOMS_INTERVAL_MS + 50);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0][0].code).toBe('live-room-one');
    await vi.advanceTimersByTimeAsync(LIVE_ROOMS_INTERVAL_MS);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('pauses while the tab is hidden and refreshes immediately on return', async () => {
    const apply = vi.fn();
    render(<Probe enabled apply={apply} />);
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(LIVE_ROOMS_INTERVAL_MS * 3);
    expect(apply).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(50);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('holds a re-sort while the pointer is down and applies it on release', async () => {
    const apply = vi.fn();
    render(<Probe enabled apply={apply} />);
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(LIVE_ROOMS_INTERVAL_MS + 50);
    expect(apply).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerup'));
    await vi.advanceTimersByTimeAsync(10);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled (signed-out Home)', async () => {
    const apply = vi.fn();
    render(<Probe enabled={false} apply={apply} />);
    await vi.advanceTimersByTimeAsync(LIVE_ROOMS_INTERVAL_MS * 2);
    expect(apply).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
