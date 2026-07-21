import { messageDayLabel } from '../lib/messageDays.js';

interface Props {
  time: number;
  now?: number;
}

export function MessageDayDivider({ time, now }: Props) {
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  const label = messageDayLabel(time, now);
  return (
    <div role="separator" aria-label={label} className="my-5 flex items-center gap-3 px-4">
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
      <time dateTime={date.toISOString()} className="shrink-0 rounded-full border border-border-subtle bg-surface-1 px-3 py-1 text-caption font-semibold text-ink-faint shadow-card">
        {label}
      </time>
      <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
    </div>
  );
}
