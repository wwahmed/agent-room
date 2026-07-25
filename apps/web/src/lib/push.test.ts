// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNotifyLevel, pushSupport, setNotifyLevel, urlBase64ToUint8Array } from './push.js';

// T-118: client push helpers.
describe('push client helpers (T-118)', () => {
  it('reports unsupported cleanly when the browser lacks push APIs', () => {
    // jsdom has no PushManager/Notification
    const s = pushSupport();
    expect(s.supported).toBe(false);
    expect(s.permission).toBe('unsupported');
  });

  it('decodes a url-safe base64 VAPID key into bytes', () => {
    // "hello" in url-safe base64 without padding
    const bytes = urlBase64ToUint8Array('aGVsbG8');
    expect([...bytes]).toEqual([104, 101, 108, 108, 111]);
  });
});

// T-118 follow-up: notify-level preference helpers.
describe('notify level helpers (T-118 all-messages mode)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const jsonResponse = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

  it('reads the stored level and defaults anything unhealthy to mentions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { level: 'all' })));
    expect(await getNotifyLevel()).toBe('all');

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { level: 'shout' })));
    expect(await getNotifyLevel()).toBe('mentions');

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: 'push_disabled' })));
    expect(await getNotifyLevel()).toBe('mentions');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await getNotifyLevel()).toBe('mentions');
  });

  it('posts the chosen level and surfaces server rejection', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { level: 'all' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await setNotifyLevel('all')).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/push/prefs', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ level: 'all' }),
    }));

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'unauthorized' })));
    const rejected = await setNotifyLevel('mentions');
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/401/);
  });
});
