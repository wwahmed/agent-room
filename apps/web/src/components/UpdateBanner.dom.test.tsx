// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { UpdateBanner, ownBundle } from './UpdateBanner.js';

// T-106: the banner must compare the SERVER bundle hash against the hash of
// the code actually running in this page (the entry script tag), never a
// remembered first-poll value. The host's live failure: a phone restoring
// the app from memory remounts the banner, whose first poll then returns
// the server's NEW hash while the page still runs OLD code — a first-poll
// seed compares new-vs-new forever and the prompt never fires.

function installEntryScript(hash: string) {
  const s = document.createElement('script');
  s.setAttribute('src', `/assets/index-${hash}.js`);
  document.head.appendChild(s);
  return s;
}

function stubVersionApi(bundle: string) {
  const json = vi.fn().mockResolvedValue({ bundle });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));
}

async function flushChecks() {
  // let the mounted effect's fetch → json → setState chain settle
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('UpdateBanner (T-106)', () => {
  const added: HTMLScriptElement[] = [];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    for (const s of added.splice(0)) s.remove();
  });

  it('reads its own bundle hash from the entry script tag', () => {
    added.push(installEntryScript('OldHash111'));
    expect(ownBundle()).toBe('OldHash111');
  });

  it('fires on the FIRST check when the running bundle is older than the server (restore path)', async () => {
    added.push(installEntryScript('OldHash111'));
    stubVersionApi('NewHash222');
    render(<UpdateBanner />);
    await flushChecks();
    // A first-poll-seeded implementation cannot pass this: with no prior
    // mount there is no "booted" memory, so the very first comparison must
    // already be own-vs-server.
    expect(screen.getByRole('status').textContent).toMatch(/new version is ready/i);
  });

  it('stays hidden when the running bundle matches the server', async () => {
    added.push(installEntryScript('SameHash333'));
    stubVersionApi('SameHash333');
    render(<UpdateBanner />);
    await flushChecks();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing and never polls on the dev server (no hashed entry script)', async () => {
    stubVersionApi('NewHash222');
    render(<UpdateBanner />);
    await flushChecks();
    expect(screen.queryByRole('status')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-checks on pageshow (bfcache restore) and fires if the server moved on', async () => {
    added.push(installEntryScript('OldHash111'));
    // First answer matches the running code; the deploy lands while the
    // page sits in the back/forward cache; pageshow re-check must catch it.
    const json = vi.fn()
      .mockResolvedValueOnce({ bundle: 'OldHash111' })
      .mockResolvedValue({ bundle: 'NewHash222' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }));
    render(<UpdateBanner />);
    await flushChecks();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      await Promise.resolve(); await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toMatch(/new version is ready/i);
  });

  it('reload tap revalidates the document before reloading', async () => {
    added.push(installEntryScript('OldHash111'));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ bundle: 'NewHash222' }) });
    vi.stubGlobal('fetch', fetchMock);
    const reload = vi.fn();
    // jsdom's location.reload is non-configurable on the instance; replace location
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { ...original, reload }, writable: true, configurable: true });
    try {
      render(<UpdateBanner />);
      await flushChecks();
      await act(async () => {
        screen.getByRole('status').click();
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledWith('/', { cache: 'reload' });
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
    }
  });
});
