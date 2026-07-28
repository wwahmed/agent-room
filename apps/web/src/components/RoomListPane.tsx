import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/relativeTime.js';
import { RoomBadges } from './RoomBadges.js';
import { RoomIdentitySlot } from './RoomIdentitySlot.js';
import { RoomContextMenu, useRoomCardMenu } from './RoomContextMenu.js';
import { ROOM_SORTS, ROOM_SORT_STORAGE_KEY, resolveRoomSort, saveRoomSort, sortRooms, subscribeRoomSort, type RoomSort } from '../lib/roomSort.js';
import { unreadCount } from '../lib/unread.js';

// T-05 desktop room list between the rail and the chat. T-55 makes it
// responsive rather than pinning a large desktop monitor to a cramped 280px.
// Authenticated users get their active rooms with one-tap switching;
// anonymous visitors (or fetch failures) collapse the pane entirely so
// the chat gets the width back. Data comes from the same authenticated
// /api/rooms endpoint Home uses.

interface RoomSummary {
  code: string;
  topic: string;
  status: string;
  archived?: boolean;
  participants: number;
  /** T-34b: present participants (server verdict), not raw rows. Falls back to
   *  the raw count only for a server too old to send it. */
  participantsHere?: number;
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
  agents?: Array<{ name: string; color: string; initials: string; harness?: string; state: 'listening' | 'online' | 'working' | 'stale' | 'disconnected' }>;
}

export function RoomListPane({ activeCode, selfName }: { activeCode: string; selfName: string }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  // T-38: the rail used to render the server's activity order and ignore the
  // sort preference entirely — so choosing a fixed order on Home left the rail
  // still reshuffling, which is the surface the host actually types into.
  const [sort, setSort] = useState<RoomSort>(() => {
    try { return resolveRoomSort(localStorage.getItem(ROOM_SORT_STORAGE_KEY)); } catch { return resolveRoomSort(null); }
  });
  useEffect(() => subscribeRoomSort(setSort), []);
  // Shared long-press / right-click room actions (same menu as Home's cards).
  const { menu, closeMenu, bind } = useRoomCardMenu();
  // Resizable width (house taste), persisted; drag the right edge, double-click resets.
  const asideRef = useRef<HTMLElement>(null);
  const draggingRef = useRef(false);
  const [width, setWidth] = useState<number>(() => {
    try { const v = Number(localStorage.getItem('roomlist:width')); if (v >= 240 && v <= 640) return v; } catch { /* private mode */ }
    return 340;
  });

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!draggingRef.current || !asideRef.current) return;
      const left = asideRef.current.getBoundingClientRect().left;
      setWidth(Math.min(640, Math.max(240, e.clientX - left)));
    };
    const up = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = '';
      setWidth(w => { try { localStorage.setItem('roomlist:width', String(Math.round(w))); } catch { /* ignore */ } return w; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  async function pull() {
    try {
      const res = await fetch('/api/rooms?limit=40', { credentials: 'same-origin' });
      if (!res.ok) { setRooms(null); return; }
      const body = (await res.json()) as { rooms?: RoomSummary[] };
      setRooms(body.rooms ?? []);
    } catch {
      setRooms(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => { if (!cancelled) await pull(); })();
    const id = window.setInterval(() => { if (!cancelled) void pull(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const visible = sortRooms((rooms ?? []).filter((r) => !r.archived), sort);
  if (!rooms || visible.length === 0) return null;

  return (
    <aside ref={asideRef} style={{ width }} className="relative hidden h-full flex-shrink-0 flex-col border-r border-border-faint bg-surface xl:flex" data-room-list-width="resizable">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 modern-scrollbar">
        <div className="flex h-8 items-center gap-2 px-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          <span>Rooms</span>
          {/* T-38: order control lives HERE, on the rail being mis-clicked, not
              only on Home. Shares one preference with Home so the two surfaces
              can never disagree about the order. */}
          <select
            value={sort}
            onChange={e => { const next = resolveRoomSort(e.target.value); setSort(next); saveRoomSort(next); }}
            aria-label="Sort rooms"
            data-gate="rail-room-sort"
            className="ml-auto max-w-[58%] flex-shrink-0 truncate rounded-lg border border-border-faint bg-surface-softer px-1.5 py-0.5 text-[12px] font-semibold normal-case tracking-normal text-ink-soft outline-none transition focus:border-accent"
          >
            {ROOM_SORTS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {visible.map(r => {
          const active = r.code === activeCode;
          // Same cheap synchronous counter RoomBadges uses as its base, so the
          // bold state and the badge can never disagree.
          const hasUnread = !active && unreadCount(r.code, r.messageCount, selfName) > 0;
          // T-34: stretched-link row — the overlay Link opens the chat, the
          // compact facepile is a sibling button (z-10) that opens People.
          return (
            <div
              key={r.code}
              {...bind({ code: r.code, topic: r.topic, status: r.status, archived: r.archived })}
              className={`room-list-row relative flex min-h-14 items-center gap-3 rounded-lg px-3 py-3 transition ${active ? 'bg-accent-tint' : 'hover:bg-surface-softer'}`}
            >
              <Link
                to={`/r/${r.code}`}
                aria-label={`Open ${r.topic}`}
                className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-tint"
              />
              {/* T-55: match Home/mobile — identity is always the first,
                  left-side column; details never push it to the row's end. */}
              <RoomIdentitySlot
                code={r.code}
                agentCount={r.status !== 'ended' ? (r.agentCount ?? 0) : 0}
                agentStaleCount={r.agentStaleCount ?? (r.agentsAllHealthy === false ? (r.agentCount ?? 0) : 0)}
                agents={r.agents ?? []}
                compact
                showFallback={r.status !== 'ended'}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  {/* T-44: an unread room reads BOLD, the way every chat client
                      the host already uses does it. The count badge alone was
                      easy to miss in a dense rail — "make the unread or new be
                      bold and show counts, like Teams does". The active room is
                      never bold: it is being read. */}
                  <div className={`room-list-title min-w-0 flex-1 truncate text-[14px] leading-snug ${active ? 'text-accent' : hasUnread ? 'font-semibold text-ink' : 'text-ink'}`}>{r.topic}</div>
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
                <div className="room-list-summary truncate text-[12px] text-ink-faint">
                  {r.participantsHere ?? r.participants} here
                  {typeof r.messageCount === 'number' ? ` · ${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}` : ''}
                  {r.status === 'ended' ? ' · ended' : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Long-press / right-click room controls — the same shared menu as
          Home's cards (Open · People · invite link · room type · archive…). */}
      {menu && (
        <RoomContextMenu
          menu={menu}
          selfName={selfName}
          onClose={closeMenu}
          onChanged={() => { void pull(); }}
        />
      )}

      {/* Right-edge resize handle (drag to resize, double-click to reset). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize rooms list"
        onPointerDown={(e) => {
          draggingRef.current = true;
          document.body.style.userSelect = 'none';
          (e.currentTarget as HTMLElement).classList.add('dragging');
        }}
        onPointerUp={(e) => (e.currentTarget as HTMLElement).classList.remove('dragging')}
        onDoubleClick={() => { setWidth(340); try { localStorage.setItem('roomlist:width', '340'); } catch { /* ignore */ } }}
        className="pane-resize-handle absolute -right-1 top-0 z-20 h-full w-2"
      />
    </aside>
  );
}
