import { describe, expect, it } from 'vitest';
import { CHROME_HYSTERESIS, chromeStep, initialChromeVis } from './chromeVisibility.js';

// T-82: the chrome state machine. Direction + hysteresis, pinning, top and
// bottom reveals — every transition the phone gesture contract depends on.

const step = (v: ReturnType<typeof initialChromeVis>, top: number, pinned = false, atBottom = false) =>
  chromeStep(v, top, pinned, atBottom);

describe('chromeStep', () => {
  it('hides only after a deliberate downward accumulation past the hysteresis', () => {
    let v = initialChromeVis(100);
    v = step(v, 110); // +10, under threshold
    expect(v.hidden).toBe(false);
    v = step(v, 130); // +20 more, accumulated 30 > 24
    expect(v.hidden).toBe(true);
  });

  it('touch noise cannot flicker: alternating small deltas never flip state', () => {
    let v = initialChromeVis(500);
    for (const top of [510, 505, 515, 508, 518, 510]) v = step(v, top);
    expect(v.hidden).toBe(false); // reversals keep resetting the accumulator
  });

  it('a deliberate reverse gesture restores chrome', () => {
    let v = initialChromeVis(500);
    v = step(v, 560); // hide
    expect(v.hidden).toBe(true);
    v = step(v, 550); // -10, not yet
    expect(v.hidden).toBe(true);
    v = step(v, 530); // accumulated -30
    expect(v.hidden).toBe(false);
  });

  it('pinned states force chrome visible and reset accumulation', () => {
    let v = initialChromeVis(500);
    v = step(v, 560);
    expect(v.hidden).toBe(true);
    v = step(v, 600, true); // draft/focus/reply/upload/recording/dialog
    expect(v.hidden).toBe(false);
    expect(v.accum).toBe(0);
  });

  it('arriving at the newest message restores chrome', () => {
    let v = initialChromeVis(500);
    v = step(v, 560);
    expect(v.hidden).toBe(true);
    v = step(v, 900, false, true); // atBottom
    expect(v.hidden).toBe(false);
  });

  it('the history top always shows chrome', () => {
    let v = initialChromeVis(100);
    v = step(v, 160);
    expect(v.hidden).toBe(true);
    v = step(v, 4); // jumped to top
    expect(v.hidden).toBe(false);
  });

  it('threshold is exact: accumulation equal to the hysteresis does not hide', () => {
    let v = initialChromeVis(0);
    v = step(v, CHROME_HYSTERESIS);
    expect(v.hidden).toBe(false);
    v = step(v, CHROME_HYSTERESIS * 2 + 1);
    expect(v.hidden).toBe(true);
  });
});
