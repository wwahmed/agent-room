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

export function gateSummary(verdicts) {
  const changed = verdicts.filter(v => v.changed);
  const fresh = verdicts.filter(v => v.baselineMissing);
  const lines = [
    `visual-gate: ${verdicts.length} frames, ${changed.length} changed, ${fresh.length} new (no baseline)`,
    ...changed.map(v => `  CHANGED ${v.name} ${v.pct}`),
    ...fresh.map(v => `  NEW     ${v.name}`),
  ];
  // Changed frames exit 2; frames with no baseline exit 3 — both demand a
  // human action (review diffs, or explicitly create/promote the baseline).
  const exitCode = changed.length > 0 ? 2 : fresh.length > 0 ? 3 : 0;
  return {
    text: lines.join('\n'),
    exitCode,
    changed,
    fresh,
  };
}
