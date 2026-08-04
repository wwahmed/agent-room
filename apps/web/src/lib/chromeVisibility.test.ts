import { describe, expect, it } from 'vitest';
import { CHROME_HYSTERESIS, chromeAnchoredTop, chromeStep, initialChromeVis } from './chromeVisibility.js';

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

  it('programmatic teleports (first-unread landing, seeks) never flip chrome', () => {
    // Cold load: landing jump from 0 to mid-feed must NOT read as a gesture.
    let v = initialChromeVis(0);
    v = step(v, 2400);
    expect(v.hidden).toBe(false);
    expect(v.accum).toBe(0);
    // While hidden, an upward mention-seek teleport keeps state, no flicker.
    v = step(v, 2460); // real gesture hides
    expect(v.hidden).toBe(true);
    v = step(v, 800); // seek far up
    expect(v.hidden).toBe(true);
    expect(v.accum).toBe(0);
  });

  it('threshold is exact: accumulation equal to the hysteresis does not hide', () => {
    let v = initialChromeVis(0);
    v = step(v, CHROME_HYSTERESIS);
    expect(v.hidden).toBe(false);
    v = step(v, CHROME_HYSTERESIS * 2 + 1);
    expect(v.hidden).toBe(true);
  });

  // Host order: "if the header and footer move away, they should NOT move the
  // reading position." Tail-anchoring was the old answer and is now the bug —
  // these pin the replacement in both directions.
  it('absorbs the feed growing when the header clearance unmounts', () => {
    // Measured live at 375px: hiding the chrome takes the feed 708 -> 812, and
    // uncompensated the tracked message rode 104px up the screen. Scrolling
    // back down by the same 104 is what keeps it still.
    expect(chromeAnchoredTop(8_030, 708, 16_944, 812)).toBe(8_030 - 104);
    // And the reverse leg, restoring the chrome.
    expect(chromeAnchoredTop(7_926, 812, 16_944, 708)).toBe(7_926 + 104);
  });

  it('holds position exactly when only scrollHeight moved', () => {
    // A scrollHeight change is content below the reader; it is not the reader
    // moving. This is the case the tail form got wrong.
    expect(chromeAnchoredTop(11_025, 562, 27_377, 562)).toBe(11_025);
    expect(chromeAnchoredTop(11_025, 562, 27_377 - 122, 562)).toBe(11_025);
    expect(chromeAnchoredTop(11_025, 562, 27_377 + 122, 562)).toBe(11_025);
  });

  it('does not reintroduce the composer-sized jump of the tail form', () => {
    // The defect, stated as arithmetic: preserving distance-from-tail across a
    // 122px scrollHeight shrink moves the reader by exactly 122px.
    const top = 11_025, height = 27_377, client = 562;
    const tailDistance = height - top - client;
    expect((height - 122) - client - tailDistance).toBe(top - 122);
    expect(chromeAnchoredTop(top, client, height - 122, client)).toBe(top);
  });

  it('yields to a real clamp rather than fighting it', () => {
    expect(chromeAnchoredTop(27_000, 562, 27_377, 562)).toBe(26_815);
    expect(chromeAnchoredTop(-5, 562, 27_377, 562)).toBe(0);
    // Content shorter than the viewport: the only valid position is 0.
    expect(chromeAnchoredTop(400, 812, 500, 812)).toBe(0);
  });
});
