import { describe, expect, it } from 'vitest';
import type { BoardTask } from './api.js';
import { boardCountsView, projectViewState, taskLinkKey } from './projectView.js';

const task = (state: BoardTask['state']): BoardTask => ({ id: 'T-1', title: 'x', state, createdBy: 'a' });

describe('boardCountsView (no zeros from null)', () => {
  it('a null board is UNKNOWN, not zero', () => {
    expect(boardCountsView(null).known).toBe(false);
  });
  it('a loaded board counts done as completed, rest pending', () => {
    expect(boardCountsView([task('done'), task('todo'), task('awaiting_review')])).toEqual({ known: true, pending: 2, completed: 1 });
  });
});

describe('projectViewState (mutually exclusive states)', () => {
  it('distinguishes every state', () => {
    expect(projectViewState(false, [], false, 0)).toBe('unattached');
    expect(projectViewState(true, null, false, 0)).toBe('loading');
    expect(projectViewState(true, null, true, 0)).toBe('error');
    expect(projectViewState(true, [], false, 0)).toBe('genuine-empty');
    expect(projectViewState(true, [task('todo')], false, 0)).toBe('filtered-empty');
    expect(projectViewState(true, [task('todo')], false, 1)).toBe('populated');
  });
  it('error never masquerades as empty', () => {
    expect(projectViewState(true, null, true, 0)).not.toBe('genuine-empty');
  });
  it('the board is UN-GATED: tasks render regardless of project attachment (host order)', () => {
    // A project-less room with tasks shows the queue, not the attach pitch —
    // the Customer Service desk must see its tickets, project or no project.
    expect(projectViewState(false, [task('todo')], false, 1)).toBe('populated');
    expect(projectViewState(false, [task('todo')], false, 0)).toBe('filtered-empty');
    // Unknown stays unknown: no premature pitch over a queue that may have tickets.
    expect(projectViewState(false, null, false, 0)).toBe('loading');
    expect(projectViewState(false, null, true, 0)).toBe('error');
    // The pitch is reserved for known-empty AND project-less.
    expect(projectViewState(false, [], false, 0)).toBe('unattached');
  });
});

describe('taskLinkKey (re-entry and cross-room identity)', () => {
  it('keys by room AND task; clearing resets to null', () => {
    expect(taskLinkKey('AAA', 'T-5')).toBe('AAA|T-5');
    expect(taskLinkKey('BBB', 'T-5')).not.toBe(taskLinkKey('AAA', 'T-5'));
    expect(taskLinkKey('AAA', null)).toBeNull();
  });
});
