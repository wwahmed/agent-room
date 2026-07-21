import type { BoardTask } from './api.js';

export type ProjectTaskSegment = 'pending' | 'completed';
export type PendingTaskState = Exclude<BoardTask['state'], 'done'>;

export const PENDING_TASK_STATES: PendingTaskState[] = [
  'rejected',
  'awaiting_review',
  'in_progress',
  'todo',
];

const PENDING_RANK = new Map(PENDING_TASK_STATES.map((state, index) => [state, index]));

function activityAt(task: BoardTask): number {
  return task.verifiedAt ?? task.submittedAt ?? task.createdAt ?? 0;
}

function newestFirst(left: BoardTask, right: BoardTask): number {
  return activityAt(right) - activityAt(left) || right.id.localeCompare(left.id, undefined, { numeric: true });
}

export function projectTaskCounts(tasks: BoardTask[]): { pending: number; completed: number } {
  const completed = tasks.filter(task => task.state === 'done').length;
  return { pending: tasks.length - completed, completed };
}

export function projectTasksForView(
  tasks: BoardTask[],
  segment: ProjectTaskSegment,
  status: 'all' | PendingTaskState,
  assignee: string,
): BoardTask[] {
  return tasks
    .filter(task => segment === 'completed' ? task.state === 'done' : task.state !== 'done')
    .filter(task => segment === 'completed' || status === 'all' || task.state === status)
    .filter(task => assignee === 'all' || task.owner === assignee)
    .sort((left, right) => {
      if (segment === 'completed') return newestFirst(left, right);
      const rank = (PENDING_RANK.get(left.state as PendingTaskState) ?? 99)
        - (PENDING_RANK.get(right.state as PendingTaskState) ?? 99);
      return rank || newestFirst(left, right);
    });
}
