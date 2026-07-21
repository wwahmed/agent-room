import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armArrivalFlash } from './arrivalFlash.js';

function fakeEl() {
  const calls: string[] = [];
  return {
    calls,
    classList: {
      add: (c: string) => calls.push(`add:${c}`),
      remove: (c: string) => calls.push(`remove:${c}`),
    },
  };
}

function fakeFeed() {
  const listeners = new Map<string, () => void>();
  return {
    listeners,
    addEventListener: (t: string, fn: () => void) => listeners.set(t, fn),
    removeEventListener: (t: string) => listeners.delete(t),
    fire: (t: string) => listeners.get(t)?.(),
  };
}

describe('armArrivalFlash (rev19 item 2: exactly one arrival effect)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('scrollend wins: one flash, the fallback timer is cleared', () => {
    const el = fakeEl();
    const feed = fakeFeed();
    armArrivalFlash(el, feed, true);
    feed.fire('scrollend');
    vi.advanceTimersByTime(10_000);
    expect(el.calls.filter(c => c === 'add:reply-flash')).toHaveLength(1);
    expect(el.calls.filter(c => c === 'remove:reply-flash')).toHaveLength(1);
  });

  it('fallback wins: one flash, the listener is removed', () => {
    const el = fakeEl();
    const feed = fakeFeed();
    armArrivalFlash(el, feed, true);
    vi.advanceTimersByTime(2600);
    expect(feed.listeners.has('scrollend')).toBe(false);
    feed.fire('scrollend'); // late event is inert
    vi.advanceTimersByTime(10_000);
    expect(el.calls.filter(c => c === 'add:reply-flash')).toHaveLength(1);
  });

  it('no scrollend support: single delayed flash', () => {
    const el = fakeEl();
    armArrivalFlash(el, null, false);
    vi.advanceTimersByTime(10_000);
    expect(el.calls.filter(c => c === 'add:reply-flash')).toHaveLength(1);
  });
});
