import { describe, expect, it, vi } from 'vitest';
import { ScreenWakeLockController, type ScreenWakeLockSentinel } from './screenWakeLock.js';

class FakeDocument {
  visibilityState: DocumentVisibilityState = 'visible';
  private listeners = new Set<() => void>();
  addEventListener(_type: 'visibilitychange', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'visibilitychange', listener: () => void) { this.listeners.delete(listener); }
  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    for (const listener of this.listeners) listener();
  }
  listenerCount() { return this.listeners.size; }
}

class FakeSentinel implements ScreenWakeLockSentinel {
  release = vi.fn(async () => {});
  private listeners = new Set<() => void>();
  addEventListener(_type: 'release', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'release', listener: () => void) { this.listeners.delete(listener); }
  emitRelease() { for (const listener of [...this.listeners]) listener(); }
}

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('ScreenWakeLockController', () => {
  it('holds a screen lock only while the recording session is active', async () => {
    const doc = new FakeDocument();
    const sentinel = new FakeSentinel();
    const request = vi.fn(async () => sentinel);
    const controller = new ScreenWakeLockController({ document: doc, request });

    controller.setActive(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    controller.setActive(false);
    await flush();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('reacquires when an active recording page becomes visible again', async () => {
    const doc = new FakeDocument();
    const sentinels = [new FakeSentinel(), new FakeSentinel()];
    const request = vi.fn(async () => sentinels.shift()!);
    const controller = new ScreenWakeLockController({ document: doc, request });

    controller.setActive(true);
    await flush();
    doc.setVisibility('hidden');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    doc.setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not leak a lock when a pending request resolves after stop', async () => {
    const doc = new FakeDocument();
    const sentinel = new FakeSentinel();
    let resolveRequest!: (value: ScreenWakeLockSentinel) => void;
    const request = vi.fn(() => new Promise<ScreenWakeLockSentinel>(resolve => { resolveRequest = resolve; }));
    const controller = new ScreenWakeLockController({ document: doc, request });

    controller.setActive(true);
    controller.setActive(false);
    resolveRequest(sentinel);
    await flush();
    await flush();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('swallows unsupported/denied requests and cleans up on dispose', async () => {
    const doc = new FakeDocument();
    const request = vi.fn(async () => { throw new Error('denied'); });
    const controller = new ScreenWakeLockController({ document: doc, request });

    controller.setActive(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(doc.listenerCount()).toBe(1);
    controller.dispose();
    expect(doc.listenerCount()).toBe(0);
  });

  it('releases a held lock when its recording UI unmounts', async () => {
    const doc = new FakeDocument();
    const sentinel = new FakeSentinel();
    const controller = new ScreenWakeLockController({
      document: doc,
      request: async () => sentinel,
    });

    controller.setActive(true);
    await flush();
    controller.dispose();
    await flush();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(doc.listenerCount()).toBe(0);
  });
});
