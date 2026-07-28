import { describe, expect, it } from 'vitest';

import { boardDigest } from '../src/boardDigest.js';
import { readFileSync } from 'node:fs';

const tools = readFileSync(new URL('../src/tools.ts', import.meta.url), 'utf8');

const EVIDENCE = {
  fileListing: 'x'.repeat(4000),
  fileExcerpt: 'y'.repeat(4000),
  runOutput: 'z'.repeat(9000),
  exitCode: 0,
};

function task(id: string, state: string, extra: Record<string, unknown> = {}) {
  return { id, state, title: `Task ${id}`, owner: 'OpusCoder', verifier: 'CodexArchitect', evidence: EVIDENCE, ...extra };
}

// T-35: a board write must be readable by the agent that made it. Returning the
// whole board attached evidence for every task and blew the caller's tool-result
// budget on all six board writes in one session.
describe('Board digest — a mutation reply stays small enough to read', () => {
  it('drops evidence entirely while keeping what orients a reader', () => {
    const board = { tasks: [task('T-01', 'done', { liveRef: 'abc1234' }), task('T-02', 'awaiting_review')] };
    const d = boardDigest(board);
    const json = JSON.stringify(d);
    expect(json).not.toContain('x'.repeat(50));
    expect(json).not.toContain('runOutput');
    expect(d.tasks[0]).toEqual({
      id: 'T-01', state: 'done', title: 'Task T-01',
      owner: 'OpusCoder', verifier: 'CodexArchitect', liveRef: 'abc1234',
    });
    // "is it live" is the next question a board reader has, and a SHA is cheap.
    expect(d.tasks[1]?.liveRef).toBeUndefined();
  });

  it('is dramatically smaller than the board it summarizes', () => {
    const board = { tasks: Array.from({ length: 34 }, (_, i) => task(`T-${i + 1}`, 'awaiting_review')) };
    const full = JSON.stringify(board).length;
    const small = JSON.stringify(boardDigest(board)).length;
    // The real board that triggered this was ~100k; the digest must be orders of
    // magnitude smaller, not merely trimmed.
    expect(full).toBeGreaterThan(500_000);
    expect(small).toBeLessThan(5_000);
    expect(small * 50).toBeLessThan(full);
  });

  it('counts by state and survives a junk board without throwing', () => {
    const d = boardDigest({ tasks: [task('T-01', 'done'), task('T-02', 'done'), task('T-03', 'todo')] });
    expect(d.counts).toEqual({ done: 2, todo: 1 });
    expect(d.total).toBe(3);
    // A missing/!array board is empty, never a crash — a digest must not be the
    // thing that breaks a successful board write.
    expect(boardDigest(undefined)).toEqual({ counts: {}, total: 0, tasks: [] });
    expect(boardDigest({ tasks: 'nope' as unknown })).toEqual({ counts: {}, total: 0, tasks: [] });
    // A task with no state still counts, under an honest label.
    expect(boardDigest({ tasks: [{ id: 'T-9' }] }).counts).toEqual({ unknown: 1 });
  });

  it('caps a pathological title so one row cannot undo the whole point', () => {
    const d = boardDigest({ tasks: [task('T-01', 'todo', { title: 'T'.repeat(5000) })] });
    expect(d.tasks[0]?.title.length).toBe(120);
  });

  it('every board MUTATION uses the digest, and room_task_list still does not', () => {
    // Four mutations: create, claim, submit, verify.
    expect(tools.split('board: boardDigest(board)').length - 1).toBe(4);
    expect(tools).not.toContain('return ok({ task, board });');
    // The verifier ruling on a submission needs the real evidence, so the
    // explicit "list the board" call is deliberately left alone.
    expect(tools).toContain('return ok({ board: await getTaskBoard(client, a.code) });');
  });
});
