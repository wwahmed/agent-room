import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearShownNotifications } from './push.js';

// Waqas: tray notifications must clear when the app opens — the messages are
// on screen at that point, so the stack in the tray is pure noise.

function mockServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value });
}

afterEach(() => {
  mockServiceWorker(undefined);
});

describe('clearShownNotifications', () => {
  it('closes every notification the registration is showing and reports the count', async () => {
    const shown = [{ close: vi.fn() }, { close: vi.fn() }, { close: vi.fn() }];
    mockServiceWorker({ getRegistration: async () => ({ getNotifications: async () => shown }) });
    await expect(clearShownNotifications()).resolves.toBe(3);
    for (const n of shown) expect(n.close).toHaveBeenCalledTimes(1);
  });

  it('is a harmless no-op without a registration or without SW support', async () => {
    mockServiceWorker({ getRegistration: async () => undefined });
    await expect(clearShownNotifications()).resolves.toBe(0);
    mockServiceWorker(undefined);
    await expect(clearShownNotifications()).resolves.toBe(0);
  });

  it('swallows registration failures rather than breaking the foreground handler', async () => {
    mockServiceWorker({ getRegistration: async () => { throw new Error('nope'); } });
    await expect(clearShownNotifications()).resolves.toBe(0);
  });
});

describe('foreground wiring', () => {
  const push = readFileSync(new URL('./push.js', import.meta.url).pathname.replace(/push\.js$/, 'push.ts'), 'utf8');
  const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

  it('installBadgeClearing clears the tray on every foreground transition, not only the badge', () => {
    expect(push).toContain('void clearShownNotifications();');
    expect(push).toContain("window.addEventListener('focus', clear);");
    expect(push).toContain("if (document.visibilityState === 'visible') clear();");
  });

  it('the service worker suppresses tray entries while a window is visible', () => {
    expect(sw).toContain("const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });");
    expect(sw).toContain('if (wins.some(w => w.visibilityState === \'visible\' || w.focused)) return;');
  });
});
