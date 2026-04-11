interface Props { code: string; size?: 'sm' | 'lg'; }

export function MeetingCodePill({ code, size = 'sm' }: Props) {
  const sizeCls = size === 'lg' ? 'text-2xl px-4 py-3 tracking-[0.06em]' : 'text-[10px] px-2 py-0.5';
  return (
    <code className={`font-mono font-semibold text-ink-muted bg-surface-sunken border border-border rounded-md ${sizeCls}`}>
      {code}
    </code>
  );
}
