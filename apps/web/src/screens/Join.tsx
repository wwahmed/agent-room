import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { createClient, getRoom, joinRoom, RoomNotFoundError } from '@agent-room/upstash-client';
import type { Room } from '@agent-room/shared';
import { isValidCode, CODE_LEN } from '@agent-room/shared';
import { ENV } from '../env.js';
import { CodeInput } from '../components/CodeInput.js';
import { colorForName, initialsFor } from '../lib/colors.js';

function stripDashes(s: string) { return s.replace(/-/g, ''); }
function withDashes(s: string) { return s.match(/.{1,3}/g)?.join('-') ?? s; }

export function Join() {
  const { code: codeParam = '' } = useParams();
  const navigate = useNavigate();
  const [raw, setRaw] = useState(stripDashes(codeParam));
  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (raw.length !== CODE_LEN) { setRoom(null); return; }
    const dashed = withDashes(raw);
    if (!isValidCode(dashed)) { setErr('Invalid code'); return; }
    setErr(null);
    const client = createClient(ENV.upstash);
    getRoom(client, dashed)
      .then(setRoom)
      .catch(e => setErr(e instanceof RoomNotFoundError ? 'Room not found' : String(e)));
  }, [raw]);

  async function join() {
    if (!room || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const client = createClient(ENV.upstash);
      const participant = {
        name: name.trim(),
        role: role.trim(),
        color: colorForName(name.trim()),
        initials: initialsFor(name.trim()),
        client: 'web' as const,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      await joinRoom(client, room.code, participant);
      sessionStorage.setItem(`room:${room.code}:self`, JSON.stringify({ name: name.trim(), role: role.trim() }));
      navigate(`/r/${room.code}`);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-8 bg-surface border border-border rounded-xl shadow-card">
      <h1 className="text-lg font-semibold tracking-tight">Join a meeting</h1>
      <p className="text-xs text-ink-soft mt-1 mb-6">Enter the 9-character code from your invite.</p>

      <div className="mb-4">
        <CodeInput value={raw} onChange={setRaw} />
      </div>

      {err && <div className="text-xs text-red-600 mb-3">{err}</div>}

      {room && (
        <>
          <div className="bg-surface-soft border border-border-faint rounded-lg p-3 mb-4 flex gap-2 items-center">
            <div className="w-7 h-7 rounded-md bg-accent-tint text-accent flex items-center justify-center text-sm">◇</div>
            <div>
              <div className="text-xs font-semibold">{room.topic}</div>
              <div className="text-[9px] text-ink-soft">Hosted by {room.createdBy} · {room.participants.length} here</div>
            </div>
          </div>

          <label className="block mb-3">
            <span className="text-[11px] font-semibold text-ink-muted block mb-1">Your name</span>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none text-sm focus:border-accent focus:ring-4 focus:ring-accent-tint" />
          </label>
          <label className="block mb-5">
            <span className="text-[11px] font-semibold text-ink-muted block mb-1">Your role <span className="text-ink-faint font-medium">optional</span></span>
            <input value={role} onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none text-sm focus:border-accent focus:ring-4 focus:ring-accent-tint" />
          </label>

          <button disabled={busy} onClick={join} className="w-full bg-accent text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Joining…' : 'Join meeting →'}
          </button>
        </>
      )}
    </div>
  );
}
