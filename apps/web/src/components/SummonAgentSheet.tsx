import { useEffect, useMemo, useRef, useState } from 'react';
import {
  summonProviders, summonWorkspaces, listSummonedAgents, summonAgent, dismissSummonedAgent,
  removeAgentFromRoom, getRoom, setRoomWorkspaceAction, createClient,
  type SummonProvider, type SummonWorkspaceGroup, type SummonedAgent,
} from '../lib/api.js';

interface Props {
  code: string;
  onClose: () => void;
  /** Host identity for the unified removal verb — dismissing an agent here
   *  also frees its participant row, which needs the host's authority. */
  selfName?: string;
}

const CUSTOM = '__custom__';

export function SummonAgentSheet({ code, onClose, selfName }: Props) {
  const [providers, setProviders] = useState<SummonProvider[]>([]);
  const [groups, setGroups] = useState<SummonWorkspaceGroup[]>([]);
  const [agents, setAgents] = useState<SummonedAgent[]>([]);
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
  const [mode, setMode] = useState<'chat' | 'edit' | 'build'>('chat');
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

  async function refreshAgents() {
    try { setAgents((await listSummonedAgents()).filter((a) => a.room === code && a.status === 'active')); }
    catch { /* ignore */ }
  }

  // Refresh the provider catalog (accounts + live model lists) on demand.
  async function reloadCatalog() {
    setRefreshing(true);
    try {
      const [ps, gs] = await Promise.all([summonProviders(true), summonWorkspaces()]);
      setProviders(ps);
      setGroups(gs);
      if (!ps.find((p) => p.id === providerId)) {
        const first = ps.find((p) => p.available) || ps[0];
        if (first) { setProviderId(first.id); setModelChoice(first.defaultModel); }
      }
      await refreshAgents();
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
      setInRoom(false);
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
    try {
      // The unified removal verb: dismissing here must ALSO free the agent's
      // participant row, or the People pane keeps a ghost (the summoner's own
      // self-leave is best-effort and can miss). Falls back to a bare dismiss
      // when the caller identity is unknown.
      const rec = agents.find((a) => a.agentId === agentId);
      if (rec && selfName) {
        await removeAgentFromRoom({ code, requesterName: selfName, targetName: rec.name, targetClient: 'cc', agentId });
      } else {
        await dismissSummonedAgent(agentId);
      }
      await refreshAgents();
    }
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
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void reloadCatalog()} disabled={refreshing}
              title="Refresh accounts & model lists"
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft transition hover:bg-surface-softer disabled:opacity-50" aria-label="Refresh">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}>
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" />
              </svg>
            </button>
            <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-soft hover:bg-surface-softer" aria-label="Close">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </div>
        </header>

        <div className="overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-10 text-center text-sm text-ink-soft">Loading providers &amp; workspaces…</div>
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
                <div className="mt-3 text-lg font-semibold text-ink">
                  {inRoom ? `${justSummoned.name} is in the room` : `Summoning ${justSummoned.name}…`}
                </div>
                <div className="mt-1 text-[13px] text-ink-soft">{justSummoned.provider} / {justSummoned.model || 'account-default'}</div>
              </div>
              <ol className="mx-auto mt-4 w-full max-w-xs space-y-1.5" data-gate="summon-progress" aria-live="polite">
                {([
                  ['Process started', true],
                  ['Agent running', justSummoned.health === 'online' || inRoom],
                  ['Joined the room', inRoom],
                ] as const).map(([label, done]) => (
                  <li key={label} className="flex items-center gap-2.5 text-[13px]">
                    {done
                      ? <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-success text-[11px] font-bold text-white">✓</span>
                      : <span className="h-5 w-5 flex-shrink-0 animate-pulse rounded-full border-2 border-border" aria-hidden="true" />}
                    <span className={done ? 'text-ink' : 'text-ink-soft'}>{label}</span>
                  </li>
                ))}
              </ol>
              {justSummoned.health === 'blocked-on-prompt' && (
                <div role="alert" className="mx-auto mt-3 w-full max-w-sm rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-[13px] text-ink-soft">
                  <span className="font-bold text-amber-300">Waiting for your permission</span> — the agent hit a
                  permission dialog while starting. Open People → tap {justSummoned.name} to answer it.
                </div>
              )}
              {!inRoom && justSummoned.health !== 'blocked-on-prompt' && (
                <p className="mt-3 text-center text-[12px] text-ink-faint">Usually takes 10–20 seconds — you can close this; it keeps going.</p>
              )}
              {/* Progressive disclosure (Waqas: the command dump buried the
                  status). The status IS this page; terminal access is an
                  advanced need that expands on demand, with one copy-all. */}
              <details className="group mt-4 overflow-hidden rounded-xl border border-border-faint bg-surface-softer/60" data-gate="summon-access-disclosure">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-[13px] font-semibold text-ink-soft transition hover:text-ink">
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
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => { setJustSummoned(null); setName(''); }}
                  className="flex-1 rounded-xl border border-border px-3 py-2.5 text-[13px] font-semibold text-ink-soft transition hover:border-border-strong hover:text-ink">＋ Summon another</button>
                <button type="button" onClick={onClose}
                  className="flex-1 rounded-xl bg-accent px-3 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90">Done</button>
              </div>
            </div>
          ) : (
            <>
              {/* Guided top-to-bottom flow (Waqas: the old single wall of
                  fields taught nothing). Three numbered steps — WHO the agent
                  is, WHERE it works, WHAT it may do — then summon. Same
                  fields, sequential grammar. */}
              <div className="mb-2 flex items-center gap-2" aria-hidden="true">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">1</span>
                <span className="text-[13px] font-bold uppercase tracking-wide text-ink">Who</span>
                <span className="text-[12px] text-ink-faint">— pick the AI and name it</span>
              </div>
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
              {/* Name + Role — part of WHO: identity before logistics. */}
              <div className="mb-4 mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[13px] font-semibold text-ink">Display name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CopilotDev"
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                </div>
                <div>
                  <label className="mb-1 block text-[13px] font-semibold text-ink">Role <span className="font-medium text-ink-faint">optional</span></label>
                  <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Builder"
                    className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                </div>
              </div>

              {/* Workspace — belongs to the room; the agent inherits it. */}
              <div className="mb-2 flex items-center gap-2" aria-hidden="true">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">2</span>
                <span className="text-[13px] font-bold uppercase tracking-wide text-ink">Where</span>
                <span className="text-[12px] text-ink-faint">— the folder it works in</span>
              </div>
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

              {/* Mode */}
              <div className="mb-2 flex items-center gap-2" aria-hidden="true">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">3</span>
                <span className="text-[13px] font-bold uppercase tracking-wide text-ink">What it may do</span>
                <span className="text-[12px] text-ink-faint">— you can change this later from People</span>
              </div>
              <div className="mb-1 grid grid-cols-3 gap-2">
                {([
                  ['chat', 'Chat', 'Room only'],
                  ['edit', 'Edit', 'Edit files'],
                  ['build', 'Build', 'Edit + run cmds'],
                ] as const).map(([val, title, sub]) => (
                  <button key={val} type="button" onClick={() => setMode(val)}
                    className={`rounded-xl border px-2 py-2 text-[13px] transition ${mode === val ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-soft hover:border-border-strong'}`}>
                    <div className="font-semibold">{title}</div><div className="text-[11px] text-ink-soft">{sub}</div>
                  </button>
                ))}
              </div>
              <div className="mb-4 text-[11px] text-ink-soft">
                {mode === 'build' ? 'Full autonomy in the workspace — edits files and runs commands (git, tests, builds) without prompting. For agents that ship changes.'
                  : mode === 'edit' ? 'Can create and modify files in the workspace (auto-accepted). No shell commands.'
                  : 'Discusses and advises in the room. No file access.'}
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
