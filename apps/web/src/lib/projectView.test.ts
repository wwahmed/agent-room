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

describe('projectViewState (five mutually exclusive states)', () => {
  it('distinguishes every state', () => {
    expect(projectViewState(false, null, false, 0)).toBe('unattached');
    expect(projectViewState(true, null, false, 0)).toBe('loading');
    expect(projectViewState(true, null, true, 0)).toBe('error');
    expect(projectViewState(true, [], false, 0)).toBe('genuine-empty');
    expect(projectViewState(true, [task('todo')], false, 0)).toBe('filtered-empty');
    expect(projectViewState(true, [task('todo')], false, 1)).toBe('populated');
  });
  it('error never masquerades as empty', () => {
    expect(projectViewState(true, null, true, 0)).not.toBe('genuine-empty');
  });
});

describe('taskLinkKey (re-entry and cross-room identity)', () => {
  it('keys by room AND task; clearing resets to null', () => {
    expect(taskLinkKey('AAA', 'T-5')).toBe('AAA|T-5');
    expect(taskLinkKey('BBB', 'T-5')).not.toBe(taskLinkKey('AAA', 'T-5'));
    expect(taskLinkKey('AAA', null)).toBeNull();
  });
});
