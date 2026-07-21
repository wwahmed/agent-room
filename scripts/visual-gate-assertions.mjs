// T-63: semantic geometry assertions for the visual gate. Pure rules over a
// measurement snapshot collected in-page, so every rule is unit-testable with
// a deliberately broken fixture. Each rule returns failure strings; the gate
// prints them as GEOMETRY findings and fails the deploy step.

export const TARGET_FLOOR = 44;      // px, interactive hit box
export const MOBILE_BUBBLE_MIN = 220; // px, message content floor on phones
export const CENTER_TOLERANCE = 4;   // px, overlay centering slack

/** Body horizontal overflow: the page must never scroll sideways. */
export function ruleOverflow(m) {
  return m.scrollWidth > m.viewportW + 1
    ? [`horizontal overflow: scrollWidth ${m.scrollWidth} > viewport ${m.viewportW}`]
    : [];
}

/** Interactive targets below the 44px floor (visible boxes only, deduped —
 *  one finding per distinct control anatomy, not one per rendered row). */
export function ruleTargets(m) {
  const seen = new Set();
  return (m.buttons ?? [])
    .filter(b => b.w >= 8 && b.h >= 8 && (b.w < TARGET_FLOOR || b.h < TARGET_FLOOR))
    .filter(b => {
      const key = `${b.label}|${Math.round(b.w)}x${Math.round(b.h)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map(b => `target under 44px: "${b.label}" ${Math.round(b.w)}x${Math.round(b.h)}`);
}

/** Controls clipped by the viewport's horizontal edges. Only elements that
 *  are vertically on screen count (scrolled-away transcript rows are fine),
 *  and members of deliberately scrollable-x containers (the tab bar) are
 *  exempt — horizontal reachability there comes from scrolling. */
export function ruleClipped(m) {
  const seen = new Set();
  return (m.buttons ?? [])
    .filter(b => b.w >= 8
      && !b.inScrollX
      && b.y + b.h > 0 && b.y < m.viewportH
      && (b.x < -1 || b.x + b.w > m.viewportW + 1))
    .filter(b => {
      const key = `${b.label}|${Math.round(b.x)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map(b => `clipped control: "${b.label}" at x=${Math.round(b.x)} w=${Math.round(b.w)} (viewport ${m.viewportW})`);
}

/** Overlays are either viewport-centered or trigger-anchored — never adrift. */
export function ruleOverlayPlacement(m) {
  if (!m.overlay) return [];
  const center = m.overlay.left + m.overlay.width / 2;
  const viewportCenter = m.viewportW / 2;
  const okViewport = Math.abs(center - viewportCenter) <= CENTER_TOLERANCE;
  const okTrigger = m.overlayTriggerCenter != null && Math.abs(center - m.overlayTriggerCenter) <= CENTER_TOLERANCE;
  return okViewport || okTrigger
    ? []
    : [`overlay adrift: center ${Math.round(center)} vs viewport ${Math.round(viewportCenter)} vs trigger ${m.overlayTriggerCenter == null ? 'n/a' : Math.round(m.overlayTriggerCenter)}`];
}

/** Message content must not collapse below the mobile minimum. */
export function ruleMobileBubbles(m) {
  if (m.viewportW > 480) return [];
  return (m.bubbles ?? [])
    .filter(b => (typeof b === 'object' ? b.wrapped && b.w > 0 && b.w < MOBILE_BUBBLE_MIN : b > 0 && b < MOBILE_BUBBLE_MIN))
    .slice(0, 3)
    .map(b => `message content collapsed: ${Math.round(typeof b === 'object' ? b.w : b)}px < ${MOBILE_BUBBLE_MIN}px minimum${typeof b === 'object' && b.snippet ? ` ("${b.snippet}")` : ''}`);
}

/** T-72: an Activity Note's body owns the note's full column — the one-line
 *  ribbon failure (chip + name + time caging the text into a vertical strip)
 *  is mechanically impossible to ship. On phones the note itself must hold a
 *  humane column of the viewport. */
export function ruleStatusNoteWidth(m) {
  const out = [];
  for (const n of (m.statusNotes ?? [])) {
    if (n.bodyW != null && n.bodyW < n.w - 48) {
      out.push(`status body caged: ${Math.round(n.bodyW)}px inside a ${Math.round(n.w)}px note${n.snippet ? ` ("${n.snippet}")` : ''}`);
    }
    if (m.viewportW < 640 && n.w > 0 && n.w < m.viewportW * 0.8) {
      out.push(`status note narrow: ${Math.round(n.w)}px < 80% of ${m.viewportW}px viewport`);
    }
  }
  return out.slice(0, 4);
}

/** T-72 rev4 (design lead): the Show-more pointer box is auditable and
 *  strictly contained — inside its own Activity Note, intersecting neither
 *  the updates control nor any OTHER note (the next card). A hit target that
 *  can steal a neighbour's taps is a geometry failure. */
export function ruleDisclosureClearance(m) {
  const out = [];
  const notes = m.statusNotes ?? [];
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  notes.forEach((n, i) => {
    const sm = n.showMore;
    if (!sm) return;
    const card = { left: n.left, top: n.top, right: n.right, bottom: n.bottom };
    if (!(sm.left >= card.left - 1 && sm.right <= card.right + 1 && sm.top >= card.top - 1 && sm.bottom <= card.bottom + 1)) {
      out.push(`disclosure target escapes its card${n.snippet ? ` ("${n.snippet}")` : ''}`);
    }
    if (n.updates && overlaps(sm, n.updates)) {
      out.push(`disclosure target overlaps the updates control${n.snippet ? ` ("${n.snippet}")` : ''}`);
    }
    notes.forEach((other, j) => {
      if (j !== i && overlaps(sm, { left: other.left, top: other.top, right: other.right, bottom: other.bottom })) {
        out.push(`disclosure target intersects a neighbouring card${n.snippet ? ` ("${n.snippet}")` : ''}`);
      }
    });
  });
  return out.slice(0, 4);
}

/** T-72 acceptance: the jump-to-latest pill must never sit ON an Activity
 *  Note at the captured scroll position (the ribbon screenshot's second
 *  failure — the pill floating mid-column over squeezed text). */
export function ruleFloatingVsStatusNote(m) {
  const out = [];
  for (const f of (m.floating ?? [])) {
    if (!(f.w > 4 && f.h > 4)) continue;
    for (const n of (m.statusNotes ?? [])) {
      if (f.x < n.right && f.x + f.w > n.left && f.y < n.bottom && f.y + f.h > n.top) {
        out.push(`floating control overlaps status note: "${f.label}"${n.snippet ? ` over ("${n.snippet}")` : ''}`);
      }
    }
  }
  return out.slice(0, 3);
}

/** Shell surfaces must agree on a theme: no dark header over a light canvas. */
export function ruleMixedTheme(m) {
  const lums = Object.entries(m.surfaces ?? {}).filter(([, v]) => v != null);
  if (lums.length < 2) return [];
  const dark = lums.filter(([, v]) => v < 0.5).map(([k]) => k);
  const light = lums.filter(([, v]) => v >= 0.5).map(([k]) => k);
  return dark.length && light.length
    ? [`mixed-theme shell: dark [${dark.join(', ')}] vs light [${light.join(', ')}]`]
    : [];
}

/** Floating controls must not sit on top of the composer. */
export function ruleFloatingVsComposer(m) {
  if (!m.composer) return [];
  const c = m.composer;
  return (m.floating ?? [])
    .filter(f => f.w > 4 && f.h > 4
      && f.x < c.x + c.w && f.x + f.w > c.x
      && f.y < c.y + c.h && f.y + f.h > c.y)
    .slice(0, 3)
    .map(f => `floating control overlaps composer: "${f.label}"`);
}

/** Scrollable-x containers must not FULLY hide interactive controls at rest.
 *  No magic ratio (rev3 review): the deterministic signal is a control the
 *  user cannot see at all without discovering that scrolling exists. */
export function ruleScrollReach(m) {
  const out = [];
  for (const c of (m.scrollContainers ?? [])) {
    if ((c.hiddenControls ?? 0) > 0) out.push(`scroll container fully hides ${c.hiddenControls} interactive control(s) at rest ("${c.label}")`);
    // rev4 (review finding): partial clipping is a finding too — a control
    // showing less than 75% of its width at rest reads as broken, not scrollable.
    if ((c.partiallyHiddenControls ?? 0) > 0) out.push(`scroll container partially clips ${c.partiallyHiddenControls} interactive control(s) at rest ("${c.label}")`);
  }
  return out.slice(0, 4);
}

/** T-63 acceptance (design lead): the approved semantic type roles are
 *  mechanically gated. Floors come from scripts/type-floors.json; a computed
 *  size or weight below floor on the LIVE element fails the deploy. The
 *  fourth type regression of the night shipped through a green gate — this
 *  rule is why that cannot happen a fifth time. */
export function ruleTypeFloors(m) {
  if (!m.typeRoles || !m.typeFloors) return [];
  const floors = m.viewportW < 640 ? m.typeFloors.phone : m.typeFloors.desktop;
  const out = [];
  for (const [role, floor] of Object.entries(floors ?? {})) {
    const live = m.typeRoles[role];
    if (!live) continue; // role absent on this surface — the matrix covers it elsewhere
    if (floor.fontSize && live.fontSize < floor.fontSize - 0.01) {
      out.push(`type floor: ${role} ${live.fontSize}px < ${floor.fontSize}px minimum`);
    }
    if (floor.fontWeight && live.fontWeight < floor.fontWeight) {
      out.push(`type floor: ${role} weight ${live.fontWeight} < ${floor.fontWeight} minimum`);
    }
  }
  return out.slice(0, 6);
}

const RULES = [ruleOverflow, ruleTargets, ruleClipped, ruleOverlayPlacement, ruleMobileBubbles, ruleMixedTheme, ruleFloatingVsComposer, ruleScrollReach, ruleTypeFloors, ruleStatusNoteWidth, ruleFloatingVsStatusNote, ruleDisclosureClearance];

export function evaluateAssertions(measurement) {
  return RULES.flatMap(rule => rule(measurement));
}
