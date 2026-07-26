import { useEffect, useState, type ReactNode } from 'react';
import { listRoomAgentHistory, relaunchAgentWithMode, respondToAgentPrompt, type PromptRespondVerb, type SummonedAgent } from '../lib/api.js';
import { brandFor } from '../lib/agentBrand.js';
import { canRecover, presenceView, recoveryPrompt, type ParticipantHealth } from '../lib/presence.js';

// Header presence chip tones — the server's listen-loop verdict, promoted from
// a buried mid-list row to the first thing the sheet says about an agent.
const PRESENCE_CHIP_TONE: Record<string, string> = {
  listening: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  online: 'border-border bg-surface-softer text-ink-soft',
  // T-04: calm accent for a declared work window — busy, not degrading.
  working: 'border-sky-400/40 bg-sky-500/10 text-sky-300',
  stale: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
  disconnected: 'border-red-400/40 bg-red-500/10 text-red-300',
};

// Permission levels a summoned agent can be relaunched at. Labels mirror the
// SummonAgentSheet copy so both surfaces describe the same contract.
const PERMISSION_LEVELS = [
  { value: 'chat', label: 'Chat', detail: 'Responds in the room only (no file access)' },
  { value: 'edit', label: 'Edit', detail: 'Can create/modify files in the workspace' },
  { value: 'build', label: 'Build', detail: 'Edits files and runs commands autonomously' },
] as const;
type PermissionLevel = (typeof PERMISSION_LEVELS)[number]['value'];

// One runnable terminal command from the summoner's access lines, with its
// prose peeled off. Format upstream is "Label:  command   (hint)".
interface AccessCommand { label: string; cmd: string; hint?: string }

function parseAccessLine(line: string): AccessCommand | null {
  const idx = line.indexOf(':  ');
  if (idx === -1) return { label: '', cmd: line.trim() };
  const label = line.slice(0, idx).trim();
  // Provider/model + workspace are facts, not commands — they already live in
  // the identity column, and putting prose in a copy row makes copy useless.
  if (/^(Provider\s*\/\s*model|Workspace)$/i.test(label)) return null;
  let cmd = line.slice(idx + 3).trim();
  let hint: string | undefined;
  const m = cmd.match(/^(.*?)\s{2,}\((.*)\)$/);
  if (m?.[1]) { cmd = m[1]; hint = m[2]; }
  return { label, cmd, hint };
}

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
export function AgentDetailsSheet({ code, participant, onClose, onRemove, health, ended }: {
  code: string;
  participant: DetailParticipant;
  onClose: () => void;
  /** Host-only: the unified "Remove from room" verb (same flow as the
   *  People-row ×) — stops the summoned process if we manage one, then frees
   *  the participant row. Absent for non-hosts and for the host's own row. */
  onRemove?: () => void;
  /** The server's listen-loop verdict for this participant (T-68). When it says
   *  a CLI agent is stale/disconnected — the "hit its usage limits and went
   *  quiet" failure mode — the sheet surfaces the recovery path right here,
   *  not only on the People row. */
  health?: ParticipantHealth | null;
  ended?: boolean;
}) {
  const [agent, setAgent] = useState<SummonedAgent | null>(null);
  const [loading, setLoading] = useState(true);
  // Permission-change flow: closed → picking a level → confirming the
  // relaunch → busy while the summoner swaps the process.
  const [picking, setPicking] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<PermissionLevel | null>(null);
  const [relaunching, setRelaunching] = useState(false);
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  // Blocked-on-prompt flow: the agent's harness is sitting on an interactive
  // permission dialog; the banner shows it and relays a human tap as a verb.
  const [responding, setResponding] = useState(false);
  const [promptNote, setPromptNote] = useState<string | null>(null);

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
  async function onRespond(verb: PromptRespondVerb) {
    if (!agent || responding) return;
    setResponding(true);
    setPromptNote(null);
    try {
      const out = await respondToAgentPrompt(agent.agentId, verb);
      setAgent(out.agent);
      setPromptNote(out.cleared
        ? `Answered — ${participant.name} is working again.`
        : 'Answer sent, but the dialog is still showing — it may have advanced to a follow-up prompt. Reopen to check.');
    } catch (e) {
      setPromptNote(e instanceof Error ? e.message : 'Could not deliver the answer.');
    } finally {
      setResponding(false);
    }
  }

  // Full terminal-access block from the summoner record, parsed so prose and
  // code never share a chip: the label ("Watch the live agent loop") renders
  // as text, the code block holds ONLY the runnable command, and trailing
  // hints like "(detach: Ctrl-b then d)" stay out of the clipboard. Fact lines
  // (provider/model, workspace) are dropped — the identity column owns those.
  const commands = (agent?.access ?? []).map(parseAccessLine).filter((c): c is AccessCommand => c !== null);
  // The one action that works when a CLI agent stops listening (usage limits,
  // crashed harness, closed terminal): paste the recovery prompt into its
  // terminal. Same contract as the People-row button.
  const offline = Boolean(health && canRecover(health, ended ?? false));
  const recoveryText = recoveryPrompt(code, participant.name, participant.role);
  const [copiedWhat, setCopiedWhat] = useState<string | null>(null);
  const copy = (text: string, what: string) => {
    try { void navigator.clipboard.writeText(text); setCopiedWhat(what); } catch { /* no clipboard */ }
  };

  // Permissions moved out of the fact list into the controls column — it's an
  // action surface (Change → picker → relaunch), not a static fact.
  const permissionLabel = agent
    ? (agent.accessLabel
        || (currentLevel === 'build' ? 'Build — edits files and runs commands autonomously'
          : currentLevel === 'edit' ? 'Edit — can create/modify files in the workspace'
          : 'Chat — responds in the room only (no file access)'))
    : (participant.capabilities || '—');
  const presence = health ? presenceView(health) : null;

  const rows: Array<[string, ReactNode]> = [
    ['Provider', agent ? agent.provider : (brand?.label ?? participant.harness ?? 'Agent')],
    ['Model', agent ? (agent.model || 'account-default') : (participant.model || '—')],
    ['Account', agent?.account || participant.account || '—'],
    ['Workspace', agent?.workspace || participant.workspace || '—'],
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
      {/* Desktop is a control center, not a phone sheet: the panel widens to
          ~4xl on lg+ and the body splits into identity | controls columns.
          Small screens keep the familiar stacked bottom-sheet. */}
      <section className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-2xl lg:max-w-5xl">
        <header className="flex items-center justify-between gap-3 border-b border-border-faint px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold uppercase tracking-wide text-accent">Agent details</div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 id="agent-detail-title" className="truncate text-lg font-semibold text-ink lg:text-2xl">{participant.name}</h2>
              {presence && (
                <span
                  data-gate="presence-chip"
                  className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${PRESENCE_CHIP_TONE[presence.state]} lg:text-[13px]`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  {presence.label}
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-softer" aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-6 lg:p-8">
          {loading ? (
            <div className="py-8 text-center text-sm text-ink-soft">Loading…</div>
          ) : (
            <>
              {agent?.health === 'blocked-on-prompt' && (
                <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3" data-gate="prompt-banner" role="alert">
                  <div className="text-[13px] font-bold text-amber-300">Waiting for your permission</div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                    {participant.name} is stopped on a permission dialog and can't continue until someone answers it.
                    This is its harness's own safety prompt — your tap below is the answer.
                  </p>
                  {agent.promptPreview && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/30 p-2.5 font-mono text-[11px] leading-snug text-ink-soft">{agent.promptPreview}</pre>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button type="button" disabled={responding} onClick={() => { void onRespond('approve'); }}
                      className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                      {responding ? 'Sending…' : 'Approve'}
                    </button>
                    <button type="button" disabled={responding} onClick={() => { void onRespond('approve-always'); }}
                      className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold transition hover:border-accent disabled:opacity-50">
                      Always allow
                    </button>
                    <button type="button" disabled={responding} onClick={() => { void onRespond('deny'); }}
                      className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-red-300 transition hover:border-red-400/60 disabled:opacity-50">
                      Deny
                    </button>
                  </div>
                </div>
              )}
              {promptNote && (
                <p role="status" className="mb-3 rounded-lg bg-surface-softer px-3 py-2 text-[13px] text-ink-soft">{promptNote}</p>
              )}
              {offline && (
                <div className="mb-4 rounded-xl border border-red-400/40 bg-red-500/10 p-3" data-gate="recovery-banner" role="alert">
                  <div className="text-[13px] font-bold text-red-300">
                    {health?.state === 'disconnected' ? 'Disconnected' : 'Not listening'} — needs a nudge to come back
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-soft lg:text-[14px]">
                    {participant.name} isn't in its room-listen loop. This happens when the model hits its
                    usage limits, the harness exits, or its terminal closes. The app can't restart a CLI
                    process, but you can: copy the recovery prompt and paste it into the agent's terminal
                    {commands.length > 0 ? ' — the commands below reach that terminal' : ''}.
                  </p>
                  <code className="mt-2 block break-words rounded-lg bg-black/30 p-2.5 font-mono text-[12px] leading-relaxed text-ink-soft lg:text-[13px]">{recoveryText}</code>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copy(recoveryText, 'recovery')}
                      className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition hover:opacity-90"
                    >
                      Copy recovery prompt
                    </button>
                    {copiedWhat === 'recovery' && <span role="status" className="text-[12px] font-semibold text-accent">Copied</span>}
                  </div>
                </div>
              )}
              <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-x-12" data-gate="details-columns">
              <section aria-label="Identity" data-gate="identity-col">
                <h3 className="mb-1 hidden text-[12px] font-semibold uppercase tracking-wide text-accent lg:block">Identity</h3>
                <dl className="divide-y divide-border-faint">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 py-2 lg:py-2.5">
                      <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint lg:text-[13px]">{k}</dt>
                      <dd className="min-w-0 break-words text-right text-[13px] text-ink lg:text-[15px]">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* The action surfaces — permissions, terminal access, removal —
                  live together in their own column on desktop instead of being
                  interleaved with facts down one narrow scroll. */}
              <section aria-label="Controls" data-gate="controls-col" className="mt-5 lg:mt-0">
                <div className="rounded-xl border border-border-faint bg-surface-softer/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Permissions</div>
                    {canChangePermissions && (
                      <button
                        type="button"
                        onClick={() => { setPicking(p => !p); setPendingLevel(null); setPermissionNote(null); }}
                        className="rounded-md px-2 py-1 text-[12px] font-semibold text-accent transition hover:bg-accent/10"
                      >
                        {picking ? 'Cancel' : 'Change'}
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-ink lg:text-[15px]">{permissionLabel}</p>

              {permissionNote && (
                <p role="status" className="mt-3 rounded-lg bg-surface-softer px-3 py-2 text-[13px] text-ink-soft">{permissionNote}</p>
              )}

              {picking && canChangePermissions && (
                <div className="mt-3 border-t border-border-faint pt-3" data-gate="permission-picker">
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
                </div>

              {/* The SAME terminal-access block the Summon screen shows — tmux
                  attach, resume command, provider/model, workspace — so an
                  agent can be located and reached from here long after the
                  summon sheet is gone. Join-code agents get an honest
                  explanation instead of a false-empty. */}
              <div className="mt-4" data-gate="terminal-access">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Reach it from a terminal</div>
                  {commands.length > 1 && (
                    <button
                      type="button"
                      onClick={() => copy(commands.map((c) => c.cmd).join('\n'), 'all')}
                      className="rounded-md px-2 py-1 text-[12px] font-semibold text-accent transition hover:bg-accent/10"
                    >
                      {copiedWhat === 'all' ? 'Copied' : 'Copy all'}
                    </button>
                  )}
                </div>
                {commands.length > 0 ? (
                  <>
                    {agent && agent.status !== 'active' && (
                      <p className="mb-2 text-[12px] leading-relaxed text-ink-faint lg:text-[13px]">
                        Its process was dismissed — the live-loop (tmux) line won't attach anymore, but the
                        resume command still reopens this exact session.
                      </p>
                    )}
                    <ul className="space-y-2.5">
                      {commands.map((c, i) => (
                        <li key={i} className="rounded-xl bg-surface-softer p-3">
                          <div className="mb-1.5 flex items-baseline justify-between gap-3">
                            <span className="min-w-0 text-[13px] font-medium text-ink-soft lg:text-[14px]">
                              {c.label || 'Command'}
                              {c.hint && <span className="font-normal text-ink-faint"> — {c.hint}</span>}
                            </span>
                            <button
                              type="button"
                              onClick={() => copy(c.cmd, `line-${i}`)}
                              className="shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-accent transition hover:bg-accent/10"
                            >
                              {copiedWhat === `line-${i}` ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <code className="block break-all rounded-lg bg-black/30 p-2.5 font-mono text-[12px] leading-relaxed text-ink lg:text-[13px]">{c.cmd}</code>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-ink-soft lg:text-[14px]">
                    Joined via invite code — its process runs wherever it was started
                    {participant.workspace ? <> (workspace <code className="rounded bg-surface-softer px-1.5 py-0.5 font-mono text-[12px]">{participant.workspace}</code>)</> : null},
                    so there are no app-managed terminal commands for it. To interact with it directly, use
                    the terminal it was launched from{offline ? ' — and paste the recovery prompt above to bring it back into the room' : ''}.
                  </p>
                )}
              </div>

              {onRemove && (
                <div className="mt-4 border-t border-border-faint pt-4" data-gate="remove-from-room">
                  <button
                    type="button"
                    onClick={onRemove}
                    className="min-h-11 w-full rounded-lg border border-red-400/40 bg-red-500/10 px-4 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                  >
                    Remove from room{agent?.status === 'active' ? ' (stops its agent process)' : ''}
                  </button>
                  <p className="mt-1.5 text-[12px] text-ink-faint lg:text-[13px]">
                    {agent?.status === 'active'
                      ? 'Dismisses the summoned process on this Mac and frees its seat in this room. You can summon it again later.'
                      : agent
                        ? 'Its process is already dismissed — this just clears the leftover row in People.'
                        : 'Joined by code: its process runs elsewhere and is not stopped — it only loses its seat in this room.'}
                  </p>
                </div>
              )}
              </section>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
