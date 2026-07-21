import { useEffect, useState } from 'react';
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
 * T-25 rev3 (host: the chip "hijacks the click on the row" and is confusing):
 * a PASSIVE, corner-tucked indicator only. No handlers, no role, no tab stop —
 * the row's own click always opens the chat. The word "agents" is spelled out
 * so the count cannot be mistaken for messages, and the dot alone carries the
 * health verdict. Diagnosis path: open the room, then the People tab.
 */
export function AgentHealthChip({ agentCount = 0, agentsAllHealthy = true }: { agentCount?: number; agentsAllHealthy?: boolean }) {
  if (agentCount <= 0) return null;
  const label = agentsAllHealthy
    ? `${agentCount} agent${agentCount === 1 ? '' : 's'}, all healthy`
    : `${agentCount} agent${agentCount === 1 ? '' : 's'}, attention needed — check People`;
  return (
    <span
      title={label}
      aria-label={label}
      className={`pointer-events-none ml-auto inline-flex flex-shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
        agentsAllHealthy ? 'text-emerald-600/80' : 'text-red-500'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${agentsAllHealthy ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} aria-hidden="true" />
      {agentCount} agent{agentCount === 1 ? '' : 's'}
    </span>
  );
}

export function RoomBadges({ code, messageCount, selfName, active = false, compact = false }: Props) {
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
