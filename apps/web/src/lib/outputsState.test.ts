import { describe, expect, it } from 'vitest';
import type { RoomArtifact } from '@agent-room/shared';
import { artifactsForRoom, hasLineMarker, outputsViewState, producedWorkOf, railSectionCount } from './outputsState.js';

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
