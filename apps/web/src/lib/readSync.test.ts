// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READING_HEARTBEAT_MS, startReadingHeartbeat } from './readSync.js';

// T-118 all-messages mode: the reading heartbeat keeps the server's
// suppress-when-reading stamp fresh while a quiet room sits open.
describe('reading heartbeat (T-118 all-messages mode)', () => {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('wakichat:read:abc-def-ghj', '42');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('confirms the marker on open and on every interval tick while visible', async () => {
    const stop = startReadingHeartbeat('abc-def-ghj');
    expect(fetchMock).toHaveBeenCalledTimes(1); // immediate confirm on open
    await vi.advanceTimersByTimeAsync(READING_HEARTBEAT_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ action: 'readMarkerSet', code: 'abc-def-ghj', count: 42 });
    stop();
    await vi.advanceTimersByTimeAsync(READING_HEARTBEAT_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3); // stopped — no further ticks
  });

  it('skips ticks while the tab is hidden', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const stop = startReadingHeartbeat('abc-def-ghj');
    await vi.advanceTimersByTimeAsync(READING_HEARTBEAT_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await vi.advanceTimersByTimeAsync(READING_HEARTBEAT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never syncs a room this device has not opened', async () => {
    const stop = startReadingHeartbeat('nvr-opn-drm');
    await vi.advanceTimersByTimeAsync(READING_HEARTBEAT_MS);
    expect(fetchMock).not.toHaveBeenCalled(); // no local marker → nothing to confirm
    stop();
  });
});
