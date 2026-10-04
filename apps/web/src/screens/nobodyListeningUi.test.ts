import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const room = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');

describe('legacy nobody-listening false alerts', () => {
  it('removes them from the visible transcript before grouping and day dividers', () => {
    expect(room).toContain("m.metadata?.eventType !== 'nobody_listening'");
    expect(room.indexOf("m.metadata?.eventType !== 'nobody_listening'"))
      .toBeLessThan(room.indexOf('const statusView = collapseStatusRuns(visibleMessages)'));
    expect(room).not.toContain("m.metadata?.eventType === 'nobody_listening' ? (");
  });
});
