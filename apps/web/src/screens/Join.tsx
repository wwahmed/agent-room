import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { createClient, getRoom, joinRoom, verifyHostKey, HostNameTakenError, RoomNotFoundError } from '../lib/api.js';
import type { Room } from '@agent-room/shared';
import { isValidCode, canonicalizeCode } from '@agent-room/shared';
import { CodeInput } from '../components/CodeInput.js';
import { RolePicker } from '../components/RolePicker.js';
import { AgentJoinQuickstart } from '../components/AgentJoinQuickstart.js';
import { colorForName, initialsFor } from '../lib/colors.js';
import { fetchIdentity, lastRole, rememberRole, type WhoAmI } from '../lib/identity.js';

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
  const [identity, setIdentity] = useState<WhoAmI | null>(null);
  // 'choose' = show Host/Participant choice; the others are the active path.
  const [mode, setMode] = useState<'choose' | 'host' | 'participant'>('choose');

  // Prefill from the Access-authenticated identity so the owner never
  // types name/role even when landing on the Join form directly.
  useEffect(() => {
    let cancelled = false;
    fetchIdentity().then(me => {
      if (cancelled || !me) return;
      setIdentity(me);
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

  // Join as the room's host, verified by your signed-in identity (the server
  // checks your Access email against the room's host, or a stored host key for
  // rooms created on another device / via the API).
  async function joinAsHost() {
    if (!room) return;
    setBusy(true); setErr(null);
    try {
      const client = createClient();
      const hostName = room.createdBy;
      const hostKey = localStorage.getItem(`room:${room.code}:hostKey`)
        ?? sessionStorage.getItem(`room:${room.code}:hostKey`)
        ?? undefined;
      await verifyHostKey(client, room.code, hostKey);
      const participant = {
        name: hostName, role: 'Host', color: colorForName(hostName),
        initials: initialsFor(hostName), client: 'web' as const, joinedAt: Date.now(), lastSeenAt: Date.now(),
      };
      const result = await joinRoom(client, room.code, participant, { priorIdentity: { name: hostName, client: 'web' } });
      sessionStorage.setItem(`room:${room.code}:self`, JSON.stringify(result.participant));
      rememberRole(role);
      navigate(`/r/${room.code}`);
    } catch (e) {
      setErr('Could not verify you as host of this room. If you created it on another device or via the API, seed your host key (or use Join as participant). ' + (e instanceof Error ? '' : String(e)));
    } finally {
      setBusy(false);
    }
  }

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
      sessionStorage.setItem(`room:${room.code}:self`, JSON.stringify(result.participant));
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
          <Link to="/" aria-label="WakiChat home" className="inline-flex items-center gap-2.5 hover:opacity-85 transition">
            <img src="/brand/wakichat/wakichat-icon-192.png" alt="" className="h-7 w-7 rounded-lg" />
            <span className="text-base font-bold tracking-tight text-ink">WakiChat</span>
          </Link>
        </div>
      </div>
      <div className="max-w-md mx-auto mt-10 p-8 bg-surface border border-border rounded-xl shadow-card">
      <h1 className="text-lg font-semibold tracking-tight">Join a room</h1>
      <p className="text-xs text-ink-soft mt-1 mb-6">You're joining an existing room — not creating one.</p>

      <div className="mb-4">
        <CodeInput value={raw} onChange={setRaw} />
      </div>

      {err && <div className="text-xs text-red-600 mb-3">{err}</div>}

      {room && (() => {
        const canHost = !!identity && identity.name === room.createdBy;
        return (
        <>
          {/* Who you're joining — the welcome, up top. */}
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-border-faint bg-surface-soft p-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-tint text-lg text-accent">◇</div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-ink">{room.topic}</div>
              <div className="text-[12px] text-ink-soft">Hosted by {room.createdBy} · {room.participants.length} here</div>
            </div>
          </div>

          {/* Step 1 — pick how you're joining. */}
          {mode === 'choose' && (
            <div className="space-y-2.5">
              {canHost && (
                <button onClick={() => { setErr(null); setMode('host'); }}
                  className="w-full rounded-lg bg-accent px-4 py-3 text-left text-sm font-semibold text-white transition hover:opacity-90">
                  Join as Host
                  <span className="mt-0.5 block text-[11px] font-normal opacity-85">You're signed in as {identity!.name} — the owner of this room</span>
                </button>
              )}
              <button onClick={() => { setErr(null); setMode('participant'); }}
                className={`w-full rounded-lg px-4 py-3 text-left text-sm font-semibold transition ${canHost ? 'border border-border text-ink hover:border-border-strong' : 'bg-accent text-white hover:opacity-90'}`}>
                Join as Participant
                <span className={`mt-0.5 block text-[11px] font-normal ${canHost ? 'text-ink-soft' : 'opacity-85'}`}>Join under a display name of your choosing</span>
              </button>
            </div>
          )}

          {/* Host path — identity-verified, no form. */}
          {mode === 'host' && (
            <div>
              <p className="mb-3 text-[13px] text-ink-soft">Joining as host <span className="font-semibold text-ink">{room.createdBy}</span>, verified by your signed-in identity.</p>
              <button disabled={busy} onClick={joinAsHost}
                className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                {busy ? 'Joining…' : 'Join as Host →'}
              </button>
              <button onClick={() => { setMode('choose'); setErr(null); }} className="mt-2 w-full py-1 text-[12px] text-ink-soft transition hover:text-ink">← Back</button>
            </div>
          )}

          {/* Participant path — pick a display name. */}
          {mode === 'participant' && (
            <div>
              <label className="mb-3 block">
                <span className="mb-1 block text-[12px] font-semibold text-ink-muted">Your name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Your display name"
                  onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !busy) void join(); }}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint" />
              </label>
              <RolePicker
                value={role}
                onChange={setRole}
                className="mb-5"
                fieldClass="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
              />
              <button disabled={busy || !name.trim()} onClick={join}
                className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                {busy ? 'Joining…' : 'Join room →'}
              </button>
              <button onClick={() => { setMode('choose'); setErr(null); }} className="mt-2 w-full py-1 text-[12px] text-ink-soft transition hover:text-ink">← Back</button>
            </div>
          )}

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
        );
      })()}
      </div>
    </>
  );
}
