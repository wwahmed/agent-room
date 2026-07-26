import type { BoardTask } from './api.js';

// T-71 Project rev2: pure view rules the review demanded tests for.

/** Unknown is UNKNOWN: a null board renders no counts and disables the
 *  segment/filters — never a numeric zero from absence (review item 1). */
export function boardCountsView(tasks: BoardTask[] | null): { known: boolean; pending: number; completed: number } {
  if (tasks === null) return { known: false, pending: 0, completed: 0 };
  const completed = tasks.filter(t => t.state === 'done').length;
  return { known: true, pending: tasks.length - completed, completed };
}

export type ProjectView = 'loading' | 'error' | 'unattached' | 'genuine-empty' | 'filtered-empty' | 'populated';

/** The distinct board states, mutually exclusive by construction.
 *
 *  Un-gated board (host order): tasks exist wherever agents filed them — a
 *  bound project only adds the durable repo ledger. So attachment gates the
 *  PITCH, not the queue: 'unattached' is reserved for a room that is known
 *  to have no tasks AND no project (pitch attaching); the moment tasks
 *  exist, the board renders regardless. Unknown stays unknown — a null
 *  board is loading/error, never a premature pitch over a queue that may
 *  have tickets. */
export function projectViewState(
  attached: boolean,
  tasks: BoardTask[] | null,
  error: boolean,
  matching: number,
): ProjectView {
  if (tasks === null) return error ? 'error' : 'loading';
  if (tasks.length === 0) return attached ? 'genuine-empty' : 'unattached';
  return matching === 0 ? 'filtered-empty' : 'populated';
}

/** Deep-link one-shot identity: room + task. Clearing the param resets it
 *  (null), so re-opening the same task — or the same id in another room —
 *  focuses again (review item 3). */
export function taskLinkKey(code: string, taskId: string | null): string | null {
  return taskId ? `${code}|${taskId}` : null;
}
