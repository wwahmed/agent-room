import { describe, expect, it } from 'vitest';
import type { RoomArtifact } from '@agent-room/shared';
import { artifactsForRoom, hasLineMarker, outputsViewState, producedWorkOf, railSectionCount, isCurrentSeek, seekPageBudget, seekStep } from './outputsState.js';

const art = (kind: RoomArtifact['kind']): RoomArtifact => ({ id: '1-0', kind, text: 'x', sourceMessageId: 1, author: 'A', time: 1 });

describe('outputs view state (rev15 failure modes)', () => {
  it('initial load is Loading, never a false zero', () => {
    expect(outputsViewState(null, false)).toBe('loading');
  });
  it('fetch failure with no data is the error state; data beats a refresh error', () => {
    expect(outputsViewState(null, true)).toBe('error');
    expect(outputsViewState([], true)).toBe('ready');
  });
  it("room switch: stale data is unrenderable while the next room loads", () => {
    const state = { room: 'AAA', artifacts: [art('decision')] };
    expect(artifactsForRoom(state, 'AAA')).toHaveLength(1);
    expect(artifactsForRoom(state, 'BBB')).toBeNull();
    expect(outputsViewState(artifactsForRoom(state, 'BBB'), false)).toBe('loading');
  });
  it('rail: STATUS-only rooms do not count as produced work', () => {
    expect(railSectionCount(2, 0, [art('status'), art('status')])).toBe(1);
    expect(railSectionCount(2, 0, [art('status'), art('result')])).toBe(2);
    expect(producedWorkOf([art('status'), art('decision')])).toHaveLength(1);
  });
  it('marker arrival triggers a refresh; prose mentions do not', () => {
    expect(hasLineMarker(['[DECISION] ship it'])).toBe(true);
    expect(hasLineMarker(['note: the [TODO] tag inline'])).toBe(false);
    expect(hasLineMarker(['first\n[RESULT] later line'])).toBe(true);
  });
});

describe('seekStep (rev17/18: bounded, budgeted source seek)', () => {
  it('finds, waits, and pages in the normal path', () => {
    expect(seekStep(true, true, false, 3, 10)).toBe('found');
    expect(seekStep(false, true, true, 3, 10)).toBe('wait');
    expect(seekStep(false, true, false, 3, 10)).toBe('load-more');
  });
  it('a trimmed source gives up honestly', () => {
    expect(seekStep(false, false, false, 3, 10)).toBe('give-up-trimmed');
  });
  it('the budget is the room\u2019s real page count, and exhausting it is an explicit error', () => {
    expect(seekPageBudget(500, 80)).toBe(9);
    expect(seekPageBudget(0, 80)).toBe(3);
    expect(seekStep(false, true, false, 9, seekPageBudget(500, 80))).toBe('give-up-error');
  });
});

describe('isCurrentSeek (rev19: stale completions are inert)', () => {
  const ticket = { generation: 3, code: 'AAA', target: 42 };
  it('matches only the same generation, room, and target', () => {
    expect(isCurrentSeek(ticket, { generation: 3, code: 'AAA', target: 42 })).toBe(true);
  });
  it('a room switch, a superseding seek, or a cleared seek all invalidate it', () => {
    expect(isCurrentSeek(ticket, { generation: 3, code: 'BBB', target: 42 })).toBe(false);
    expect(isCurrentSeek(ticket, { generation: 4, code: 'AAA', target: 42 })).toBe(false);
    expect(isCurrentSeek(ticket, { generation: 3, code: 'AAA', target: null })).toBe(false);
  });
});
