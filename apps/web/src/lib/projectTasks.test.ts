import { describe, expect, it } from 'vitest';
import type { BoardTask } from './api.js';
import { projectTaskCounts, projectTasksForView } from './projectTasks.js';

const tasks: BoardTask[] = [
  { id: 'T-01', title: 'Old done', state: 'done', createdBy: 'A', owner: 'A', verifiedAt: 10 },
  { id: 'T-02', title: 'Todo', state: 'todo', createdBy: 'A', owner: 'B', createdAt: 20 },
  { id: 'T-03', title: 'Review', state: 'awaiting_review', createdBy: 'A', owner: 'A', submittedAt: 30 },
  { id: 'T-04', title: 'Rejected', state: 'rejected', createdBy: 'A', owner: 'A', verifiedAt: 40 },
  { id: 'T-05', title: 'Doing', state: 'in_progress', createdBy: 'A', owner: 'B', createdAt: 50 },
  { id: 'T-06', title: 'New done', state: 'done', createdBy: 'A', owner: 'B', verifiedAt: 60 },
];

describe('project task views', () => {
  it('counts pending work separately from the completed archive', () => {
    expect(projectTaskCounts(tasks)).toEqual({ pending: 4, completed: 2 });
  });

  it('sorts pending work in facilitator urgency order', () => {
    expect(projectTasksForView(tasks, 'pending', 'all', 'all').map(task => task.id))
      .toEqual(['T-04', 'T-03', 'T-05', 'T-02']);
  });

  it('filters only the active pending view', () => {
    expect(projectTasksForView(tasks, 'pending', 'rejected', 'A').map(task => task.id)).toEqual(['T-04']);
    expect(projectTasksForView(tasks, 'completed', 'rejected', 'all').map(task => task.id)).toEqual(['T-06', 'T-01']);
  });
});
