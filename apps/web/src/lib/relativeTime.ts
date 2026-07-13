// T-35 presentation: compact relative time for the room list (and reusable for
// the mentions inbox later): "now", "5m", "3h", "2d", then a short date. Pure,
// with an injectable clock so it's unit-testable.
export function relativeTime(ms: number | undefined, now: number = Date.now()): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const diff = now - ms;
  if (diff < 60_000) return 'now'; // also covers small clock-skew negatives
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
