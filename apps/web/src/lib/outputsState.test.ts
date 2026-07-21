import { describe, expect, it } from 'vitest';
import type { RoomArtifact } from '@agent-room/shared';
import { artifactsForRoom, hasLineMarker, outputsViewState, producedWorkOf, railSectionCount, focusRecoveryCard, isCurrentSeek, isFailedCard, seekExitRecovery, seekFailureReducer, seekPageBudget, seekStep } from './outputsState.js';

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

describe('seekExitRecovery (rev20b: one recovery state, both recoverable exits)', () => {
  it('failed-page and exhausted both produce CARD-keyed recovery, no toast', () => {
    expect(seekExitRecovery('failed-page', '7-0', 7)).toEqual({ recovery: { artifactId: '7-0', sourceMessageId: 7, reason: 'failed-page' }, terminalToast: null });
    expect(seekExitRecovery('give-up-error', '7-0', 7)).toEqual({ recovery: { artifactId: '7-0', sourceMessageId: 7, reason: 'exhausted' }, terminalToast: null });
  });
  it('a trimmed source is TERMINAL: toast, never a retry state', () => {
    const r = seekExitRecovery('give-up-trimmed', '7-0', 7);
    expect(r.recovery).toBeNull();
    expect(r.terminalToast).toContain('no longer available');
  });
  it('success clears everything', () => {
    expect(seekExitRecovery('found', '7-0', 7)).toEqual({ recovery: null, terminalToast: null });
  });
  it('duplicate-source siblings: exactly ONE card wears the failure', () => {
    const { recovery } = seekExitRecovery('failed-page', '5-1', 5);
    expect(isFailedCard(recovery, '5-1')).toBe(true);
    expect(isFailedCard(recovery, '5-0')).toBe(false); // same source, different card
    expect(isFailedCard(null, '5-1')).toBe(false);
  });
});

describe('seekFailureReducer (the full lifecycle transition table)', () => {
  const failed = seekFailureReducer(null, { type: 'exit', exit: 'failed-page', artifactId: '9-0', sourceMessageId: 9 });
  it('recoverable exits enter the failure state', () => {
    expect(failed).toEqual({ artifactId: '9-0', sourceMessageId: 9, reason: 'failed-page' });
    expect(seekFailureReducer(null, { type: 'exit', exit: 'give-up-error', artifactId: '9-0', sourceMessageId: 9 })?.reason).toBe('exhausted');
  });
  it('retry clears', () => {
    expect(seekFailureReducer(failed, { type: 'retry' })).toBeNull();
  });
  it('success clears', () => {
    expect(seekFailureReducer(failed, { type: 'found' })).toBeNull();
  });
  it('room change clears', () => {
    expect(seekFailureReducer(failed, { type: 'room-change' })).toBeNull();
  });
  it('a trimmed exit never enters the failure state', () => {
    expect(seekFailureReducer(failed, { type: 'exit', exit: 'give-up-trimmed', artifactId: '9-0', sourceMessageId: 9 })).toBeNull();
  });
});

describe('focusRecoveryCard (exact-card focus, no stale fallback)', () => {
  it('focuses precisely the matching card', () => {
    const calls: string[] = [];
    const card = { scrollIntoView: () => calls.push('scroll'), focus: () => calls.push('focus') };
    const root = { querySelector: (sel: string) => (sel === '[data-artifact-card="9-0"]' ? card : null) };
    expect(focusRecoveryCard('9-0', root)).toBe(true);
    expect(calls).toEqual(['scroll', 'focus']);
  });
  it('a missing card is a no-op, never a substitute focus', () => {
    const root = { querySelector: () => null };
    expect(focusRecoveryCard('9-0', root)).toBe(false);
  });
});
