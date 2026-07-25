// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { installHomeBackstop, needsBackstop } from './historyBackstop.js';

// Deep-entry back button: a room opened as the FIRST history entry (push
// notification tap / PWA cold start) gets a Home entry slipped underneath,
// so hardware back pops to Home instead of minimizing the app.
describe('home backstop for deep room entries', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('wants a backstop for any non-Home path at history index 0', () => {
    expect(needsBackstop(null, '/r/abc-def-ghj')).toBe(true);
    expect(needsBackstop({ idx: 0 }, '/r/abc-def-ghj')).toBe(true);
    expect(needsBackstop({ idx: 0 }, '/j/abc-def-ghj')).toBe(true); // invite link
    expect(needsBackstop({ idx: 0 }, '/settings')).toBe(true);
    expect(needsBackstop({ idx: 3 }, '/r/abc-def-ghj')).toBe(false); // entered from Home — back already works
    expect(needsBackstop({ idx: 0 }, '/')).toBe(false); // Home IS the bottom
  });

  it('slips a Home entry underneath and keeps the room on top, query intact', () => {
    window.history.replaceState({ idx: 0, key: 'k1' }, '', '/r/abc-def-ghj?panel=people');
    installHomeBackstop();
    // Visible location is untouched — still the room.
    expect(window.location.pathname + window.location.search).toBe('/r/abc-def-ghj?panel=people');
    expect((window.history.state as { idx?: number }).idx).toBe(1);
  });

  it('does nothing when the room was reached from inside the app', () => {
    window.history.replaceState({ idx: 2, key: 'k2' }, '', '/r/abc-def-ghj');
    const before = window.history.length;
    installHomeBackstop();
    expect(window.history.length).toBe(before);
    expect((window.history.state as { idx?: number }).idx).toBe(2);
  });
});
