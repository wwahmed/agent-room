import { useEffect, useState, type ReactNode } from 'react';
import { listRoomAgentHistory, type SummonedAgent } from '../lib/api.js';
import { brandFor } from '../lib/agentBrand.js';

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
  const resume = agent?.access?.find((l) => /Resume this|Chat directly/i.test(l));
  const resumeCmd = resume ? resume.split(':  ').slice(1).join(':  ') : '';

  const rows: Array<[string, ReactNode]> = [
    ['Provider', agent ? agent.provider : (brand?.label ?? participant.harness ?? 'Agent')],
    ['Model', agent ? (agent.model || 'account-default') : (participant.model || '—')],
    ['Account', agent?.account || participant.account || '—'],
    ['Workspace', agent?.workspace || participant.workspace || '—'],
    ['Permissions', agent
      ? (agent.accessLabel
          || (agent.mode === 'build' ? 'Build — edits files and runs commands autonomously'
            : agent.mode === 'edit' ? 'Edit — can create/modify files in the workspace'
            : 'Chat — responds in the room only (no file access)'))
      : (participant.capabilities || '—')],
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
