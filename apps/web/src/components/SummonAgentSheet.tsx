import { useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_MODE_COPY, defaultAgentMode, type AgentMode } from '../lib/agentDefaults.js';
import {
  summonProviders, summonWorkspaces, listSummonedAgents, summonAgent,
  getRoom, setRoomWorkspaceAction, createClient,
  type SummonProvider, type SummonWorkspaceGroup, type SummonedAgent,
} from '../lib/api.js';

interface Props {
  code: string;
  onClose: () => void;
}

const CUSTOM = '__custom__';
const fieldClass = 'w-full min-h-14 rounded-2xl border border-border bg-surface px-4 py-3.5 text-base text-ink sm:min-h-0 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm';
const labelClass = 'mb-2 block text-base font-semibold text-ink sm:mb-1 sm:text-[13px]';

export function SummonAgentSheet({ code, onClose }: Props) {
  const [providers, setProviders] = useState<SummonProvider[]>([]);
  const [groups, setGroups] = useState<SummonWorkspaceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [providerId, setProviderId] = useState('');
  const [modelChoice, setModelChoice] = useState('');   // an id from the list, or CUSTOM
  const [customModel, setCustomModel] = useState('');
  const [workspace, setWorkspace] = useState('');
  // Workspace belongs to the ROOM; the summon inherits it. roomWorkspace is the
  // bound path (null if the room has none yet); overrideWs reveals the picker.
  const [roomWorkspace, setRoomWorkspaceState] = useState<string | null>(null);
  const [overrideWs, setOverrideWs] = useState(false);
  const client = useRef(createClient()).current;
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  // Starts at the owner's configured default (maximum unless he lowered it
  // in Settings), so a summon does not have to be re-permissioned before it
  // can do the work it was summoned for.
  const [mode, setMode] = useState<AgentMode>(defaultAgentMode);
  const [persistent, setPersistent] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSummoned, setJustSummoned] = useState<SummonedAgent | null>(null);
  // Honest confirmation (Waqas: "it just switches screens"): after summoning
  // we POLL until the agent is truly present — its process online AND its name
  // in the room's participants — showing each stage as it completes instead of
  // declaring victory at the API call.
  const [inRoom, setInRoom] = useState(false);

  useEffect(() => {
    if (!justSummoned || inRoom) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const [list, room] = await Promise.all([
            listSummonedAgents(),
            getRoom(client, code).catch(() => null),
          ]);
          const cur = list.find((a) => a.agentId === justSummoned.agentId);
          if (cur) setJustSummoned(cur);
          if (room?.participants.some((p) => p.name === justSummoned.name)) setInRoom(true);
        } catch { /* transient — keep polling */ }
      })();
    }, 2000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSummoned?.agentId, inRoom]);

  const provider = useMemo(() => providers.find((p) => p.id === providerId) || null, [providers, providerId]);

  // Refresh the provider catalog (accounts + live model lists) on demand.
  async function reloadCatalog() {
    setRefreshing(true);
    try {
      const ps = await summonProviders(true);
      setProviders(ps);
      if (!ps.find((p) => p.id === providerId)) {
        const first = ps.find((p) => p.available) || ps[0];
        if (first) { setProviderId(first.id); setModelChoice(first.defaultModel); }
      }
    } finally { setRefreshing(false); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ps, gs, room] = await Promise.all([
        summonProviders(), summonWorkspaces(),
        getRoom(client, code).catch(() => null),
      ]);
      if (!alive) return;
      setProviders(ps);
      setGroups(gs);
      const first = ps.find((p) => p.available) || ps[0];
      if (first) { setProviderId(first.id); setModelChoice(first.defaultModel); }
      const bound = (room && room.workspace) || null;
      setRoomWorkspaceState(bound);
      // Picker defaults to the room's workspace, else the first available one.
      setWorkspace(bound || gs[0]?.items[0]?.path || '');
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the provider changes, reset the model to that provider's default.
  useEffect(() => {
    if (provider) { setModelChoice(provider.defaultModel); setCustomModel(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const resolvedModel = modelChoice === CUSTOM ? customModel.trim() : modelChoice;

  async function onSubmit() {
    setError('');
    if (!provider) { setError('Pick a provider.'); return; }
    if (!provider.available) { setError(`${provider.label} CLI is not installed on this machine.`); return; }
    if (!name.trim()) { setError('Give the agent a display name.'); return; }
    const ws = (roomWorkspace && !overrideWs) ? roomWorkspace : workspace;
    if (!ws) { setError('Pick a workspace.'); return; }
    setBusy(true);
    try {
      // If the room had no workspace, the first summon establishes it on the room.
      if (!roomWorkspace) {
        try { await setRoomWorkspaceAction(client, code, ws); setRoomWorkspaceState(ws); setOverrideWs(false); } catch { /* non-fatal */ }
      }
      const agent = await summonAgent({
        room: code, provider: provider.id, model: resolvedModel,
        workspace: ws, name: name.trim(), role: role.trim(), mode, persistent,
      });
      setInRoom(false);
      setJustSummoned(agent);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-5"
      role="dialog" aria-modal="true" aria-labelledby="summon-title">
      <button type="button" className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close summon dialog" />
      <section className="relative z-10 flex h-[100dvh] max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden border-0 bg-surface shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-2xl sm:border sm:border-border">
        <header className="flex min-h-[72px] items-center justify-between gap-3 border-b border-border-faint px-5 py-4 sm:min-h-0 sm:px-6 sm:py-3">
          <h2 id="summon-title" className="text-2xl font-semibold tracking-tight text-ink sm:text-lg">Summon agent</h2>
          <button type="button" onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full text-ink-soft hover:bg-surface-softer sm:h-11 sm:w-11" aria-label="Close">
            <svg viewBox="0 0 16 16" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        <div className="overflow-y-auto p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-6">
          {loading ? (
            <div className="py-12 text-center text-base text-ink-soft sm:py-10 sm:text-sm">Loading providers &amp; workspaces…</div>
          ) : justSummoned ? (
            /* ---- RESULT step — live progress, not a premature victory screen.
               Three staged checkpoints observed by polling: process spawned →
               process online → actually in the room's People list. ---- */
            <div className="py-2">
              <div className="flex flex-col items-center text-center">
                {inRoom ? (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success text-[22px] font-bold text-white">✓</span>
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-accent/40">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden="true" />
                  </span>
                )}
                <div className="mt-4 text-xl font-semibold text-ink sm:mt-3 sm:text-lg">
                  {inRoom ? `${justSummoned.name} is in the room` : `Summoning ${justSummoned.name}…`}
                </div>
                <div className="mt-1 text-sm text-ink-soft sm:text-[13px]">{justSummoned.provider} / {justSummoned.model || 'account-default'}</div>
              </div>
              <ol className="mx-auto mt-5 w-full max-w-xs space-y-2.5 sm:mt-4 sm:space-y-1.5" data-gate="summon-progress" aria-live="polite">
                {([
                  ['Process started', true],
                  ['Agent running', justSummoned.health === 'online' || inRoom],
                  ['Joined the room', inRoom],
                ] as const).map(([label, done]) => (
                  <li key={label} className="flex items-center gap-3 text-base sm:gap-2.5 sm:text-[13px]">
                    {done
                      ? <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success text-[11px] font-bold text-white">✓</span>
                      : <span className="h-5 w-5 flex-shrink-0 animate-pulse rounded-full border-2 border-border" aria-hidden="true" />}
                    <span className={done ? 'text-ink' : 'text-ink-soft'}>{label}</span>
                  </li>
                ))}
              </ol>
              {justSummoned.health === 'blocked-on-prompt' && (
                <div role="alert" className="mx-auto mt-4 w-full max-w-sm rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-ink-soft sm:mt-3 sm:p-3 sm:text-[13px]">
                  <span className="font-bold text-amber-300">Waiting for your permission</span> — the agent hit a
                  permission dialog while starting. Open People → tap {justSummoned.name} to answer it.
                </div>
              )}
              {!inRoom && justSummoned.health !== 'blocked-on-prompt' && (
                <p className="mt-4 text-center text-sm text-ink-faint sm:mt-3 sm:text-[12px]">Usually takes 10–20 seconds — you can close this; it keeps going.</p>
              )}
              {/* Progressive disclosure (Waqas: the command dump buried the
                  status). The status IS this page; terminal access is an
                  advanced need that expands on demand, with one copy-all. */}
              <details className="group mt-4 overflow-hidden rounded-xl border border-border-faint bg-surface-softer/60" data-gate="summon-access-disclosure">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-base font-semibold text-ink-soft transition hover:text-ink sm:min-h-0 sm:px-3.5 sm:text-[13px]">
                  <span>Need to reach it from a terminal?</span>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="transition group-open:rotate-180" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                </summary>
                <div className="border-t border-border-faint px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() => { try { void navigator.clipboard.writeText(justSummoned.access.join('\n')); } catch { /* no clipboard */ } }}
                    className="mb-2 rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold text-accent transition hover:border-accent"
                  >
                    Copy all instructions
                  </button>
                  <ul className="space-y-1.5">
                    {justSummoned.access.map((line, i) => {
                      const parts = line.split(':  ');
                      const cmd = parts.length > 1 ? parts.slice(1).join(':  ') : line;
                      return (
                        <li key={i} className="flex items-start gap-2">
                          <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 font-mono text-[11px] leading-relaxed text-ink-soft">{line}</code>
                          <button type="button" onClick={() => { try { void navigator.clipboard.writeText(cmd); } catch { /* no clipboard */ } }}
                            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/10">Copy</button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
              <div className="mt-5 flex gap-3 sm:mt-4 sm:gap-2">
                <button type="button" onClick={() => { setJustSummoned(null); setName(''); }}
                  className="min-h-14 flex-1 rounded-xl border border-border px-3 py-3 text-base font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink sm:min-h-0 sm:py-2.5 sm:text-[13px]">＋ Summon another</button>
                <button type="button" onClick={onClose}
                  className="min-h-14 flex-1 rounded-xl bg-accent px-3 py-3 text-base font-semibold text-white transition hover:opacity-90 sm:min-h-0 sm:py-2.5 sm:text-[13px]">Done</button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
                <div>
                  <label className={labelClass}>Provider</label>
                  <select value={providerId} onChange={(e) => setProviderId(e.target.value)}
                    className={fieldClass}>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.label}{!p.available ? ' — not installed' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Model</label>
                  <select value={modelChoice} onChange={(e) => setModelChoice(e.target.value)}
                    className={fieldClass}>
                    {provider?.models.map((m) => <option key={m.id || 'default'} value={m.id}>{m.label}</option>)}
                    {provider?.allowCustomModel && <option value={CUSTOM}>Custom model id…</option>}
                  </select>
                </div>
              </div>
              {modelChoice === CUSTOM && (
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="e.g. gpt-5.5"
                  className={`mt-3 ${fieldClass}`} />
              )}
              <div className="mt-4 sm:mt-3">
                <label className={labelClass}>Agent name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ClaudeBuilder"
                  autoFocus
                  className={fieldClass} />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-3 sm:grid-cols-2 sm:gap-3">
                <div>
                  <label className={labelClass}>Workspace</label>
                  {roomWorkspace && !overrideWs ? (
                    <div className="flex min-h-14 items-center justify-between gap-2 rounded-2xl border border-border-faint bg-surface-softer px-4 sm:min-h-11 sm:rounded-xl sm:px-3">
                      <span className="min-w-0 truncate text-base font-medium text-ink sm:text-sm">{roomWorkspace.split('/').pop()}</span>
                      <button type="button" onClick={() => setOverrideWs(true)} className="min-h-11 shrink-0 px-1 text-sm font-semibold text-accent sm:min-h-0 sm:text-[12px]">Change</button>
                    </div>
                  ) : (
                    <>
                      <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}
                        className={fieldClass}>
                        {groups.map((g) => (
                          <optgroup key={g.group} label={g.group}>
                            {g.items.map((it) => <option key={it.path} value={it.path}>{it.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {roomWorkspace && <button type="button" onClick={() => setOverrideWs(false)} className="mt-1 min-h-11 text-sm font-semibold text-accent sm:min-h-8 sm:text-[12px]">Use room workspace</button>}
                    </>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Access</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value as AgentMode)}
                    className={fieldClass}>
                    <option value="build">Build — edit + run commands</option>
                    <option value="edit">Edit — files, no commands</option>
                    <option value="chat">Chat — room only</option>
                  </select>
                </div>
              </div>
              <div className="mt-2 text-sm leading-relaxed text-ink-soft sm:mt-1.5 sm:text-[12px]">
                {AGENT_MODE_COPY[mode].detail}
              </div>

              <details className="group mt-4 rounded-2xl border border-border-faint bg-surface-softer/60 sm:mt-3 sm:rounded-xl">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 text-base font-semibold text-ink-soft sm:min-h-11 sm:px-3 sm:text-[13px]">
                  <span>Advanced</span>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="transition group-open:rotate-180" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                </summary>
                <div className="space-y-4 border-t border-border-faint p-4 sm:space-y-3 sm:p-3">
                  <div>
                    <label className={labelClass}>Role <span className="font-medium text-ink-faint">optional</span></label>
                    <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Reviewer"
                      className={fieldClass} />
                  </div>
                  <button type="button" onClick={() => setPersistent(v => !v)}
                    aria-pressed={persistent}
                    className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border px-4 py-3 text-left sm:min-h-0 sm:rounded-xl sm:px-3 sm:py-2.5">
                    <span className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition ${persistent ? 'bg-accent' : 'bg-border'}`} aria-hidden="true">
                      <span className={`h-4 w-4 rounded-full bg-white transition ${persistent ? 'translate-x-4' : ''}`} />
                    </span>
                    <span className="min-w-0 text-sm sm:text-[13px]"><span className="font-semibold text-ink">Persistent session</span><span className="ml-1 text-ink-soft">— resumable later</span></span>
                  </button>
                  <div className="flex items-center justify-between gap-3 text-sm text-ink-soft sm:text-[12px]">
                    <span className="min-w-0">{provider?.account?.email || provider?.note || 'Provider details unavailable.'}</span>
                    <button type="button" onClick={() => void reloadCatalog()} disabled={refreshing} className="min-h-11 shrink-0 px-2 font-semibold text-accent disabled:opacity-50">
                      {refreshing ? 'Refreshing…' : 'Refresh options'}
                    </button>
                  </div>
                  {provider?.setupCmd && (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-ink-soft sm:rounded-lg sm:p-2.5 sm:text-[12px]">
                      <div className="font-semibold text-ink">Sign in once for this account lane</div>
                      <code className="mt-1 block break-all rounded bg-surface px-2 py-1 font-mono text-[12px] text-ink">{provider.setupCmd}</code>
                    </div>
                  )}
                </div>
              </details>

              {error && <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400 sm:mt-3 sm:rounded-lg sm:px-3 sm:py-2 sm:text-[13px]">{error}</div>}

              <button type="button" onClick={onSubmit} disabled={busy}
                className="mt-4 hidden min-h-11 w-full rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-40 sm:block">
                {busy ? 'Summoning…' : 'Summon agent'}
              </button>
            </>
          )}
        </div>
        {!loading && !justSummoned && (
          <footer className="shrink-0 border-t border-border-faint bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
            <button type="button" onClick={onSubmit} disabled={busy}
              className="min-h-14 w-full rounded-2xl bg-accent px-5 text-base font-semibold text-white shadow-sm disabled:opacity-40">
              {busy ? 'Summoning…' : 'Summon agent'}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
