import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Room } from '@agent-room/shared';

interface SearchHit {
  type: 'room' | 'message' | 'task';
  roomCode: string;
  title: string;
  snippet?: string;
  messageId?: string | number;
  taskId?: string;
  score: number;
}

interface Props {
  open: boolean;
  room: Room;
  onClose: () => void;
  onMessage: (id: string | number) => void;
  onTask: (id?: string) => void;
}

export function CommandSearch({ open, room, onClose, onMessage, onTask }: Props) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setHits([]);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      returnFocusRef.current?.focus();
    };
  }, [open, room.code, room.projectId]);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setHits([]); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ q: query.trim(), room: room.code });
    const timer = window.setTimeout(() => {
      void fetch(`/api/search?${params}`, { credentials: 'same-origin', signal: controller.signal })
        .then(response => response.ok ? response.json() : { hits: [] })
        .then((body: { hits?: SearchHit[] }) => setHits(body.hits ?? []))
        .catch(error => { if ((error as Error).name !== 'AbortError') setHits([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 100);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, room.code]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter(element => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [onClose, open]);

  const normalized = query.trim();
  const matchingRooms = useMemo(() => hits.filter(hit => hit.type === 'room'), [hits]);
  const matchingMessages = useMemo(() => hits.filter(hit => hit.type === 'message'), [hits]);
  const matchingTasks = useMemo(() => hits.filter(hit => hit.type === 'task'), [hits]);
  const noResults = normalized.length >= 2 && !loading && hits.length === 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/45 px-3 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search WakiChat" className="command-search-palette absolute left-1/2 top-1.5 w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-xl border border-accent/30 bg-surface shadow-2xl">
        <label className="flex h-14 items-center gap-3 border-b border-border-faint px-4">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="flex-shrink-0 text-ink-soft" aria-hidden="true">
            <circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3 3" />
          </svg>
          <span className="sr-only">Search rooms, messages, and tasks</span>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search rooms, messages, tasks…"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="rounded-md border border-border-faint bg-surface-softer px-1.5 py-0.5 text-[12px] font-medium text-ink-soft">Esc</kbd>
        </label>
        <div className="max-h-[min(62vh,560px)] overflow-y-auto p-2">
          {matchingRooms.length > 0 && <ResultGroup label="Rooms">
            {matchingRooms.map(result => <ResultButton key={`room-${result.roomCode}`} title={result.title} detail={result.roomCode} icon="R" onClick={() => { onClose(); navigate(`/r/${result.roomCode}`); }} />)}
          </ResultGroup>}
          {matchingMessages.length > 0 && <ResultGroup label="Messages">
            {matchingMessages.map(message => <ResultButton key={`message-${message.messageId}`} title={message.title} detail={message.snippet ?? room.topic} icon="M" onClick={() => { if (message.messageId == null) return; onClose(); onMessage(message.messageId); }} />)}
          </ResultGroup>}
          {matchingTasks.length > 0 && <ResultGroup label="Tasks">
            {matchingTasks.map(task => <ResultButton key={`task-${task.taskId}`} title={task.title} detail={task.snippet ?? task.taskId ?? 'Project task'} icon="T" onClick={() => { onClose(); onTask(task.taskId); }} />)}
          </ResultGroup>}
          {normalized.length < 2 && (
            <div className="px-4 py-10 text-center text-[13px] text-ink-faint">Type at least two characters to search rooms, this room’s messages, and project tasks.</div>
          )}
          {loading && <div role="status" className="flex items-center justify-center gap-2 px-4 py-8 text-[13px] text-ink-faint"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />Searching…</div>}
          {noResults && <div className="px-4 py-10 text-center text-[13px] text-ink-faint">No rooms, messages, or tasks match “{query}”.</div>}
        </div>
      </section>
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ResultButton({ title, detail, icon, onClick }: { title: string; detail: string; icon: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-softer focus-visible:bg-accent-tint focus-visible:outline-none">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-softer text-[12px] font-semibold text-ink-soft" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[12px] text-ink-faint">{detail}</span>
      </span>
    </button>
  );
}
