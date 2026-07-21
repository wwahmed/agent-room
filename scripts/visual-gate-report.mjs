// T-61: pure report logic for the visual gate, split out so it is testable
// without a browser. A frame "changed" when its diff ratio crosses the
// threshold; the gate's exit code is nonzero whenever anything changed, so
// the deployer must look at the diff frames before announcing.

export const CHANGE_THRESHOLD = 0.001; // 0.1% of pixels

export function frameVerdict(name, diffPixels, totalPixels) {
  const ratio = totalPixels > 0 ? diffPixels / totalPixels : 0;
  return {
    name,
    diffPixels,
    ratio,
    pct: `${(ratio * 100).toFixed(2)}%`,
    changed: ratio > CHANGE_THRESHOLD,
  };
}

export function gateSummary(verdicts, geometryFailures = [], capture = null) {
  const changed = verdicts.filter(v => v.changed);
  const fresh = verdicts.filter(v => v.baselineMissing);
  const incomplete = capture != null && capture.captured < capture.expected;
  const lines = [
    `visual-gate: ${verdicts.length} frames, ${changed.length} changed, ${fresh.length} new (no baseline), ${geometryFailures.length} geometry findings`,
    ...(incomplete ? [`  CAPTURE-INCOMPLETE ${capture.captured}/${capture.expected} frames captured — results untrustworthy`] : []),
    ...geometryFailures.map(g => `  GEOMETRY ${g.frame}: ${g.failure}`),
    ...changed.map(v => `  CHANGED ${v.name} ${v.pct}`),
    ...fresh.map(v => `  NEW     ${v.name}`),
  ];
  // Exit precedence: incomplete capture (5) makes every other verdict
  // untrustworthy; then geometry (4), changed frames (2), missing baselines
  // (3 — below changed because changed already forces the same review).
  const exitCode = incomplete ? 5
    : geometryFailures.length > 0 ? 4
    : changed.length > 0 ? 2
    : fresh.length > 0 ? 3 : 0;
  return {
    text: lines.join('\n'),
    exitCode,
    changed,
    fresh,
    geometryFailures,
    incomplete,
  };
}

/** T-63 rev3: the frame matrix is enumerated STATICALLY before any capture,
 *  so a failed state (fixture seeding, palette not opening) can never shrink
 *  the expected count and fake a complete run. */
export function enumerateFrames(states, viewports, themes) {
  const frames = [];
  for (const vp of viewports) {
    for (const theme of themes) {
      for (const st of states) {
        frames.push(`${st}-${vp}-${theme}.png`);
      }
    }
  }
  return frames;
}
