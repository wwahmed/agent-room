import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/relativeTime.js';
import { RoomBadges } from './RoomBadges.js';
import { RoomIdentitySlot } from './RoomIdentitySlot.js';
import {
  createClient, archiveRoomAction, listSummonedAgents, dismissSummonedAgent,
} from '../lib/api.js';

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
  agents?: Array<{ name: string; color: string; initials: string; harness?: string; state: 'listening' | 'online' | 'stale' | 'disconnected' }>;
}

export function RoomListPane({ activeCode, selfName }: { activeCode: string; selfName: string }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [menu, setMenu] = useState<{ code: string; topic: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useRef(createClient()).current;
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

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', close); };
  }, [menu]);

  async function handleArchive(code: string) {
    setBusy(true);
    setMenu(null);
    try {
      // Offer to stop + archive any live summoned agents attached to this room.
      let agentIds: string[] = [];
      try {
        agentIds = (await listSummonedAgents())
          .filter((a) => a.room === code && a.status === 'active')
          .map((a) => a.agentId);
      } catch { /* summoner may be down; archive the room anyway */ }
      if (agentIds.length > 0) {
        const ok = window.confirm(`Also stop & archive ${agentIds.length} agent(s) attached to this room?`);
        if (ok) {
          for (const id of agentIds) { try { await dismissSummonedAgent(id, true); } catch { /* best-effort */ } }
        }
      }
      await archiveRoomAction(client, code);
      setRooms((prev) => (prev ? prev.filter((r) => r.code !== code) : prev));
    } catch (e) {
      window.alert(`Could not archive: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const visible = (rooms ?? []).filter((r) => !r.archived);
  if (!rooms || visible.length === 0) return null;

  return (
    <aside ref={asideRef} style={{ width }} className="relative hidden h-full flex-shrink-0 flex-col border-r border-border-faint bg-surface xl:flex" data-room-list-width="resizable">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 modern-scrollbar">
        <div className="flex h-8 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          Rooms
        </div>
        {visible.map(r => {
          const active = r.code === activeCode;
          // T-34: stretched-link row — the overlay Link opens the chat, the
          // compact facepile is a sibling button (z-10) that opens People.
          return (
            <div
              key={r.code}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ code: r.code, topic: r.topic, x: e.clientX, y: e.clientY }); }}
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
                  <div className={`room-list-title min-w-0 flex-1 truncate text-[14px] leading-snug ${active ? 'text-accent' : 'text-ink'}`}>{r.topic}</div>
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
                  {r.participants} here
                  {typeof r.messageCount === 'number' ? ` · ${r.messageCount} msg${r.messageCount === 1 ? '' : 's'}` : ''}
                  {r.status === 'ended' ? ' · ended' : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right-click room controls */}
      {menu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl"
          style={{ top: Math.min(menu.y, window.innerHeight - 120), left: Math.min(menu.x, window.innerWidth - 200) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="truncate px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{menu.topic}</div>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void handleArchive(menu.code)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-ink-soft transition hover:bg-surface-softer hover:text-ink disabled:opacity-50"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="3" rx="0.5" /><path d="M3 6v6.5A1 1 0 0 0 4 13.5h8a1 1 0 0 0 1-1V6M6.5 9h3" />
            </svg>
            {busy ? 'Archiving…' : 'Archive room'}
          </button>
        </div>
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
