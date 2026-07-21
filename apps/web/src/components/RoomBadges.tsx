import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { unreadCount } from '../lib/unread.js';
import { unreadWindowStats, type UnreadWindowStats } from '../lib/unreadWindow.js';

// T-18/T-20/T-25: the room card's badge cluster, shared by the Home list and
// the desktop RoomListPane so both surfaces always agree.
//   - unread badge: counter-based, refined by the unread window so status
//     pings and your own messages never count (falls back to the raw counter
//     if the window fetch fails)
//   - amber @N: unread messages that mention YOU (matches the in-bubble amber)
//   - agent health pill (T-25): agent count, green when all healthy, red when
//     any is stale/disconnected; tapping opens the room's People panel.

interface Props {
  code: string;
  messageCount?: number;
  selfName: string;
  /** The active room never shows unread badges (it is being read). */
  active?: boolean;
  /** Compact sizing for the dense desktop pane. */
  compact?: boolean;
}

/**
 * T-25 rev2 (host: red health next to red unread reads as more unread): agent
 * health is NOT an attention badge, so it lives apart from the unread/mention
 * cluster — in the card's metadata row, with an explicit agents icon, a text
 * label, and its own muted treatment. Tapping opens the room's People panel.
 */
export function AgentHealthChip({ code, agentCount = 0, agentsAllHealthy = true }: { code: string; agentCount?: number; agentsAllHealthy?: boolean }) {
  const navigate = useNavigate();
  if (agentCount <= 0) return null;
  const label = agentsAllHealthy
    ? `${agentCount} agent${agentCount === 1 ? '' : 's'}, all healthy`
    : `${agentCount} agent${agentCount === 1 ? '' : 's'}, attention needed`;
  return (
    <span
      role="button"
      tabIndex={0}
      title={`${label} — tap to open People`}
      aria-label={`${label} — open People panel`}
      onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`/r/${code}?panel=people`); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); navigate(`/r/${code}?panel=people`); } }}
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold transition hover:opacity-80 ${
        agentsAllHealthy
          ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-600'
          : 'border-red-600/40 bg-red-500/10 text-red-600'
      }`}
    >
      {/* two-heads agents glyph — clearly people, not a message count */}
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM1.5 13.2c0-2.1 2-3.7 4.5-3.7s4.5 1.6 4.5 3.7v.8h-9v-.8Zm10.1.8h2.9v-.7c0-1.6-1.3-2.8-3.1-3 .7.7 1.1 1.7 1.1 2.9v.8Z" />
      </svg>
      {agentCount}
      <span className={`h-1.5 w-1.5 rounded-full ${agentsAllHealthy ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} aria-hidden="true" />
    </span>
  );
}

export function RoomBadges({ code, messageCount, selfName, active = false, compact = false }: Props) {
  const navigate = useNavigate();
  const raw = active ? 0 : unreadCount(code, messageCount, selfName);
  const [stats, setStats] = useState<UnreadWindowStats | null>(null);

  useEffect(() => {
    if (raw <= 0) { setStats(null); return; }
    let cancelled = false;
    void unreadWindowStats(code, messageCount, selfName).then(s => {
      if (!cancelled) setStats(s);
    });
    return () => { cancelled = true; };
  }, [code, messageCount, selfName, raw]);

  const unread = stats ? stats.unread : raw;
  const mentions = stats?.mentions ?? 0;
  const badgeSize = compact ? 'h-5 min-w-5 text-[12px]' : 'h-6 min-w-6 text-[13px]';

  return (
    <>
      {mentions > 0 && (
        <span
          className={`flex ${badgeSize} flex-shrink-0 items-center justify-center rounded-full bg-amber-400 px-1.5 font-bold tabular-nums text-black ring-1 ring-inset ring-amber-500/60`}
          aria-label={`${mentions} unread mention${mentions === 1 ? '' : 's'} of you`}
          title={`${mentions} unread mention${mentions === 1 ? '' : 's'} of you`}
        >
          @{mentions > 99 ? '99+' : mentions}
        </span>
      )}
      {unread > 0 && (
        <span
          className={`flex ${badgeSize} flex-shrink-0 items-center justify-center rounded-full bg-accent px-1.5 font-bold tabular-nums text-white`}
          aria-label={`${unread} unread message${unread === 1 ? '' : 's'}`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </>
  );
}
