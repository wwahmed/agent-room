import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/relativeTime.js';

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
}

export function RoomListPane({ activeCode }: { activeCode: string }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch('/api/rooms', { credentials: 'same-origin' });
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
      <div className="flex h-[52px] flex-shrink-0 items-center border-b border-border-faint px-4">
        <span className="text-[15px] font-semibold">Rooms</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {rooms.map(r => {
          const active = r.code === activeCode;
          return (
            <Link
              key={r.code}
              to={`/r/${r.code}`}
              className={`block min-h-11 rounded-lg px-3 py-2 transition ${active ? 'bg-accent-tint' : 'hover:bg-surface-softer'}`}
            >
              <div className="flex items-baseline gap-2">
                <div className={`min-w-0 flex-1 truncate text-[14px] font-semibold leading-snug ${active ? 'text-accent' : 'text-ink'}`}>{r.topic}</div>
                {r.lastActivityAt != null && (
                  <span className="flex-shrink-0 text-[10px] tabular-nums text-ink-faint" title={new Date(r.lastActivityAt).toLocaleString()}>
                    {relativeTime(r.lastActivityAt)}
                  </span>
                )}
              </div>
              <div className="truncate text-[11px] text-ink-faint">
                {r.participants} here
                {typeof r.messageCount === 'number' ? ` · ${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}` : ''}
                {r.status === 'ended' ? ' · ended' : ''}
              </div>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
