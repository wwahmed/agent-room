import { describe, expect, it } from 'vitest';
import {
  evaluateAssertions,
  ruleClipped,
  ruleFloatingVsComposer,
  ruleMixedTheme,
  ruleMobileBubbles,
  ruleOverflow,
  ruleOverlayPlacement,
  ruleTargets,
} from './visual-gate-assertions.mjs';

// T-63 DoD: every assertion is proven by a deliberately broken fixture.
const clean = {
  viewportW: 1440,
  viewportH: 900,
  scrollWidth: 1440,
  buttons: [{ label: 'ok', w: 44, h: 44, x: 10, y: 10 }],
  surfaces: { header: 0.1, aside: 0.12, body: 0.08 },
  overlay: null,
  bubbles: [400],
  composer: { x: 100, y: 800, w: 800, h: 60 },
  floating: [],
};

describe('visual gate geometry assertions', () => {
  it('clean measurement passes every rule', () => {
    expect(evaluateAssertions(clean)).toEqual([]);
  });

  it('BROKEN: body horizontal overflow fails', () => {
    expect(ruleOverflow({ ...clean, scrollWidth: 1500 })[0]).toContain('horizontal overflow');
  });

  it('BROKEN: a 36px target fails the 44px floor', () => {
    const fails = ruleTargets({ ...clean, buttons: [{ label: 'kick', w: 36, h: 36, x: 5, y: 5 }] });
    expect(fails[0]).toContain('target under 44px: "kick" 36x36');
  });

  it('BROKEN: a control past the right edge is clipped', () => {
    const fails = ruleClipped({ ...clean, buttons: [{ label: 'share', w: 44, h: 44, x: 1420, y: 5 }] });
    expect(fails[0]).toContain('clipped control');
    // scrolled-away rows and scrollable-x members are exempt
    expect(ruleClipped({ ...clean, buttons: [{ label: 'above fold', w: 44, h: 44, x: 1420, y: -600 }] })).toEqual([]);
    expect(ruleClipped({ ...clean, buttons: [{ label: 'tab', w: 84, h: 44, x: 1420, y: 5, inScrollX: true }] })).toEqual([]);
  });

  it('duplicate small targets collapse to one finding per anatomy', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ label: 'Message actions', w: 24, h: 24, x: 5, y: 5 + i * 40 }));
    expect(ruleTargets({ ...clean, buttons: rows })).toHaveLength(1);
  });

  it('BROKEN: an overlay neither viewport-centered nor trigger-anchored is adrift', () => {
    const fails = ruleOverlayPlacement({ ...clean, overlay: { left: 100, width: 500 }, overlayTriggerCenter: 1100 });
    expect(fails[0]).toContain('overlay adrift');
    // anchored to trigger passes
    expect(ruleOverlayPlacement({ ...clean, overlay: { left: 850, width: 500 }, overlayTriggerCenter: 1100 })).toEqual([]);
    // viewport-centered passes
    expect(ruleOverlayPlacement({ ...clean, overlay: { left: 470, width: 500 }, overlayTriggerCenter: null })).toEqual([]);
  });

  it('BROKEN: a 150px message bubble on a phone collapses below the minimum', () => {
    const fails = ruleMobileBubbles({ ...clean, viewportW: 390, bubbles: [150] });
    expect(fails[0]).toContain('message content collapsed: 150px');
    // same width on desktop is fine
    expect(ruleMobileBubbles({ ...clean, viewportW: 1440, bubbles: [150] })).toEqual([]);
  });

  it('BROKEN: dark header over a light canvas is a mixed-theme shell', () => {
    const fails = ruleMixedTheme({ ...clean, surfaces: { header: 0.1, body: 0.9 } });
    expect(fails[0]).toContain('mixed-theme shell');
  });

  it('BROKEN: a floating pill on top of the composer fails', () => {
    const fails = ruleFloatingVsComposer({
      ...clean,
      floating: [{ label: 'Latest', x: 400, y: 810, w: 120, h: 40 }],
    });
    expect(fails[0]).toContain('floating control overlaps composer: "Latest"');
  });
});
