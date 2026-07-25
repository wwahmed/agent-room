import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidCode } from '@agent-room/shared';
import { InstallPrompt } from '../components/InstallPrompt.js';
import { fetchIdentity, fetchRooms, mergeRoomPages, type RoomSummary, type WhoAmI } from '../lib/identity.js';
import { AccountMenu } from '../components/AccountMenu.js';
import { RoomBadges } from '../components/RoomBadges.js';
import { RoomIdentitySlot } from '../components/RoomIdentitySlot.js';
import { splitRooms } from '../lib/roomSections.js';
import { ROOM_SORTS, ROOM_SORT_STORAGE_KEY, isRoomSort, resolveRoomSort, sortRooms, type RoomSort } from '../lib/roomSort.js';
import { useLiveRooms } from '../hooks/useLiveRooms.js';
import { createClient, unarchiveRoomAction } from '../lib/api.js';

function normalize(raw: string): string {
  const bare = raw.replace(/-/g, '').trim().toUpperCase();
  if (bare.length !== 9) return raw.trim().toUpperCase();
  return `${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6)}`;
}

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

// WakiChat's front door. Authenticated (Google via Cloudflare Access):
// account chip, rooms front and center, install card. Anonymous (localhost
// or logged-out edge case): a Sign in with Google state — reloading the
// protected origin lets Access run the Google flow.
export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [nextRoomCursor, setNextRoomCursor] = useState<string | null>(null);
  const [loadingMoreRooms, setLoadingMoreRooms] = useState(false);
  const loadingMoreRef = useRef(false);
  const roomListEndRef = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(false);
  // T-40: Active is the default view; Ended renders only when selected.
  const [view, setView] = useState<'active' | 'ended' | 'archived'>('active');
  const homeClient = useRef(createClient()).current;
  async function handleUnarchive(code: string) {
    try { await unarchiveRoomAction(homeClient, code); window.location.reload(); }
    catch (e) { window.alert(`Could not unarchive: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const [showTestRooms, setShowTestRooms] = useState(false);
  // T-26/T-27: sort applies at render over the MERGED pages, so the chosen
  // order survives paging by construction. Latest activity is the default.
  const [roomSort, setRoomSort] = useState<RoomSort>(() => {
    try { return resolveRoomSort(localStorage.getItem(ROOM_SORT_STORAGE_KEY)); } catch { return resolveRoomSort(null); }
  });
  function changeRoomSort(value: string) {
    if (!isRoomSort(value)) return;
    setRoomSort(value);
    try { localStorage.setItem(ROOM_SORT_STORAGE_KEY, value); } catch { /* session-only */ }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchIdentity();
      if (cancelled) return;
      setIdentity(me);
      setChecked(true);
      if (!me) { setRoomsLoading(false); return; }
      const page = await fetchRooms();
      if (!cancelled) {
        setRooms(page.rooms);
        setNextRoomCursor(page.nextCursor);
        setRoomsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // T-75: Home is a LIVE surface — rooms created on another device appear,
  // activity re-sorts and updates badges, ended rooms leave Active, all with
  // no reload. The hook polls the first page and merges over the loaded set
  // (deeper pages survive the merge by construction), holds re-sorts while a
  // pointer is down, and pauses entirely while the tab is hidden.
  useLiveRooms(identity != null, useCallback((incoming: RoomSummary[]) => {
    setRooms(current => mergeRoomPages(current, incoming));
  }, []));

  const loadMoreRooms = useCallback(async () => {
    if (!nextRoomCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMoreRooms(true);
    try {
      const page = await fetchRooms(nextRoomCursor);
      setRooms(current => mergeRoomPages(current, page.rooms));
      setNextRoomCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMoreRooms(false);
    }
  }, [nextRoomCursor]);

  useEffect(() => {
    const target = roomListEndRef.current;
    if (!target || !nextRoomCursor || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) void loadMoreRooms(); },
      { rootMargin: '400px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMoreRooms, nextRoomCursor]);

  function go() {
    const normalized = normalize(code);
    if (isValidCode(normalized)) {
      setErr(null);
      navigate(`/j/${normalized}`);
    } else {
      setErr('Invalid code');
    }
  }

  // T-40: Active/Ended sections with auto-test rooms collapsed out of the way.
  // T-26/T-27: every section renders through the same selected sort.
  const sections = splitRooms(rooms);
  const activeRooms = sortRooms(sections.active, roomSort);
  const endedRooms = sortRooms(sections.ended, roomSort);
  const testRooms = sortRooms(view === 'active' ? sections.activeTest : view === 'ended' ? sections.endedTest : [], roomSort);
  const archivedRooms = sortRooms(sections.archived, roomSort);
  const roomTabs: Array<['active' | 'ended' | 'archived', string, number]> = [
    ['active', 'Active', activeRooms.length + sections.activeTest.length],
    ['ended', 'Ended', endedRooms.length + sections.endedTest.length],
  ];
  if (archivedRooms.length > 0) roomTabs.push(['archived', 'Archived', archivedRooms.length]);
  // T-40 R2: a segment whose rows are ALL collapsed must say so explicitly —
  // "Ended 6" showing an empty list reads as broken, not filtered.
  const realRowCount = view === 'active' ? activeRooms.length : endedRooms.length;
  const allCollapsed = realRowCount === 0 && testRooms.length > 0;

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      {/* Brand header with account state. T-46: the sanctioned brand wash —
          quiet radial accent behind the mark, glow on the TILE only. */}
      <header className="header-brand-wash border-b border-border-subtle">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-8 w-8 rounded-lg shadow-[0_0_12px_rgb(var(--accent)/0.35)]" />
            <span className="text-lg font-bold tracking-tight">WakiChat</span>
          </div>
          {identity ? (
            /* T-26/T-27: the avatar IS the account surface — identity, theme,
               reading scale, and Log out live in its menu, not loose chrome.
               Settings routes to the app-level /settings page. */
            <AccountMenu name={identity.name} email={identity.email} onOpenSettings={() => navigate('/settings')} />
          ) : checked ? (
            <a
              href="/login"
              className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-softer border border-border px-4 text-sm font-semibold transition hover:border-accent"
            >
              <span className="text-base font-bold text-accent">G</span>
              Sign in with Google
            </a>
          ) : null}
        </div>
      </header>

      {/* T-40: bottom padding clears the mobile sticky action bar. */}
      <main className="mx-auto max-w-3xl px-4 py-6 pb-28 sm:px-6 sm:py-10">
        {identity ? (
          <p className="text-sm text-ink-soft">
            Welcome back, <span className="font-semibold text-ink">{identity.name}</span>.
          </p>
        ) : checked ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="mx-auto h-12 w-12" />
            <h1 className="mt-4 text-xl font-bold">WakiChat</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
              Private rooms for Waqas, Claude, and Codex. Sign in with Google to enter.
            </p>
            <a
              href="/login"
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-bold text-white transition hover:opacity-90"
            >
              Sign in with Google
            </a>
          </div>
        ) : null}

        {identity && roomsLoading && (
          <div
            role="status"
            aria-live="polite"
            className="mt-5 flex min-h-24 items-center gap-4 rounded-2xl border border-accent-tint-border bg-surface px-5 py-4 shadow-card"
          >
            <span className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center" aria-hidden="true">
              <span className="absolute inset-0 animate-pulse rounded-full bg-accent-tint motion-reduce:animate-none" />
              <span className="relative h-7 w-7 animate-spin rounded-full border-[3px] border-accent/20 border-t-accent motion-reduce:animate-none" />
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-ink">Loading your latest rooms</span>
              <span className="mt-0.5 block text-sm text-ink-soft">Syncing activity and unread state…</span>
            </span>
          </div>
        )}

        {/* T-40: primary actions live at the top on desktop (this block) and in
            the sticky thumb-zone bar on mobile (below). One markup source each;
            visibility is width-gated. */}
        {identity && !roomsLoading && (
          <section className="mt-5 hidden gap-3 sm:grid sm:grid-cols-2">
            <Link
              to="/new"
              className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              + New room
            </Link>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); if (err) setErr(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
                placeholder="Join with code…"
                aria-label="Join with code"
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
              />
              <button
                onClick={go}
                className="min-h-12 rounded-xl bg-ink px-4 text-sm font-semibold text-surface-sunken transition hover:opacity-90"
              >
                Join
              </button>
            </div>
            {err && <div className="col-span-full text-xs text-red-400">{err}</div>}
          </section>
        )}

        {/* T-40: Active/Ended segmented control with counts. Ended is lazy —
            its cards only render when the segment is selected. */}
        {identity && !roomsLoading && rooms.length > 0 && (
          <div className="mt-5 flex items-center gap-2">
            <div role="tablist" aria-label="Room lists" className="flex flex-1 rounded-xl bg-surface-softer p-1">
              {roomTabs.map(([key, label, count]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => { setView(key); setShowTestRooms(false); }}
                  // Type-floor gate finding: role=tab reads 16px on phones.
                  className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-[16px] font-semibold transition sm:text-sm ${
                    view === key ? 'bg-surface text-ink shadow-card' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {label}
                  <span className="tabular-nums text-ink-faint">{count}</span>
                </button>
              ))}
            </div>
            {/* T-26/T-27: order control beside the segments — a native select
                keeps it one 44px target on phones. */}
            <select
              value={roomSort}
              onChange={e => changeRoomSort(e.target.value)}
              aria-label="Sort rooms"
              className="min-h-11 flex-shrink-0 rounded-xl border border-border-faint bg-surface-softer px-2.5 text-[16px] font-semibold text-ink-soft outline-none transition focus:border-accent sm:text-sm"
            >
              {ROOM_SORTS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}

        {identity && view === 'active' && activeRooms.length > 0 && (
          <section className="mt-3 space-y-2">
            {activeRooms.map(r => {
              // The card used to age off createdAt, so a room that had been busy
              // all day still read "21h ago" — that's the room's birthday, not its
              // last update. lastActivityAt is the one the host actually wants.
              const updatedAt = r.lastActivityAt ?? r.createdAt;
              // T-34: stretched-link card. The whole row opens the chat via the
              // absolutely-positioned Link overlay; the facepile is a SIBLING
              // button layered above it (z-10) that opens People — no nested
              // interactive elements, and keyboard order is chat then People.
              const agentCount = r.agentCount ?? 0;
              return (
                <div
                  key={r.code}
                  className="room-list-row relative flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-faint bg-surface px-4 py-3.5 text-left shadow-card transition hover:border-accent-tint-border hover:bg-accent-tint focus-within:border-accent-tint-border"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '72px' }}
                >
                  <Link
                    to={`/r/${r.code}`}
                    aria-label={`Open ${r.topic}`}
                    className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent-tint"
                  />
                  {/* T-55: the same left identity slot is used by the in-room
                      desktop list, preventing cross-surface side drift. */}
                  <RoomIdentitySlot
                    code={r.code}
                    agentCount={agentCount}
                    agentStaleCount={r.agentStaleCount ?? (r.agentsAllHealthy === false ? agentCount : 0)}
                    agents={r.agents ?? []}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="room-list-title truncate text-[15px]">{r.topic}</div>
                    <div className="room-list-summary mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
                      <span className="truncate">{r.participants} here · updated {timeAgo(updatedAt)}</span>
                    </div>
                  </div>
                  {/* T-18/T-20: attention badges only — @mentions + refined unread. */}
                  <RoomBadges
                    code={r.code}
                    messageCount={r.messageCount}
                    selfName={identity.name}
                  />
                  {/* T-40 R1: the whole card is the link; a quiet chevron is the
                      only affordance. Accent stays reserved for attention. */}
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-ink-faint">
                    <path d="m6 3.5 5 4.5-5 4.5" />
                  </svg>
                </div>
              );
            })}
          </section>
        )}

        {identity && view === 'active' && !roomsLoading && activeRooms.length === 0 && sections.activeTest.length === 0 && (
          <div className="mt-3 rounded-xl border border-border-faint bg-surface p-5 text-sm text-ink-soft">
            No active rooms. Start one with <span className="font-semibold text-ink">+ New room</span>.
          </div>
        )}

        {identity && view === 'ended' && (
          <section className="mt-3 space-y-2">
            {endedRooms.length === 0 && sections.endedTest.length === 0 && (
              <div className="rounded-xl border border-border-faint bg-surface p-5 text-sm text-ink-soft">Nothing has ended yet.</div>
            )}
            {endedRooms.map(r => (
              <button
                key={r.code}
                onClick={() => navigate(`/r/${r.code}`)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-faint bg-surface-softer px-4 py-2.5 text-left opacity-70 transition hover:opacity-100"
                style={{ contentVisibility: 'auto', containIntrinsicSize: '58px' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.topic}</div>
                  <div className="text-xs text-ink-soft">ended · {timeAgo(r.createdAt)}</div>
                </div>
              </button>
            ))}
          </section>
        )}

        {identity && view === 'archived' && (
          <section className="mt-3 space-y-2">
            {archivedRooms.length === 0 && (
              <div className="rounded-xl border border-border-faint bg-surface p-5 text-sm text-ink-soft">No archived rooms.</div>
            )}
            {archivedRooms.map(r => (
              <div key={r.code} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-faint bg-surface-softer px-4 py-2.5">
                <button
                  onClick={() => navigate(`/r/${r.code}`)}
                  className="min-w-0 flex-1 text-left opacity-70 transition hover:opacity-100"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '58px' }}
                >
                  <div className="truncate text-sm font-medium">{r.topic}</div>
                  <div className="text-xs text-ink-soft">archived · {timeAgo(r.createdAt)}</div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleUnarchive(r.code)}
                  className="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10"
                >
                  Unarchive
                </button>
              </div>
            ))}
          </section>
        )}

        {/* T-40 R2: when EVERY row in the segment is a collapsed test room, say
            so explicitly — the count promised items, so the screen must explain
            where they are and offer them in one tap. */}
        {identity && allCollapsed && !showTestRooms && (
          <div className="mt-3 flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border-faint bg-surface p-4">
            <span className="text-sm text-ink-soft">
              All {testRooms.length} {view} room{testRooms.length === 1 ? ' is an' : 's are'} auto-test room{testRooms.length === 1 ? '' : 's'}.
            </span>
            <button
              type="button"
              onClick={() => setShowTestRooms(true)}
              className="min-h-11 flex-shrink-0 rounded-lg px-3 text-sm font-semibold text-ink-soft transition hover:bg-surface-softer hover:text-ink"
            >
              Show them
            </button>
          </div>
        )}

        {/* T-40: convention-named auto-test rooms collapse into one quiet row
            per segment instead of burying real work. */}
        {identity && testRooms.length > 0 && !(allCollapsed && !showTestRooms) && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowTestRooms(v => !v)}
              aria-expanded={showTestRooms}
              className="flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-xs font-semibold text-ink-faint transition hover:bg-surface-softer hover:text-ink-soft"
            >
              <span>{testRooms.length} test room{testRooms.length === 1 ? '' : 's'} hidden</span>
              <span>{showTestRooms ? 'Hide' : 'Show'}</span>
            </button>
            {showTestRooms && testRooms.map(r => (
              <button
                key={r.code}
                onClick={() => navigate(`/r/${r.code}`)}
                className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-faint bg-surface-softer px-4 py-2 text-left opacity-60 transition hover:opacity-100"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{r.topic}</div>
                  <div className="text-xs text-ink-faint">{r.status === 'active' ? `${r.participants} here` : 'ended'} · {timeAgo(r.lastActivityAt ?? r.createdAt)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {identity && nextRoomCursor && (
          <div ref={roomListEndRef} className="flex min-h-16 items-center justify-center py-3">
            <button
              type="button"
              onClick={() => { void loadMoreRooms(); }}
              disabled={loadingMoreRooms}
              className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                {loadingMoreRooms && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/25 border-t-accent motion-reduce:animate-none" aria-hidden="true" />
                )}
                {loadingMoreRooms ? 'Loading older rooms…' : 'Load older rooms'}
              </span>
            </button>
          </div>
        )}

        <InstallPrompt />

        {/* T-40: mobile sticky action bar in the thumb zone. Desktop gets the
            same actions at the top of the list instead. */}
        {identity && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border-faint bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:hidden">
            <div className="mx-auto flex max-w-3xl gap-2">
              <Link
                to="/new"
                className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                + New room
              </Link>
              <input
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); if (err) setErr(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
                placeholder="Join code…"
                aria-label="Join with code"
                className="min-h-12 w-32 min-w-0 rounded-xl border border-border bg-surface-softer px-3 font-mono text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
              />
              <button
                onClick={go}
                className="min-h-12 rounded-xl bg-ink px-4 text-sm font-semibold text-surface-sunken transition hover:opacity-90"
              >
                Join
              </button>
            </div>
            {err && <div className="mx-auto mt-1.5 max-w-3xl text-xs text-red-400">{err}</div>}
          </div>
        )}
      </main>
    </div>
  );
}
