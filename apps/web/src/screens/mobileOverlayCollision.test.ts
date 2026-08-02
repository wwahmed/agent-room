import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

describe('phone chat overlays do not obscure conversation content', () => {
  it('reserves a real top row for the visible pinned control', () => {
    expect(room).toContain('paddingTop: 104 + (pinnedList.length > 0 && !ended && !chromeHidden ? 52 : 0)');
    expect(room).toContain('className="mx-auto flex min-h-11 items-center');
  });

  it('keeps pinned actions at the 44px phone touch floor', () => {
    expect(room.match(/className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('collapses Latest to a 44px circle on phones instead of covering prose', () => {
    expect(room).toContain('max-sm:w-11 max-sm:px-0');
    expect(room).toContain('className="hidden sm:inline"');
    expect(room).toContain('className="tabular-nums sm:hidden"');
  });
});
