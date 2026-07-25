import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

// Scroll-past-read (host order, reverts T-22's open-acknowledge): opening a
// room must not mark it read; the marker advances only as messages are
// actually scrolled past, when parked at the bottom, or via the Latest jump.
// This is what makes "come back later, land at the first unread again" work.
describe('scroll-past-read replaces the open-acknowledge (T-22 revert)', () => {
  it('no longer acknowledges the whole room on open', () => {
    expect(source).not.toContain('arrivalMarkedRef');
    expect(source).not.toContain('opening a room acknowledges the badge');
  });

  it('advances the marker from the scroll position via scrollReadCount', () => {
    expect(source).toContain("import { scrollReadCount } from '../lib/scrollRead.js';");
    expect(source).toContain('const count = scrollReadCount(');
    expect(source).toContain('if (count !== null) markRoomRead(code, count, self?.name);');
  });

  it('keeps the T-140 guards: marking waits for the landing commit AND the arrival snapshot', () => {
    expect(source).toContain('const canMark = landedRef.current && arrivalReadRef.current !== null;');
    expect(source).toContain('if (!landedRef.current || arrivalReadRef.current === null) return;');
  });

  it('still tracks new traffic while parked at the bottom', () => {
    expect(source).toContain('if (atBottomRef.current) markRoomRead(code, messageTotal, self?.name);');
  });
});
