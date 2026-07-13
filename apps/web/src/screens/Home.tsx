import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { isValidCode } from '@agent-room/shared';
import { AgentRoomLogo } from '../components/AgentRoomLogo.js';
import { TopNav } from '../components/TopNav.js';
import { fetchIdentity, fetchRooms, type RoomSummary, type WhoAmI } from '../lib/identity.js';
import { InstallPrompt } from '../components/InstallPrompt.js';

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

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);

  // Authenticated owner (Cloudflare Access) gets a one-tap room list — no
  // code typing, no name entry (Room auto-joins with the same identity).
  // Anonymous visitors see only the classic create/join card.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchIdentity();
      if (cancelled || !me) return;
      setIdentity(me);
      const list = await fetchRooms();
      if (!cancelled) setRooms(list);
    })();
    return () => { cancelled = true; };
  }, []);

  function go() {
    const normalized = normalize(code);
    if (isValidCode(normalized)) {
      setErr(null);
      navigate(`/j/${normalized}`);
    } else {
      setErr('Invalid code');
    }
  }

  const activeRooms = rooms.filter(r => r.status === 'active');
  const endedRooms = rooms.filter(r => r.status !== 'active');

  return (
    <div className="min-h-screen bg-surface-soft text-ink">
      <TopNav />
      <main className="mx-auto flex min-h-[calc(100vh-64px)] max-w-3xl items-center px-6 py-10">
        <section className="w-full rounded-2xl border border-border bg-surface p-6 shadow-card sm:p-8">
          <AgentRoomLogo markClassName="h-10 w-10" wordmarkClassName="text-2xl" />
          {identity && (
            <p className="mt-3 flex items-center justify-between gap-3 text-sm text-ink-soft">
              <span>
                Welcome back, <span className="font-semibold text-ink">{identity.name}</span>. Tap a room to jump in.
              </span>
              <a
                href="/cdn-cgi/access/logout"
                className="flex-shrink-0 rounded-lg border border-border-faint px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-border hover:text-ink"
              >
                Log out
              </a>
            </p>
          )}

          {identity && activeRooms.length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Active rooms</div>
              {activeRooms.map(r => (
                <button
                  key={r.code}
                  onClick={() => navigate(`/r/${r.code}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border-faint bg-surface-softer px-4 py-3 text-left transition hover:border-accent-tint-border hover:bg-accent-tint"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent">◇</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{r.topic}</div>
                    <div className="text-xs text-ink-soft">
                      {r.participants} here · hosted by {r.createdBy} · {timeAgo(r.createdAt)}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-accent">Enter →</span>
                </button>
              ))}
            </div>
          )}

          {identity && endedRooms.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Ended (reactivatable for 24h)</div>
              {endedRooms.map(r => (
                <button
                  key={r.code}
                  onClick={() => navigate(`/r/${r.code}`)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border-faint bg-surface-softer px-4 py-2.5 text-left opacity-70 transition hover:opacity-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.topic}</div>
                    <div className="text-xs text-ink-soft">ended · {timeAgo(r.createdAt)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <InstallPrompt />

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Link
              to="/new"
              className="flex min-h-28 items-center justify-center rounded-xl bg-accent px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              Create room
            </Link>
            <div className="rounded-xl border border-border-faint bg-surface-softer p-4">
              <label className="mb-2 block text-xs font-semibold text-ink-muted">Join with room code</label>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase()); if (err) setErr(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
                  placeholder="ABC-DEF-GHJ"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 font-mono text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
                />
                <button
                  onClick={go}
                  className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface-sunken transition hover:opacity-90"
                >
                  Join
                </button>
              </div>
              {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
