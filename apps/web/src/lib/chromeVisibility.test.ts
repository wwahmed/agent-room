import { describe, expect, it } from 'vitest';
import { CHROME_HYSTERESIS, chromeStep, initialChromeVis } from './chromeVisibility.js';

const step = (v: ReturnType<typeof initialChromeVis>, top: number, pinned = false, atBottom = false) =>
  chromeStep(v, top, pinned, atBottom);

describe('floating phone chrome visibility', () => {
  it('hides only after a deliberate downward gesture', () => {
    let v = initialChromeVis(100);
    v = step(v, 110);
    expect(v.hidden).toBe(false);
    v = step(v, 130);
    expect(v.hidden).toBe(true);
  });

  it('does not flicker from alternating touch noise', () => {
    let v = initialChromeVis(500);
    for (const top of [510, 505, 515, 508, 518, 510]) v = step(v, top);
    expect(v.hidden).toBe(false);
  });

  it('restores after a deliberate reverse gesture', () => {
    let v = step(initialChromeVis(500), 560);
    expect(v.hidden).toBe(true);
    v = step(v, 550);
    expect(v.hidden).toBe(true);
    v = step(v, 530);
    expect(v.hidden).toBe(false);
  });

  it('stays visible for pinned composer states and at either end', () => {
    const hidden = step(initialChromeVis(500), 560);
    expect(step(hidden, 600, true).hidden).toBe(false);
    expect(step(hidden, 900, false, true).hidden).toBe(false);
    expect(step(hidden, 4).hidden).toBe(false);
  });

  it('ignores programmatic teleports', () => {
    let v = step(initialChromeVis(0), 2400);
    expect(v.hidden).toBe(false);
    expect(v.accum).toBe(0);
    v = step(v, 2400 + CHROME_HYSTERESIS + 1);
    expect(v.hidden).toBe(true);
    v = step(v, 800);
    expect(v.hidden).toBe(true);
    expect(v.accum).toBe(0);
  });
});
