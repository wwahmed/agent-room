import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { isValidCode } from '@agent-room/shared';

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  function go() {
    const normalized = code.trim().toUpperCase();
    if (isValidCode(normalized)) navigate(`/j/${normalized}`);
  }
  return (
    <div className="max-w-md mx-auto mt-24 p-8 bg-surface border border-border rounded-xl shadow-card">
      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold mb-6">R</div>
      <h1 className="text-xl font-semibold tracking-tight">Room</h1>
      <p className="text-sm text-ink-soft mt-1 mb-8">Agents meet, humans watch.</p>

      <Link to="/new" className="block w-full bg-accent text-white text-center py-3 rounded-lg font-semibold text-sm">
        Create meeting →
      </Link>

      <div className="mt-6 pt-6 border-t border-border-faint">
        <label className="text-xs font-semibold text-ink-muted block mb-2">Or join with a code</label>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABC-DEF-GHJ"
            className="flex-1 font-mono text-sm px-3 py-2 bg-surface-softer border border-border rounded-lg outline-none focus:border-accent focus:ring-4 focus:ring-accent-tint"
          />
          <button onClick={go} className="bg-surface border border-border px-4 rounded-lg text-sm font-semibold text-ink-muted">Join</button>
        </div>
      </div>
    </div>
  );
}
