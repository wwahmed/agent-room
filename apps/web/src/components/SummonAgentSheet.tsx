import { useEffect, useMemo, useRef, useState } from 'react';
import {
  summonProviders, summonWorkspaces, listSummonedAgents, summonAgent, dismissSummonedAgent,
  getRoom, setRoomWorkspaceAction, createClient,
  type SummonProvider, type SummonWorkspaceGroup, type SummonedAgent,
} from '../lib/api.js';

interface Props {
  code: string;
  onClose: () => void;
}

const CUSTOM = '__custom__';

export function SummonAgentSheet({ code, onClose }: Props) {
  const [providers, setProviders] = useState<SummonProvider[]>([]);
  const [groups, setGroups] = useState<SummonWorkspaceGroup[]>([]);
  const [agents, setAgents] = useState<SummonedAgent[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [mode, setMode] = useState<'chat' | 'build'>('chat');
  const [persistent, setPersistent] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSummoned, setJustSummoned] = useState<SummonedAgent | null>(null);

  const provider = useMemo(() => providers.find((p) => p.id === providerId) || null, [providers, providerId]);

  async function refreshAgents() {
    try { setAgents((await listSummonedAgents()).filter((a) => a.room === code && a.status === 'active')); }
    catch { /* ignore */ }
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
      await refreshAgents();
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
      setJustSummoned(agent);
      setName('');
      await refreshAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDismiss(agentId: string) {
    try { await dismissSummonedAgent(agentId); await refreshAgents(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const healthColor = (h: string) =>
    h === 'online' ? 'bg-success' : h === 'starting' ? 'bg-warning' : h === 'stalled' ? 'bg-warning' : 'bg-red-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-5"
      role="dialog" aria-modal="true" aria-labelledby="summon-title">
      <button type="button" className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close summon dialog" />
      <section className="relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border-faint px-4 py-3 sm:px-6">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Summon agent</div>
            <h2 id="summon-title" className="mt-0.5 text-lg font-semibold text-ink">Bring a coding agent into this room</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:bg-surface-softer" aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-10 text-center text-sm text-ink-soft">Loading providers &amp; workspaces…</div>
          ) : (
            <>
              {/* Provider + Model — compact row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[13px] font-semibold text-ink">Provider</label>
                  <select value={providerId} onChange={(e) => setProviderId(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink">
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.available}>
                        {p.label}{!p.available ? ' — not installed' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-semibold text-ink">Model</label>
                  <select value={modelChoice} onChange={(e) => setModelChoice(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink">
                    {provider?.models.map((m) => <option key={m.id || 'default'} value={m.id}>{m.label}</option>)}
                    {provider?.allowCustomModel && <option value={CUSTOM}>Custom model id…</option>}
                  </select>
                </div>
              </div>
              {modelChoice === CUSTOM && (
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="e.g. gpt-5.5"
                  className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
              )}
              {provider?.setupCmd ? (
                <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11.5px] text-ink-soft">
                  <div className="font-semibold text-ink">One-time setup — run Claude agents on your corporate account:</div>
                  <code className="mt-1 block break-all rounded bg-surface px-2 py-1 font-mono text-[11px] text-ink">{provider.setupCmd}</code>
                  <div className="mt-1">Run once in a terminal, sign in with your corporate login. Your personal <span className="font-mono">claude</span> CLI stays completely separate.</div>
                </div>
              ) : provider?.account?.email ? (
                <div className="mt-1.5 text-[11px] text-ink-soft">Claude agents run on <span className="font-medium text-ink">{provider.account.email}</span> — isolated corporate lane, your personal CLI untouched.</div>
              ) : provider?.note ? (
                <div className="mt-1.5 text-[11px] text-ink-soft">{provider.note}</div>
              ) : null}
              <div className="mb-4" />

              {/* Workspace — belongs to the room; the agent inherits it. */}
              <label className="mb-1 block text-[13px] font-semibold text-ink">Workspace</label>
              {roomWorkspace && !overrideWs ? (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border-faint bg-surface-softer px-3 py-2.5">
                  <div className="min-w-0 text-sm text-ink">
                    <span className="text-ink-soft">Inherited from room:</span>{' '}
                    <span className="font-medium">{roomWorkspace.split('/').pop()}</span>
                  </div>
                  <button type="button" onClick={() => setOverrideWs(true)}
                    className="shrink-0 text-[12px] font-semibold text-accent hover:underline">Use a different one</button>
                </div>
              ) : (
                <>
                  <select value={workspace} onChange={(e) => setWorkspace(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink">
                    {groups.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.items.map((it) => <option key={it.path} value={it.path}>{it.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <div className="mb-4 mt-1.5 text-[11px] text-ink-soft">
                    {roomWorkspace
                      ? <button type="button" onClick={() => setOverrideWs(false)} className="font-semibold text-accent hover:underline">← back to the room's workspace</button>
                      : 'This room has no workspace yet — the one you pick becomes the room’s workspace.'}
                  </div>
                </>
              )}

              {/* Name + Role */}
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[13px] font-semibold text-ink">Display name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CopilotDev"
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-semibold text-ink">Role</label>
                  <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Builder"
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                </div>
              </div>

              {/* Mode */}
              <label className="mb-1 block text-[13px] font-semibold text-ink">Capabilities</label>
              <div className="mb-4 flex gap-2">
                <button type="button" onClick={() => setMode('chat')}
                  className={`flex-1 rounded-xl border px-3 py-2 text-[13px] transition ${mode === 'chat' ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-soft'}`}>
                  <div className="font-semibold">Chat</div><div className="text-[11px] text-ink-soft">Responds in the room only</div>
                </button>
                <button type="button" onClick={() => setMode('build')}
                  className={`flex-1 rounded-xl border px-3 py-2 text-[13px] transition ${mode === 'build' ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-soft'}`}>
                  <div className="font-semibold">Build</div><div className="text-[11px] text-ink-soft">Can edit files in the workspace</div>
                </button>
              </div>

              {/* Persistent session — resumable + shows in your CLI/app session list. */}
              <button type="button" onClick={() => setPersistent(v => !v)}
                className="mb-4 flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition hover:border-border-strong">
                <span className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition ${persistent ? 'bg-accent' : 'bg-border'}`}>
                  <span className={`h-4 w-4 rounded-full bg-white transition ${persistent ? 'translate-x-4' : ''}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink">Persistent session</span>
                  <span className="block text-[11px] text-ink-soft">Resumable + attachable — reach this exact agent later with {provider?.id === 'copilot' ? 'copilot --resume' : provider?.id === 'codex' ? 'codex resume' : 'claude --resume'}. Off = one-shot, no saved session.</span>
                </span>
              </button>

              {error && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{error}</div>}

              <button type="button" onClick={onSubmit} disabled={busy}
                className="min-h-11 w-full rounded-xl bg-accent px-5 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? 'Summoning…' : 'Create & Summon'}
              </button>

              {/* Access instructions for the just-summoned agent */}
              {justSummoned && (
                <div className="mt-4 rounded-xl border border-success/40 bg-success/10 p-3">
                  <div className="text-[13px] font-semibold text-ink">✅ {justSummoned.name} summoned — reach it directly:</div>
                  <ul className="mt-1.5 space-y-1">
                    {justSummoned.access.map((line, i) => (
                      <li key={i} className="font-mono text-[11.5px] leading-relaxed text-ink-soft break-all">{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Live roster for this room */}
              {agents.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 text-[13px] font-semibold text-ink">Summoned in this room</div>
                  <div className="space-y-1.5">
                    {agents.map((a) => (
                      <div key={a.agentId} className="flex items-center gap-2 rounded-lg border border-border-faint px-3 py-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${healthColor(a.health)}`} title={a.health} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-ink">{a.name} <span className="text-ink-soft">· {a.provider}/{a.model || 'default'}</span></div>
                          <div className="truncate text-[11px] text-ink-soft">{a.role} · {a.workspace.split('/').pop()} · {a.health}</div>
                        </div>
                        <button type="button" onClick={() => onDismiss(a.agentId)}
                          className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-red-400 hover:bg-red-500/10">Dismiss</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
