// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pushSupport, urlBase64ToUint8Array } from './push.js';

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
