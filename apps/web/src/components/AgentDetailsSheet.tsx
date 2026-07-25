import { useEffect, useState, type ReactNode } from 'react';
import { listRoomAgentHistory, relaunchAgentWithMode, type SummonedAgent } from '../lib/api.js';
import { brandFor } from '../lib/agentBrand.js';

// Permission levels a summoned agent can be relaunched at. Labels mirror the
// SummonAgentSheet copy so both surfaces describe the same contract.
const PERMISSION_LEVELS = [
  { value: 'chat', label: 'Chat', detail: 'Responds in the room only (no file access)' },
  { value: 'edit', label: 'Edit', detail: 'Can create/modify files in the workspace' },
  { value: 'build', label: 'Build', detail: 'Edits files and runs commands autonomously' },
] as const;
type PermissionLevel = (typeof PERMISSION_LEVELS)[number]['value'];

interface DetailParticipant {
  name: string;
  role?: string;
  client: string;
  harness?: string;
  // T-47b: self-reported metadata a manually-joined agent supplies at join.
  model?: string;
  account?: string;
  workspace?: string;
  capabilities?: string;
  joinedAt?: number;
  lastSeenAt?: number;
}

// Full detail view for a room participant — pulls the summoner record (account,
// model, provider, session, join/leave dates) when it's an agent we summoned,
// and falls back to the participant row for join-code agents.
export function AgentDetailsSheet({ code, participant, onClose }: { code: string; participant: DetailParticipant; onClose: () => void }) {
  const [agent, setAgent] = useState<SummonedAgent | null>(null);
  const [loading, setLoading] = useState(true);
  // Permission-change flow: closed → picking a level → confirming the
  // relaunch → busy while the summoner swaps the process.
  const [picking, setPicking] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<PermissionLevel | null>(null);
  const [relaunching, setRelaunching] = useState(false);
  const [permissionNote, setPermissionNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listRoomAgentHistory(code).then((list) => {
      if (!alive) return;
      const matches = list.filter((a) => a.name === participant.name).sort((a, b) => b.createdAt - a.createdAt);
      setAgent(matches.find((a) => a.status === 'active') || matches[0] || null);
      setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code, participant.name]);

  const brand = brandFor({ client: participant.client, harness: participant.harness });
  const fmt = (t?: number) => (t ? new Date(t).toLocaleString() : '—');
  // Only a live, summoned agent can have its level changed — the level maps to
  // launch flags, so the summoner relaunches it. Join-code agents are managed
  // wherever they were started and stay read-only here.
  const currentLevel = ((agent?.accessLevel || agent?.mode) ?? 'chat') as PermissionLevel;
  const canChangePermissions = Boolean(agent && agent.status === 'active');

  async function onConfirmRelaunch() {
    if (!agent || !pendingLevel || relaunching) return;
    setRelaunching(true);
    setPermissionNote(null);
    try {
      const next = await relaunchAgentWithMode(agent.agentId, pendingLevel);
      setAgent(next);
      setPicking(false);
      setPendingLevel(null);
      setPermissionNote(`${participant.name} is relaunching with ${pendingLevel} access — back in the room in a few seconds.`);
    } catch (e) {
      setPermissionNote(e instanceof Error ? e.message : 'Could not relaunch the agent.');
    } finally {
      setRelaunching(false);
    }
  }
  const resume = agent?.access?.find((l) => /Resume this|Chat directly/i.test(l));
  const resumeCmd = resume ? resume.split(':  ').slice(1).join(':  ') : '';

  const rows: Array<[string, ReactNode]> = [
    ['Provider', agent ? agent.provider : (brand?.label ?? participant.harness ?? 'Agent')],
    ['Model', agent ? (agent.model || 'account-default') : (participant.model || '—')],
    ['Account', agent?.account || participant.account || '—'],
    ['Workspace', agent?.workspace || participant.workspace || '—'],
    ['Permissions', (
      <span className="inline-flex flex-wrap items-center justify-end gap-2">
        <span>
          {agent
            ? (agent.accessLabel
                || (currentLevel === 'build' ? 'Build — edits files and runs commands autonomously'
                  : currentLevel === 'edit' ? 'Edit — can create/modify files in the workspace'
                  : 'Chat — responds in the room only (no file access)'))
            : (participant.capabilities || '—')}
        </span>
        {canChangePermissions && (
          <button
            type="button"
            onClick={() => { setPicking(p => !p); setPendingLevel(null); setPermissionNote(null); }}
            className="rounded-md px-2 py-1 text-[12px] font-semibold text-accent transition hover:bg-accent/10"
          >
            {picking ? 'Cancel' : 'Change'}
          </button>
        )}
      </span>
    )],
    ['Persistent', agent ? (agent.persistent ? 'Yes — resumable' : 'No — one-shot') : '—'],
    ['Role', participant.role || agent?.role || '—'],
    ['Joined', fmt(agent?.createdAt ?? participant.joinedAt)],
    ['Left', agent?.dismissedAt ? fmt(agent.dismissedAt) : (agent?.status === 'active' || !agent ? 'Still here' : '—')],
    ['Health', agent?.health || (brand ? 'in room' : '—')],
    ['Source', agent ? 'Summoned in-app' : 'Joined via invite link / code'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="agent-detail-title">
      <button type="button" className="absolute inset-0 bg-black/55" onClick={onClose} aria-label="Close details" />
      <section className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-border-faint px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Agent details</div>
            <h2 id="agent-detail-title" className="mt-0.5 truncate text-lg font-semibold text-ink">{participant.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-softer" aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="py-8 text-center text-sm text-ink-soft">Loading…</div>
          ) : (
            <>
              <dl className="divide-y divide-border-faint">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-4 py-2">
                    <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{k}</dt>
                    <dd className="min-w-0 break-words text-right text-[13px] text-ink">{v}</dd>
                  </div>
                ))}
              </dl>

              {permissionNote && (
                <p role="status" className="mt-3 rounded-lg bg-surface-softer px-3 py-2 text-[13px] text-ink-soft">{permissionNote}</p>
              )}

              {picking && canChangePermissions && (
                <div className="mt-3 rounded-xl border border-border p-3" data-gate="permission-picker">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Change permissions</div>
                  <div role="radiogroup" aria-label="Permission level" className="flex flex-col gap-1.5">
                    {PERMISSION_LEVELS.map(lvl => {
                      const selected = (pendingLevel ?? currentLevel) === lvl.value;
                      return (
                        <button
                          key={lvl.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={relaunching}
                          onClick={() => setPendingLevel(lvl.value)}
                          className={`min-h-11 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50 ${
                            selected ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                          }`}
                        >
                          <span className="text-sm font-semibold text-ink">
                            {lvl.label}{lvl.value === currentLevel ? ' (current)' : ''}
                          </span>
                          <span className="block text-[13px] text-ink-soft">{lvl.detail}</span>
                        </button>
                      );
                    })}
                  </div>
                  {pendingLevel && pendingLevel !== currentLevel && (
                    <div className="mt-3">
                      <p className="text-[13px] text-ink">
                        Relaunch <span className="font-semibold">{participant.name}</span> with {pendingLevel} access? It will
                        leave the room briefly and rejoin in a few seconds with the new level.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={relaunching}
                          onClick={() => { void onConfirmRelaunch(); }}
                          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                        >
                          {relaunching ? 'Relaunching…' : 'Relaunch'}
                        </button>
                        <button
                          type="button"
                          disabled={relaunching}
                          onClick={() => setPendingLevel(null)}
                          className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold transition hover:border-accent disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {resumeCmd && (
                <div className="mt-4">
                  <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Reach it directly</div>
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded bg-surface-softer px-2 py-1.5 font-mono text-[11px] text-ink-soft">{resumeCmd}</code>
                    <button type="button" onClick={() => { try { void navigator.clipboard.writeText(resumeCmd); } catch { /* no clipboard */ } }}
                      className="shrink-0 rounded-md px-2 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/10">Copy</button>
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
