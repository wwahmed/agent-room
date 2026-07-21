import { useEffect, useMemo, useState } from 'react';
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

const STATE_TONE: Record<BoardTask['state'], string> = {
  todo: 'text-ink-soft bg-surface-softer border-border-faint',
  in_progress: 'text-blue-300 bg-blue-500/10 border-blue-400/30',
  awaiting_review: 'text-amber-300 bg-amber-500/10 border-amber-400/30',
  done: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30',
  rejected: 'text-red-300 bg-red-500/10 border-red-400/30',
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
}

export function ProjectPanel({ room, isHost, selfName, onAttached }: Props) {
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

  useEffect(() => {
    void listProjects().then(setProjects);
    void listProjectCandidates().then(setCandidates);
  }, []);

  useEffect(() => {
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
  }, [room.code, room.projectId]);

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

  const project = projects.find(p => p.id === room.projectId);
  const assignees = useMemo(() => {
    const names = new Set<string>();
    for (const t of tasks ?? []) if (t.owner) names.add(t.owner);
    return [...names].sort();
  }, [tasks]);
  const preferences = taskPreferences.roomCode === room.code ? taskPreferences : loadTaskPreferences(room.code);
  const counts = projectTaskCounts(tasks ?? []);
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
      <div className="p-4">
        <div className="mb-2 text-xs font-semibold uppercase text-ink-faint">Project</div>
        <p className="mb-3 text-sm leading-relaxed text-ink-soft lg:text-xs">
          This room is not attached to a project yet. Attaching one gives its
          task board a durable Markdown ledger in the project repository.
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
          <div className="rounded-lg border border-border-faint bg-surface-softer p-3 text-sm text-ink-soft lg:text-xs">
            Only the host can attach a project.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-1 text-xs font-semibold uppercase text-ink-faint">Project</div>
      <div className="mb-3">
        <div className="text-sm font-semibold">{project?.name ?? room.projectId}</div>
        <div className="text-xs text-ink-faint">id: {room.projectId} · tasks sync to the repo ledger on every board change</div>
      </div>

      {project && project.docs.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold uppercase text-ink-faint">Documents</div>
          <div className="flex flex-wrap gap-1.5">
            {project.docs.map(role => (
              <button
                key={role}
                onClick={() => setDocRole(prev => prev === role ? null : role)}
                className={`min-h-11 rounded-lg border px-2.5 text-sm font-semibold transition lg:min-h-9 lg:text-xs ${docRole === role ? 'border-accent bg-accent-tint text-accent' : 'border-border bg-surface-softer text-ink-muted hover:text-ink'}`}
              >
                {role}
              </button>
            ))}
          </div>
          {docRole && doc && (
            <div className="mt-2 rounded-lg border border-border-faint bg-surface-sunken p-3">
              <div className="mb-1.5 text-xs text-ink-faint">{doc.rel}{doc.truncated ? ' · truncated preview' : ''} · read-only</div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">{doc.content || '(empty)'}</pre>
            </div>
          )}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint">Tasks</div>
      </div>
      <div className="mb-3 grid grid-cols-2 rounded-xl border border-border bg-surface-sunken p-1" role="tablist" aria-label="Task views">
        {(['pending', 'completed'] as const).map(segment => (
          <button
            key={segment}
            type="button"
            role="tab"
            aria-selected={preferences.segment === segment}
            aria-controls="project-task-list"
            onClick={() => { updateTaskPreferences({ segment }); setCompletedLimit(COMPLETED_PAGE_SIZE); }}
            className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${preferences.segment === segment ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}
          >
            {segment === 'pending' ? 'Pending' : 'Completed'}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[12px] ${preferences.segment === segment ? 'bg-accent-tint text-accent' : 'bg-surface-softer text-ink-faint'}`}>
              {counts[segment]}
            </span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-1.5">
        {preferences.segment === 'pending' && (
          <select
            value={preferences.status}
            onChange={event => updateTaskPreferences({ status: event.target.value as TaskPreferences['status'] })}
            aria-label="Filter pending tasks by status"
            className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-[13px] font-semibold text-ink outline-none focus:border-accent"
          >
            <option value="all">All pending stages</option>
            {PENDING_TASK_STATES.map(state => <option key={state} value={state}>{STATE_LABEL[state]}</option>)}
          </select>
        )}
        <select
          value={preferences.assignee}
          onChange={event => updateTaskPreferences({ assignee: event.target.value })}
          aria-label="Filter by assignee"
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-[13px] font-semibold text-ink outline-none focus:border-accent"
        >
          <option value="all">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div id="project-task-list" role="tabpanel" className="space-y-2" aria-live="polite">
        {tasks === null && (
          // T-30: an intentional loading state, not a bare tiny string.
          <div role="status" aria-live="polite" className="flex items-center gap-2.5 rounded-lg border border-border-faint bg-surface-softer px-3 py-2.5 text-sm text-ink-soft">
            <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent motion-reduce:animate-none" aria-hidden="true" />
            Loading the task board…
          </div>
        )}
        {tasks !== null && matchingTasks.length === 0 && (
          <div className="rounded-lg border border-border-faint bg-surface-softer p-3 text-sm text-ink-soft">
            {preferences.segment === 'pending' ? 'No pending tasks match these filters.' : 'No completed tasks match this filter.'}
          </div>
        )}
        {visible.map(t => (
          <div key={t.id} className="rounded-lg border border-border-faint bg-surface-softer p-3">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-ink">{t.id}</span>
              <span className={`rounded border px-1.5 py-px text-[12px] font-semibold ${STATE_TONE[t.state]}`}>{STATE_LABEL[t.state]}</span>
            </div>
            <div className="text-sm font-semibold leading-snug lg:text-xs">{t.title}</div>
            <div className="mt-1 text-xs text-ink-faint">
              {t.owner ? `owner ${t.owner}` : 'unowned'}{t.verifier ? ` · verifier ${t.verifier}` : ''}
            </div>
            {t.note && <div className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-ink-soft">{t.note}</div>}
          </div>
        ))}
        {preferences.segment === 'completed' && visible.length < matchingTasks.length && (
          <button
            type="button"
            onClick={() => setCompletedLimit(limit => limit + COMPLETED_PAGE_SIZE)}
            className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-ink-soft hover:bg-surface-softer hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Load {Math.min(COMPLETED_PAGE_SIZE, matchingTasks.length - visible.length)} more completed tasks
          </button>
        )}
      </div>
    </div>
  );
}
