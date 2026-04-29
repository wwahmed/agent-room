import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClient, createRoom } from '@agent-room/upstash-client';
import { generateCode, ROLE_PRESETS } from '@agent-room/shared';
import { ENV } from '../env.js';

export function CreateMeeting() {
  const [topic, setTopic] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!topic.trim() || !name.trim()) return;
    setBusy(true); setError(null);
    try {
      const client = createClient(ENV.upstash);
      const code = generateCode();
      await createRoom(client, { code, topic: topic.trim(), createdBy: name.trim() });
      sessionStorage.setItem(`room:${code}:self`, JSON.stringify({ name: name.trim(), role: role.trim() }));
      navigate(`/r/${code}/lobby`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md mx-auto mt-24 p-8 bg-surface border border-border rounded-xl shadow-card">
      <h1 className="text-lg font-semibold tracking-tight">New meeting</h1>
      <p className="text-xs text-ink-soft mt-1 mb-6">Start a room and invite others with the code.</p>

      {error && <div className="text-[11px] text-red-600 mb-3">{error}</div>}

      <label className="block mb-4">
        <span className="text-xs font-semibold text-ink-muted block mb-1.5">Topic</span>
        <input value={topic} onChange={e => setTopic(e.target.value)} required
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none text-sm focus:border-accent focus:ring-4 focus:ring-accent-tint" />
      </label>
      <label className="block mb-4">
        <span className="text-xs font-semibold text-ink-muted block mb-1.5">Your name</span>
        <input value={name} onChange={e => setName(e.target.value)} required
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none text-sm focus:border-accent focus:ring-4 focus:ring-accent-tint" />
      </label>
      <label className="block mb-6">
        <span className="text-xs font-semibold text-ink-muted block mb-1.5">Your role <span className="text-ink-faint font-medium">optional</span></span>
        <select
          value={ROLE_PRESETS.some(p => p.role === role) ? role : ''}
          onChange={e => setRole(e.target.value)}
          className="w-full mb-2 px-3 py-2 bg-surface border border-border rounded-lg outline-none text-sm focus:border-accent focus:ring-4 focus:ring-accent-tint"
        >
          <option value="">Custom role</option>
          {ROLE_PRESETS.map(p => <option key={p.id} value={p.role}>{p.label}</option>)}
        </select>
        <input value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Frontend"
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg outline-none text-sm focus:border-accent focus:ring-4 focus:ring-accent-tint" />
      </label>

      <button disabled={busy} type="submit" className="w-full bg-accent text-white py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50">
        {busy ? 'Creating…' : 'Create meeting →'}
      </button>
    </form>
  );
}
