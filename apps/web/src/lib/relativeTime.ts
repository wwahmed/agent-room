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

// T-49: WhatsApp-style verbose timestamp for message rows. Recent messages read
// as "now / 1 minute ago / 2 minutes ago …"; past an hour they settle to a
// clock time (today) or a short date + time (older). Pure + injectable clock.
export function messageTime(ms: number | undefined, now: number = Date.now()): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const diff = now - ms;
  if (diff < 45_000) return 'now'; // also covers small clock-skew negatives
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const clock = new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  if (sameDay) return clock;
  const date = new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date}, ${clock}`;
}
