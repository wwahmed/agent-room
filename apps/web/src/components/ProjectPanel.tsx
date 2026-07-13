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
  const [statusFilter, setStatusFilter] = useState<'all' | BoardTask['state']>('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
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

  const visible = (tasks ?? []).filter(t =>
    (statusFilter === 'all' || t.state === statusFilter) &&
    (assigneeFilter === 'all' || t.owner === assigneeFilter),
  );

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
        <div className="mb-2 text-[10px] font-semibold uppercase text-ink-faint">Project</div>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
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
            {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
          </>
        ) : (
          <div className="rounded-lg border border-border-faint bg-surface-softer p-3 text-xs text-ink-soft">
            Only the host can attach a project.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-1 text-[10px] font-semibold uppercase text-ink-faint">Project</div>
      <div className="mb-3">
        <div className="text-sm font-semibold">{project?.name ?? room.projectId}</div>
        <div className="text-[11px] text-ink-faint">id: {room.projectId} · tasks sync to the repo ledger on every board change</div>
      </div>

      {project && project.docs.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-ink-faint">Documents</div>
          <div className="flex flex-wrap gap-1.5">
            {project.docs.map(role => (
              <button
                key={role}
                onClick={() => setDocRole(prev => prev === role ? null : role)}
                className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold transition ${docRole === role ? 'border-accent bg-accent-tint text-accent' : 'border-border bg-surface-softer text-ink-muted hover:text-ink'}`}
              >
                {role}
              </button>
            ))}
          </div>
          {docRole && doc && (
            <div className="mt-2 rounded-lg border border-border-faint bg-surface-sunken p-3">
              <div className="mb-1.5 text-[10px] text-ink-faint">{doc.rel}{doc.truncated ? ' · truncated preview' : ''} · read-only</div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-muted">{doc.content || '(empty)'}</pre>
            </div>
          )}
        </div>
      )}

      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase text-ink-faint">Tasks {tasks ? `· ${visible.length}/${tasks.length}` : ''}</div>
      </div>
      <div className="mb-2 flex gap-1.5">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by status"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-xs font-semibold text-ink outline-none"
        >
          <option value="all">All statuses</option>
          {Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select
          value={assigneeFilter}
          onChange={e => setAssigneeFilter(e.target.value)}
          aria-label="Filter by assignee"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-xs font-semibold text-ink outline-none"
        >
          <option value="all">All assignees</option>
          {assignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {tasks === null && <div className="text-xs text-ink-soft">Loading…</div>}
        {tasks !== null && visible.length === 0 && (
          <div className="rounded-lg border border-border-faint bg-surface-softer p-3 text-xs text-ink-soft">No tasks match.</div>
        )}
        {visible.map(t => (
          <div key={t.id} className="rounded-lg border border-border-faint bg-surface-softer p-3">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[11px] font-bold text-ink">{t.id}</span>
              <span className={`rounded border px-1.5 py-px text-[9px] font-semibold ${STATE_TONE[t.state]}`}>{STATE_LABEL[t.state]}</span>
            </div>
            <div className="text-xs font-semibold leading-snug">{t.title}</div>
            <div className="mt-1 text-[10px] text-ink-faint">
              {t.owner ? `owner ${t.owner}` : 'unowned'}{t.verifier ? ` · verifier ${t.verifier}` : ''}
            </div>
            {t.note && <div className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-ink-soft">{t.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
