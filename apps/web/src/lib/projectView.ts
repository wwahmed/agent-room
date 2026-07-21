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

/** The five distinct board states, mutually exclusive by construction. */
export function projectViewState(
  attached: boolean,
  tasks: BoardTask[] | null,
  error: boolean,
  matching: number,
): ProjectView {
  if (!attached) return 'unattached';
  if (tasks === null) return error ? 'error' : 'loading';
  if (tasks.length === 0) return 'genuine-empty';
  return matching === 0 ? 'filtered-empty' : 'populated';
}

/** Deep-link one-shot identity: room + task. Clearing the param resets it
 *  (null), so re-opening the same task — or the same id in another room —
 *  focuses again (review item 3). */
export function taskLinkKey(code: string, taskId: string | null): string | null {
  return taskId ? `${code}|${taskId}` : null;
}
