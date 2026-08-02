import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

describe('phone chat overlays do not obscure conversation content', () => {
  it('gives the phone header and pinned control real non-scrolling layout rows', () => {
    expect(room).toContain('data-gate="mobile-header-clearance"');
    expect(room).toContain('h-[104px] flex-shrink-0');
    expect(room).toContain('data-gate="pinned-strip"');
    expect(room).toContain('flex flex-shrink-0 justify-center');
    expect(room).toContain('paddingTop: 0');
    expect(room).toContain('data-gate="feed" className="relative min-h-0 flex-1 overflow-y-auto');
    expect(room).toContain('className="mx-auto flex min-h-11 items-center');
  });

  it('keeps pinned actions at the 44px phone touch floor', () => {
    expect(room.match(/className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('places Latest in a real layout lane at every breakpoint', () => {
    expect(room).toContain('room-latest-lane z-[25] flex w-full flex-shrink-0');
    expect(room).toContain('style={!isPhone ? { marginBottom: composerH } : undefined}');
    expect(room).not.toContain('sm:absolute sm:inset-x-0 sm:z-[25]');
    expect(room).toContain('max-sm:w-11 max-sm:px-0');
    expect(room).toContain('className="hidden sm:inline"');
    expect(room).toContain('className="tabular-nums sm:hidden"');
  });

  it('reserves the measured phone composer height outside the message scrollport', () => {
    expect(room).toContain('data-gate="mobile-composer-clearance"');
    expect(room).toContain('style={{ height: composerH }}');
  });
});
