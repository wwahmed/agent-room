import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Room } from '@agent-room/shared';
import {
  attachProject,
  createClient,
  createProject,
  getTaskBoard,
  listProjectCandidates,
  listProjects,
  readProjectDoc,
  type BoardTask,
  type ProjectCandidate,
  type ProjectSummary,
} from '../lib/api.js';
import { boardCountsView, taskLinkKey } from '../lib/projectView.js';
import {
  PENDING_TASK_STATES,
  projectTaskCounts,
  projectTasksForView,
  type PendingTaskState,
  type ProjectTaskSegment,
} from '../lib/projectTasks.js';

// T-18 Project tab. Unattached rooms get a host-only picker; attached
// rooms show the live task board (status/assignee filters) and read-only
// previews of the project's registered docs. All data flows through the
// authenticated server APIs — the browser never sees a filesystem path.

const STATE_LABEL: Record<BoardTask['state'], string> = {
  todo: 'To do',
  in_progress: 'In progress',
  awaiting_review: 'Awaiting review',
  done: 'Done',
  rejected: 'Rejected',
};

// Theme-aware semantic tokens (VA-0044: dark-optimized *-300 classes
// measured 1.45-2.40:1 on light surfaces; --success/--warning/--danger flip
// per theme and clear the floors in both).
const STATE_TONE: Record<BoardTask['state'], string> = {
  todo: 'text-ink-soft bg-surface-softer border-border-faint',
  in_progress: 'text-accent bg-accent-tint border-accent/30',
  awaiting_review: 'text-warning bg-warning-tint border-warning/40',
  done: 'text-success bg-success-tint border-success/40',
  rejected: 'text-danger bg-danger-tint border-danger/40',
};

const COMPLETED_PAGE_SIZE = 40;

interface TaskPreferences {
  roomCode: string;
  segment: ProjectTaskSegment;
  status: 'all' | PendingTaskState;
  assignee: string;
}

function loadTaskPreferences(roomCode: string): TaskPreferences {
  const fallback: TaskPreferences = { roomCode, segment: 'pending', status: 'all', assignee: 'all' };
  try {
    const stored = JSON.parse(localStorage.getItem(`wakichat:project-tasks:${roomCode}`) ?? '{}') as Partial<TaskPreferences>;
    return {
      roomCode,
      segment: stored.segment === 'completed' ? 'completed' : 'pending',
      status: stored.status === 'all' || PENDING_TASK_STATES.includes(stored.status as PendingTaskState)
        ? stored.status as TaskPreferences['status']
        : 'all',
      assignee: typeof stored.assignee === 'string' ? stored.assignee : 'all',
    };
  } catch {
    return fallback;
  }
}

interface Props {
  room: Room;
  isHost: boolean;
  selfName: string;
  onAttached: () => void;
  /** T-71 rail rule: ONE board source. When the parent owns the poll it
   *  passes the tasks here and this panel's own poll stands down. */
  board?: BoardTask[] | null;
  /** True when the shared board fetch failed for this room: the panel must
   *  render a real error with Retry, never a false empty. */
  boardError?: boolean;
  onRetryBoard?: () => void;
}

export function ProjectPanel({ room, isHost, selfName, onAttached, board, boardError, onRetryBoard }: Props) {
  const location = useLocation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [candidates, setCandidates] = useState<ProjectCandidate[]>([]);
  const [tasks, setTasks] = useState<BoardTask[] | null>(null);
  const [pickId, setPickId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskPreferences, setTaskPreferences] = useState<TaskPreferences>(() => loadTaskPreferences(room.code));
  const [completedLimit, setCompletedLimit] = useState(COMPLETED_PAGE_SIZE);
  const [docRole, setDocRole] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ rel: string; content: string; truncated: boolean } | null>(null);
  const handledTaskLinkRef = useRef<string | null>(null);

  useEffect(() => {
    void listProjects().then(setProjects);
    void listProjectCandidates().then(setCandidates);
  }, []);

  useEffect(() => {
    // T-71: when the parent supplies the board (shared source with the
    // contextual rail), this panel must not run a second poll.
    if (board !== undefined) return;
    if (!room.projectId) return;
    let cancelled = false;
    const pull = () => {
      getTaskBoard(createClient(), room.code)
        .then(b => { if (!cancelled) setTasks(b.tasks); })
        .catch(() => { if (!cancelled) setTasks([]); });
    };
    pull();
    const id = window.setInterval(pull, 30_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [room.code, room.projectId, board !== undefined]);

  useEffect(() => {
    // null propagates: a failed shared fetch must render the ERROR state,
    // never coerce into an empty board (false zero).
    if (board !== undefined) setTasks(board);
  }, [board]);

  useEffect(() => {
    setTaskPreferences(loadTaskPreferences(room.code));
    setCompletedLimit(COMPLETED_PAGE_SIZE);
  }, [room.code]);

  useEffect(() => {
    if (taskPreferences.roomCode !== room.code) return;
    localStorage.setItem(`wakichat:project-tasks:${room.code}`, JSON.stringify({
      segment: taskPreferences.segment,
      status: taskPreferences.status,
      assignee: taskPreferences.assignee,
    }));
  }, [room.code, taskPreferences]);

  useEffect(() => {
    if (!room.projectId || !docRole) { setDoc(null); return; }
    let cancelled = false;
    void readProjectDoc(room.projectId, docRole).then(d => {
      if (!cancelled) setDoc(d ? { rel: d.rel, content: d.content, truncated: d.truncated } : null);
    });
    return () => { cancelled = true; };
  }, [room.projectId, docRole]);

  // T-58/T-59: a command-search task hit is a real deep link, not merely a
  // switch to the Project tab. Reveal the correct segment and move focus to it.
  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get('task');
    if (!taskId) {
      // Query cleared: reset the one-shot so re-opening the SAME task (or
      // the same id in another room) focuses again (review item 3).
      handledTaskLinkRef.current = null;
      return;
    }
    if (!tasks) return;
    const linkKey = taskLinkKey(room.code, taskId);
    if (handledTaskLinkRef.current === linkKey) return;
    const target = tasks.find(task => task.id === taskId);
    if (!target) return;
    handledTaskLinkRef.current = linkKey;
    setTaskPreferences({
      roomCode: room.code,
      segment: target.state === 'done' ? 'completed' : 'pending',
      status: 'all',
      assignee: 'all',
    });
    setCompletedLimit(Math.max(COMPLETED_PAGE_SIZE, tasks.length));
    let flashTimer: number | undefined;
    const landTimer = window.setTimeout(() => {
      const el = document.getElementById(`task-${taskId}`);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      el.classList.add('reply-flash');
      flashTimer = window.setTimeout(() => el.classList.remove('reply-flash'), 2000);
    }, 50);
    // Cleanup on room/navigation change: no timer may act on the next state.
    return () => { window.clearTimeout(landTimer); if (flashTimer != null) window.clearTimeout(flashTimer); };
  }, [location.search, room.code, tasks]);

  const project = projects.find(p => p.id === room.projectId);
  const assignees = useMemo(() => {
    const names = new Set<string>();
    for (const t of tasks ?? []) if (t.owner) names.add(t.owner);
    return [...names].sort();
  }, [tasks]);
  const preferences = taskPreferences.roomCode === room.code ? taskPreferences : loadTaskPreferences(room.code);
  const countsView = boardCountsView(tasks);
  const counts = { pending: countsView.pending, completed: countsView.completed };
  const matchingTasks = projectTasksForView(tasks ?? [], preferences.segment, preferences.status, preferences.assignee);
  const visible = preferences.segment === 'completed' ? matchingTasks.slice(0, completedLimit) : matchingTasks;

  function updateTaskPreferences(change: Partial<Omit<TaskPreferences, 'roomCode'>>) {
    setTaskPreferences(current => ({
      ...(current.roomCode === room.code ? current : loadTaskPreferences(room.code)),
      ...change,
      roomCode: room.code,
    }));
  }

  async function doAttach() {
    if (!pickId) return;
    setBusy(true); setError(null);
    try {
      let projectId = pickId;
      if (pickId.startsWith('new:')) {
        // Safe creation path: the value is a server-issued candidate key,
        // never a filesystem path from the browser.
        const created = await createProject(pickId.slice(4));
        projectId = created.id;
      }
      await attachProject(createClient(), room.code, projectId, { requesterName: selfName });
      onAttached();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!room.projectId) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-transparent p-4">
        <p className="text-[16px] font-semibold text-ink">No project attached</p>
        <p className="mb-3 mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">
          Attaching a project gives this room's task board a durable ledger in
          the project repository.
        </p>
        {isHost ? (
          <>
            <select
              value={pickId}
              onChange={e => setPickId(e.target.value)}
              className="mb-2 h-11 w-full rounded-lg border border-border bg-surface px-2 text-sm font-semibold text-ink outline-none focus:border-accent"
            >
              <option value="">Choose a project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
              {candidates.length > 0 && (
                <optgroup label="Create from a discovered repo">
                  {candidates.map(c => <option key={c.key} value={`new:${c.key}`}>{c.dirName} — new project</option>)}
                </optgroup>
              )}
            </select>
            <button
              onClick={() => { void doAttach(); }}
              disabled={!pickId || busy}
              className="min-h-11 w-full rounded-lg bg-accent px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Attaching…' : 'Attach project'}
            </button>
            {error && <div className="mt-2 text-sm text-red-400 lg:text-xs">{error}</div>}
          </>
        ) : (
          <div className="rounded-lg border border-border-faint bg-surface-softer p-3 text-[15px] text-ink-soft sm:text-[14px]">
            Attaching is a host control. Ask the host to pick a project.
          </div>
        )}
      </div>
    );
  }

  const evidenceLine = (t: BoardTask): string | null => {
    if (t.state === 'done') return t.verifiedBy ? `Verified by ${t.verifiedBy}` : 'Verified';
    if (t.state === 'awaiting_review') return t.verifier ? `Submitted, awaiting ${t.verifier}` : 'Submitted, awaiting review';
    if (t.state === 'rejected') return t.verifier ? `Rejected by ${t.verifier}: needs another pass` : 'Rejected: needs another pass';
    return null;
  };

  return (
    <div>
      {/* The BOARD is the primary work surface (design lead): switch, then
          filters, then rows. Project metadata and docs sit below, quiet. */}
      <div className="mb-3 grid grid-cols-2 rounded-xl border border-border bg-surface-sunken p-1" role="tablist" aria-label="Task views">
        {(['pending', 'completed'] as const).map(segment => (
          <button
            key={segment}
            type="button"
            role="tab"
            aria-selected={preferences.segment === segment}
            aria-controls="project-task-list"
            disabled={tasks === null}
            onClick={() => { updateTaskPreferences({ segment }); setCompletedLimit(COMPLETED_PAGE_SIZE); }}
            className={`min-h-11 rounded-lg px-3 text-[15px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:text-[14px] ${preferences.segment === segment ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}
          >
            {segment === 'pending' ? 'Pending' : 'Completed'}
            {/* Unknown is UNKNOWN: no count pill until the board loads —
                a zero from null is a false empty (review item 1). */}
            {tasks !== null && (
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[13px] ${preferences.segment === segment ? 'bg-accent-tint text-accent' : 'bg-surface-softer text-ink-faint'}`}>
                {counts[segment]}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-1.5">
        {preferences.segment === 'pending' && (
          <select
            value={preferences.status}
            onChange={event => updateTaskPreferences({ status: event.target.value as TaskPreferences['status'] })}
            aria-label="Filter pending tasks by status"
            disabled={tasks === null}
            className="disabled:opacity-50 h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-[15px] font-semibold text-ink outline-none focus:border-accent sm:text-[14px]"
          >
            <option value="all">All pending stages</option>
            {PENDING_TASK_STATES.map(state => <option key={state} value={state}>{STATE_LABEL[state]}</option>)}
          </select>
        )}
        <select
          value={preferences.assignee}
          onChange={event => updateTaskPreferences({ assignee: event.target.value })}
          aria-label="Filter by assignee"
          disabled={tasks === null}
          className="disabled:opacity-50 h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-[15px] font-semibold text-ink outline-none focus:border-accent sm:text-[14px]"
        >
          <option value="all">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div id="project-task-list" role="tabpanel" className="space-y-2" aria-live="polite">
        {tasks === null && !boardError && (
          <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-lg border border-border-faint bg-surface-softer px-3 py-2.5 text-[15px] text-ink-soft sm:text-[14px]">
            <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent motion-reduce:animate-none" aria-hidden="true" />
            Loading the task board…
          </div>
        )}
        {tasks === null && boardError && (
          <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/5 p-4">
            <p className="text-[15px] font-semibold text-red-400 sm:text-[14px]">Couldn't load the task board</p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">The board didn't respond, so tasks can't be shown right now.</p>
            {onRetryBoard && (
              <button
                type="button"
                onClick={onRetryBoard}
                className="mt-3 flex min-h-11 w-fit items-center rounded-lg border border-border px-4 text-sm font-semibold text-ink-soft transition hover:border-accent hover:text-accent"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {tasks !== null && tasks.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-transparent p-4">
            <p className="text-[16px] font-semibold text-ink-soft">No tasks yet</p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">Work created in this room will appear here as agents claim, build, and submit it.</p>
          </div>
        )}
        {tasks !== null && tasks.length > 0 && matchingTasks.length === 0 && (
          <div className="rounded-lg border border-border-faint bg-surface-softer p-4">
            <p className="text-[15px] text-ink-soft sm:text-[14px]">
              {preferences.segment === 'pending' ? 'No pending tasks match these filters.' : 'No completed tasks match this filter.'}
            </p>
            <button
              type="button"
              onClick={() => updateTaskPreferences({ status: 'all', assignee: 'all' })}
              className="mt-2 flex min-h-11 w-fit items-center rounded-lg border border-border px-4 text-sm font-semibold text-ink-soft transition hover:border-accent hover:text-accent"
            >
              Clear filters
            </button>
          </div>
        )}
        {visible.map(t => (
          <div id={`task-${t.id}`} key={t.id} tabIndex={-1} className="rounded-xl border border-border-faint bg-surface-softer p-3.5 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-accent">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[14px] font-bold text-ink">{t.id}</span>
              <span className={`rounded border px-1.5 py-px text-[13px] font-semibold ${STATE_TONE[t.state]}`}>{STATE_LABEL[t.state]}</span>
            </div>
            <div className="text-[16px] font-semibold leading-snug text-ink">{t.title}</div>
            <div className="mt-1 text-[15px] text-ink-soft sm:text-[14px]">
              {t.owner ? t.owner : 'Unowned'}
              {t.verifier ? ` \u2192 ${t.verifier}` : ''}
            </div>
            {evidenceLine(t) && (
              <div className="mt-0.5 text-[15px] font-medium sm:text-[14px]">
                <span className={t.state === 'rejected' ? 'text-danger' : t.state === 'done' ? 'text-success' : 'text-warning'}>{evidenceLine(t)}</span>
              </div>
            )}
            {t.note && <div className="mt-1.5 line-clamp-3 text-[15px] leading-relaxed text-ink-soft sm:text-[14px]">{t.note}</div>}
          </div>
        ))}
        {preferences.segment === 'completed' && visible.length < matchingTasks.length && (
          <button
            type="button"
            onClick={() => setCompletedLimit(limit => limit + COMPLETED_PAGE_SIZE)}
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-[14px] font-semibold text-ink-soft hover:bg-surface-softer hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Load {Math.min(COMPLETED_PAGE_SIZE, matchingTasks.length - visible.length)} more completed tasks
          </button>
        )}
      </div>

      {/* Quiet, secondary: project identity + read-only docs. */}
      <div className="mt-6 border-t border-border-faint pt-4">
        <h3 className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-ink-faint">About this project</h3>
        <div className="text-[15px] font-semibold text-ink sm:text-[14px]">{project?.name ?? room.projectId}</div>
        <div className="text-[14px] text-ink-faint">Tasks sync to the repo ledger on every board change.</div>
        {project && project.docs.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-1.5">
              {project.docs.map(role => (
                <button
                  key={role}
                  onClick={() => setDocRole(prev => prev === role ? null : role)}
                  className={`min-h-11 rounded-lg border px-2.5 text-[14px] font-semibold transition ${docRole === role ? 'border-accent bg-accent-tint text-accent' : 'border-border bg-surface-softer text-ink-soft hover:text-ink'}`}
                >
                  {role}
                </button>
              ))}
            </div>
            {docRole && doc && (
              <div className="mt-2 rounded-lg border border-border-faint bg-surface-sunken p-3">
                <div className="mb-1.5 text-[13px] text-ink-faint">{doc.rel}{doc.truncated ? ' (truncated preview)' : ''}, read-only</div>
                <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-muted">{doc.content || '(empty)'}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
