import { describe, expect, it } from 'vitest';
import {
  evaluateAssertions,
  ruleScrollReach,
  ruleTypeFloors,
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

  it('BROKEN: a WRAPPED 150px bubble on a phone collapses below the minimum', () => {
    const fails = ruleMobileBubbles({ ...clean, viewportW: 390, bubbles: [{ w: 150, wrapped: true }] });
    expect(fails[0]).toContain('message content collapsed: 150px');
    // an intrinsically narrow one-liner is fine; desktop is fine either way
    expect(ruleMobileBubbles({ ...clean, viewportW: 390, bubbles: [{ w: 150, wrapped: false }] })).toEqual([]);
    expect(ruleMobileBubbles({ ...clean, viewportW: 1440, bubbles: [{ w: 150, wrapped: true }] })).toEqual([]);
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

describe('ruleScrollReach (rev3: hidden controls, no magic ratio)', () => {
  it('BROKEN: a container fully hiding an interactive control fails', () => {
    const fails = ruleScrollReach({ scrollContainers: [{ label: 'tabs', hiddenControls: 1 }] });
    expect(fails[0]).toContain('fully hides 1 interactive control');
  });
  it('overflow that keeps every control at least partially visible passes', () => {
    expect(ruleScrollReach({ scrollContainers: [{ label: 'tabs', hiddenControls: 0 }] })).toEqual([]);
  });
});

describe('ruleScrollReach partial clipping (rev4)', () => {
  it('BROKEN: a control mostly clipped by its container edge fails', () => {
    const fails = ruleScrollReach({ scrollContainers: [{ label: 'tabs', hiddenControls: 0, partiallyHiddenControls: 1 }] });
    expect(fails[0]).toContain('partially clips 1 interactive control');
  });
});

describe('ruleTypeFloors (T-63 acceptance: mechanically gated type roles)', () => {
  const floors = {
    phone: { prose: { fontSize: 19, fontWeight: 400 }, composerTyped: { fontSize: 18 } },
    desktop: { prose: { fontSize: 15, fontWeight: 400 } },
  };
  it('BROKEN: 13px phone prose fails the floor', () => {
    const fails = ruleTypeFloors({ viewportW: 390, typeFloors: floors, typeRoles: { prose: { fontSize: 13, fontWeight: 400 } } });
    expect(fails[0]).toContain('type floor: prose 13px < 19px minimum');
  });
  it('BROKEN: a typed composer at 16px on a phone fails the 18px floor', () => {
    const fails = ruleTypeFloors({ viewportW: 390, typeFloors: floors, typeRoles: { composerTyped: { fontSize: 16, fontWeight: 400 } } });
    expect(fails[0]).toContain('composerTyped 16px < 18px');
  });
  it('meeting or exceeding the floor passes; absent roles are skipped', () => {
    expect(ruleTypeFloors({ viewportW: 390, typeFloors: floors, typeRoles: { prose: { fontSize: 20, fontWeight: 400 } } })).toEqual([]);
    expect(ruleTypeFloors({ viewportW: 1440, typeFloors: floors, typeRoles: {} })).toEqual([]);
  });
});
