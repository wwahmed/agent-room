import { describe, expect, it } from 'vitest';
import { reviewHandoffLine, verdictLine, reviewPushForHost } from './reviewflow.js';

const task = { id: 'T-42', title: 'Ship the thing', owner: 'Builder', verifier: 'Waqas' };

describe('T-16 review handoff — submissions page their verifier', () => {
  it('leads with the verifier @mention and names task, owner, and both verify paths', () => {
    const line = reviewHandoffLine(task);
    expect(line).toContain('[REVIEW] @Waqas');
    expect(line).toContain('T-42 "Ship the thing"');
    expect(line).toContain('@Builder');
    expect(line).toContain('room_task_verify');
    expect(line).toContain('Board tab');
  });

  it('falls back to open-verify wording when no verifier is set (or it collides with the owner)', () => {
    const open = reviewHandoffLine({ id: 'T-01', title: 'X', owner: 'A' });
    expect(open).toContain('No designated verifier');
    expect(open).toContain('any participant except the owner');
    expect(open).not.toContain('@undefined');
    // owner==verifier can never be satisfied — treat as open review.
    const collided = reviewHandoffLine({ id: 'T-02', title: 'Y', owner: 'A', verifier: 'A' });
    expect(collided).toContain('No designated verifier');
  });
});

describe('T-16 verdicts — owners learn outcomes without polling the board', () => {
  it('done pages the owner with the verifier named', () => {
    const line = verdictLine(task, 'done', 'Waqas');
    expect(line).toContain('[VERDICT] @Builder');
    expect(line).toContain('verified DONE by Waqas');
  });

  it('rejected carries the rework instruction and the note', () => {
    const line = verdictLine(task, 'rejected', 'Waqas', 'evidence lacks a live receipt');
    expect(line).toContain('REJECTED by Waqas');
    expect(line).toContain('Rework and resubmit');
    expect(line).toContain('Note: evidence lacks a live receipt');
  });
});

describe('T-16 host push — only when the HOST is the designated verifier', () => {
  it('builds a push for the host-verifier and stays quiet otherwise', () => {
    const push = reviewPushForHost(task, 'abc-def-ghj', 'Waqas');
    expect(push).toMatchObject({ title: 'T-42 awaits your verify', url: '/r/abc-def-ghj', tag: 'review-abc-def-ghj-T-42' });
    expect(push!.body).toContain('Ship the thing');
    expect(reviewPushForHost(task, 'abc-def-ghj', 'SomeoneElse')).toBeNull();
    expect(reviewPushForHost({ id: 'T-01', title: 'X', owner: 'A' }, 'abc-def-ghj', 'Waqas')).toBeNull();
    expect(reviewPushForHost({ id: 'T-03', title: 'Z', owner: 'Waqas', verifier: 'Waqas' }, 'abc-def-ghj', 'Waqas')).toBeNull();
  });
});
