import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/relativeTime.js';
import { RoomBadges } from './RoomBadges.js';
import { AgentFacepile } from './AgentFacepile.js';

// T-05 desktop room list (280px column between the rail and the chat).
// Authenticated users get their active rooms with one-tap switching;
// anonymous visitors (or fetch failures) collapse the pane entirely so
// the chat gets the width back. Data comes from the same authenticated
// /api/rooms endpoint Home uses.

interface RoomSummary {
  code: string;
  topic: string;
  status: string;
  participants: number;
  createdAt?: number;
  // T-35 (server contract 825f0ef): last-message time (falls back to createdAt
  // server-side) and message count; list arrives sorted recent-activity-first.
  lastActivityAt?: number;
  messageCount?: number;
  // T-25: agent attachment + server health verdict for the card pill.
  agentCount?: number;
  agentsAllHealthy?: boolean;
  // T-34: per-agent faces + stale count for the compact facepile.
  agentStaleCount?: number;
  agents?: Array<{ name: string; color: string; initials: string; state: 'listening' | 'online' | 'stale' | 'disconnected' }>;
}

export function RoomListPane({ activeCode, selfName }: { activeCode: string; selfName: string }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch('/api/rooms?limit=40', { credentials: 'same-origin' });
        if (!res.ok) { if (!cancelled) setRooms(null); return; }
        const body = (await res.json()) as { rooms?: RoomSummary[] };
        if (!cancelled) setRooms(body.rooms ?? []);
      } catch {
        if (!cancelled) setRooms(null);
      }
    }
    void pull();
    const id = window.setInterval(pull, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  if (!rooms || rooms.length === 0) return null;

  return (
    <aside className="hidden h-full w-[280px] flex-shrink-0 flex-col border-r border-border-faint bg-surface xl:flex">
      <div className="flex h-[60px] flex-shrink-0 items-center border-b border-border-faint px-4">
        <span className="text-[16px] font-semibold">Rooms</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rooms.map(r => {
          const active = r.code === activeCode;
          // T-34: stretched-link row — the overlay Link opens the chat, the
          // compact facepile is a sibling button (z-10) that opens People.
          return (
            <div
              key={r.code}
              className={`relative block min-h-11 rounded-lg px-3 py-2 transition ${active ? 'bg-accent-tint' : 'hover:bg-surface-softer'}`}
            >
              <Link
                to={`/r/${r.code}`}
                aria-label={`Open ${r.topic}`}
                className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-tint"
              />
              <div className="flex items-baseline gap-2">
                <div className={`min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug ${active ? 'text-accent' : 'text-ink'}`}>{r.topic}</div>
                {/* T-62 badge refined by T-18/T-20 — attention signals only.
                    The active room never shows unread — it is being read. */}
                <RoomBadges
                  code={r.code}
                  messageCount={r.messageCount}
                  selfName={selfName}
                  active={active}
                  compact
                />
                {r.lastActivityAt != null && (
                  <span className="flex-shrink-0 text-[12px] tabular-nums text-ink-faint" title={new Date(r.lastActivityAt).toLocaleString()}>
                    {relativeTime(r.lastActivityAt)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
                <span className="truncate">
                  {r.participants} here
                  {typeof r.messageCount === 'number' ? ` · ${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}` : ''}
                  {r.status === 'ended' ? ' · ended' : ''}
                </span>
                {/* UX taste pass: presence is for LIVE rooms only — an ended
                    room gets no facepile, no badge, nothing to alarm about. */}
                {r.status !== 'ended' && (r.agentCount ?? 0) > 0 && (
                  <span className="ml-auto">
                    <AgentFacepile
                      code={r.code}
                      agentCount={r.agentCount ?? 0}
                      agentStaleCount={r.agentStaleCount ?? (r.agentsAllHealthy === false ? (r.agentCount ?? 0) : 0)}
                      agents={r.agents ?? []}
                      compact
                    />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
