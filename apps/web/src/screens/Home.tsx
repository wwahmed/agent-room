import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { isValidCode } from '@agent-room/shared';
import { AgentRoomLogo } from '../components/AgentRoomLogo.js';
import { InstallPrompt } from '../components/InstallPrompt.js';
import { fetchIdentity, fetchRooms, type RoomSummary, type WhoAmI } from '../lib/identity.js';
import { initialsFor, colorForName } from '../lib/colors.js';

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

// Waki Chat's front door. Authenticated (Google via Cloudflare Access):
// account chip, rooms front and center, install card. Anonymous (localhost
// or logged-out edge case): a Sign in with Google state — reloading the
// protected origin lets Access run the Google flow.
export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchIdentity();
      if (cancelled) return;
      setIdentity(me);
      setChecked(true);
      if (!me) return;
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
    <div className="min-h-screen bg-surface-sunken text-ink">
      {/* Brand header with account state */}
      <header className="border-b border-border-faint bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <AgentRoomLogo showWordmark={false} markClassName="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight">Waki Chat</span>
          </div>
          {identity ? (
            <div className="flex items-center gap-2">
              <div className="flex min-h-11 items-center gap-2 rounded-full border border-border-faint bg-surface-softer py-1 pl-1.5 pr-3">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: colorForName(identity.name) }}
                >
                  {initialsFor(identity.name)}
                </span>
                <span className="text-sm font-semibold">{identity.name}</span>
              </div>
              <a
                href="/cdn-cgi/access/logout"
                className="flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-ink-soft transition hover:text-ink"
              >
                Log out
              </a>
            </div>
          ) : checked ? (
            <button
              onClick={() => window.location.reload()}
              className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-softer border border-border px-4 text-sm font-semibold transition hover:border-accent"
            >
              <span className="text-base font-bold text-accent">G</span>
              Sign in with Google
            </button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {identity ? (
          <p className="text-sm text-ink-soft">
            Welcome back, <span className="font-semibold text-ink">{identity.name}</span>.
          </p>
        ) : checked ? (
          <div className="rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
            <AgentRoomLogo markClassName="mx-auto h-12 w-12" showWordmark={false} />
            <h1 className="mt-4 text-xl font-bold">Waki Chat</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
              Private rooms for Waqas, Claude, and Codex. Sign in with Google to enter.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-bold text-white transition hover:opacity-90"
            >
              Sign in with Google
            </button>
          </div>
        ) : null}

        {identity && activeRooms.length > 0 && (
          <section className="mt-5 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Your rooms</h2>
            {activeRooms.map(r => (
              <button
                key={r.code}
                onClick={() => navigate(`/r/${r.code}`)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-faint bg-surface px-4 py-3.5 text-left shadow-card transition hover:border-accent-tint-border hover:bg-accent-tint"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent-tint text-accent">◇</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{r.topic}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {r.participants} here · {timeAgo(r.createdAt)}
                  </div>
                </div>
                <span className="flex-shrink-0 text-sm font-semibold text-accent">Enter →</span>
              </button>
            ))}
          </section>
        )}

        {identity && endedRooms.length > 0 && (
          <section className="mt-4 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Recently ended</h2>
            {endedRooms.map(r => (
              <button
                key={r.code}
                onClick={() => navigate(`/r/${r.code}`)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-faint bg-surface-softer px-4 py-2.5 text-left opacity-70 transition hover:opacity-100"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.topic}</div>
                  <div className="text-xs text-ink-soft">ended · {timeAgo(r.createdAt)}</div>
                </div>
              </button>
            ))}
          </section>
        )}

        {identity && (
          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link
              to="/new"
              className="flex min-h-14 items-center justify-center rounded-xl bg-accent px-5 text-base font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              + New room
            </Link>
            <div className="rounded-xl border border-border-faint bg-surface p-3 shadow-card">
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase()); if (err) setErr(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
                  placeholder="Join with code…"
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface-softer px-3 font-mono text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
                />
                <button
                  onClick={go}
                  className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-surface-sunken transition hover:opacity-90"
                >
                  Join
                </button>
              </div>
              {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
            </div>
          </section>
        )}

        <InstallPrompt />
      </main>
    </div>
  );
}
