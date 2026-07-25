import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { createClient, getRoom, joinRoom, verifyHostKey, HostNameTakenError, RoomNotFoundError } from '../lib/api.js';
import type { Room } from '@agent-room/shared';
import { isValidCode, canonicalizeCode, ROLE_PRESETS } from '@agent-room/shared';
import { CodeInput } from '../components/CodeInput.js';
import { AgentRoomLogo } from '../components/AgentRoomLogo.js';
import { AgentJoinQuickstart } from '../components/AgentJoinQuickstart.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import { fetchIdentity, lastRole, rememberRole } from '../lib/identity.js';

export function Join() {
  const { code: codeParam = '' } = useParams();
  const navigate = useNavigate();
  // T-47: free-text code (word or legacy) — the shared parser handles shape,
  // case, and separators, so we no longer strip/re-segment here.
  const [raw, setRaw] = useState(codeParam);
  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill from the Access-authenticated identity so the owner never
  // types name/role even when landing on the Join form directly.
  useEffect(() => {
    let cancelled = false;
    fetchIdentity().then(me => {
      if (cancelled || !me) return;
      setName(prev => prev || me.name);
      setRole(prev => prev || me.role || lastRole());
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const canonical = isValidCode(raw) ? canonicalizeCode(raw) : null;
    if (!canonical) {
      setRoom(null);
      // Only nag once they've typed enough to plausibly be a code.
      setErr(raw.trim().length >= 5 ? 'Invalid code' : null);
      return;
    }
    setErr(null);
    const client = createClient();
    getRoom(client, canonical)
      .then(setRoom)
      .catch(e => setErr(e instanceof RoomNotFoundError ? 'Room not found' : String(e)));
  }, [raw]);

  async function join() {
    if (!room || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const client = createClient();
      const trimmed = name.trim();
      // Host-name lock: claiming the host's display name requires the host
      // key (set on createRoom). Without it we throw before sending join.
      if (trimmed === room.createdBy) {
        // Read from localStorage (survives tab close, scoped to this room
        // and bounded by the same 24h TTL on the server) with a session-
        // Storage fallback for hosts whose key landed there before this
        // change.
        const hostKey = localStorage.getItem(`room:${room.code}:hostKey`)
          ?? sessionStorage.getItem(`room:${room.code}:hostKey`)
          ?? undefined;
        await verifyHostKey(client, room.code, hostKey);
      }
      const participant = {
        name: trimmed,
        role: role.trim(),
        color: colorForName(trimmed),
        initials: initialsFor(trimmed),
        client: 'web' as const,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      const result = await joinRoom(client, room.code, participant, {
        priorIdentity: { name: trimmed, client: 'web' },
      });
      // joinRoom may have suffixed the name on collision (e.g. "Robin (2)").
      // Persist whatever the server actually assigned so future writes use it.
      const finalName = result.participant.name;
      sessionStorage.setItem(`room:${room.code}:self`, JSON.stringify({ name: finalName, role: role.trim() }));
      rememberRole(role);
      navigate(`/r/${room.code}`);
    } catch (e) {
      if (e instanceof HostNameTakenError) {
        setErr(`The name "${name.trim()}" is reserved for the host of this room. Pick a different display name.`);
      } else {
        setErr(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="bg-surface px-6 py-5">
        <div className="mx-auto max-w-6xl">
          <Link to="/" aria-label="Agent Room home" className="inline-block hover:opacity-85 transition">
            <AgentRoomLogo markClassName="h-7 w-7" wordmarkClassName="text-base" />
          </Link>
        </div>
      </div>
      <div className="max-w-md mx-auto mt-10 p-8 bg-surface border border-border rounded-xl shadow-card">
      <h1 className="text-lg font-semibold tracking-tight">Join a meeting</h1>
      <p className="text-xs text-ink-soft mt-1 mb-6">Enter the room code from your invite.</p>

      <div className="mb-4">
        <CodeInput value={raw} onChange={setRaw} />
      </div>

      {err && <div className="text-xs text-red-600 mb-3">{err}</div>}

      {room && (
        <>
          {/* Who you're joining — the welcome, up top. */}
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-border-faint bg-surface-soft p-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-tint text-lg text-accent">◇</div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-ink">{room.topic}</div>
              <div className="text-[12px] text-ink-soft">Hosted by {room.createdBy} · {room.participants.length} here</div>
            </div>
          </div>

          {/* PRIMARY: join as yourself. */}
          <label className="mb-3 block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-muted">Your name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Your display name"
              onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !busy) void join(); }}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint" />
          </label>
          <label className="mb-5 block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-muted">Your role <span className="font-medium text-ink-faint">optional</span></span>
            <select
              value={ROLE_PRESETS.some(p => p.role === role) ? role : ''}
              onChange={e => setRole(e.target.value)}
              className="mb-2 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
            >
              <option value="">Custom role</option>
              {ROLE_PRESETS.map(p => <option key={p.id} value={p.role}>{p.label}</option>)}
            </select>
            <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Reviewer"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint" />
          </label>

          <button disabled={busy || !name.trim()} onClick={join}
            className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? 'Joining…' : 'Join room →'}
          </button>

          {/* SECONDARY: bringing an AI agent — tucked into a disclosure so the
             human join flow above stays clean, not a wall of setup. */}
          <details className="group mt-5 overflow-hidden rounded-xl border border-border-faint bg-surface-soft/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-[13px] font-semibold text-ink-soft transition hover:text-ink">
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v5M8 7l2.2-1.3M8 7 5.8 5.7" /><circle cx="8" cy="10.5" r="3.2" /></svg>
                Bringing an AI agent instead?
              </span>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="transition group-open:rotate-180" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </summary>
            <div className="border-t border-border-faint px-3.5 py-3.5">
              <AgentJoinQuickstart roomCode={room.code} />
            </div>
          </details>
        </>
      )}
      </div>
    </>
  );
}
