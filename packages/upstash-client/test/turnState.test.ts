import { describe, it, expect } from 'vitest';
import type { Participant, Room } from '@agent-room/shared';
import {
  addHostDirected,
  advanceOnTimeout,
  advanceTurn,
  applyGraceSupplementReply,
  buildSupplementQueue,
  canAgentSpeakNow,
  consumeHostDirected,
  consumeHostDirectedDetailed,
  isCurrentSpeaker,
  isGraceSupplementSpeaker,
  isHumanSender,
  leadGraceMs,
  moderatorReply,
  myRoleInTurn,
  newModeratorTurn,
  newSequentialTurn,
  pickLeadForSequential,
  shouldStartNewTurn,
  skipQueueHead,
  timeoutForRole,
  type TurnState,
} from '../src/turnState.js';

function part(name: string, client: 'web' | 'cc', joinedAt: number, canSpeak = true): Participant {
  return { name, client, role: '', color: '#fff', initials: 'XX', joinedAt, lastSeenAt: joinedAt, canSpeak };
}

function room(overrides: Partial<Room> = {}): Room {
  return {
    code: 'TST-CDE-FGH',
    topic: 'discussion',
    createdAt: 0,
    createdBy: 'host',
    status: 'active',
    version: 1,
    participants: [
      part('host', 'web', 0),
      part('Lead', 'cc', 10),
      part('A', 'cc', 20),
      part('B', 'cc', 30),
    ],
    replyMode: 'sequential',
    ...overrides,
  };
}

describe('pickLeadForSequential', () => {
  it('honors explicit leadAgentName/Client from modeConfig', () => {
    const r = room({ modeConfig: { leadAgentName: 'A', leadAgentClient: 'cc' } });
    expect(pickLeadForSequential(r)).toEqual({ name: 'A', client: 'cc' });
  });

  it('falls back to first cc agent in join order when modeConfig is empty', () => {
    const r = room();
    expect(pickLeadForSequential(r)).toEqual({ name: 'Lead', client: 'cc' });
  });

  it('skips the host and any web-client participant', () => {
    const r = room({
      participants: [
        part('host', 'web', 0),
        part('humanGuest', 'web', 5),
        part('cc1', 'cc', 10),
      ],
    });
    expect(pickLeadForSequential(r)).toEqual({ name: 'cc1', client: 'cc' });
  });

  it('returns undefined when no cc agents are present', () => {
    const r = room({ participants: [part('host', 'web', 0)] });
    expect(pickLeadForSequential(r)).toBeUndefined();
  });

  it('falls back when modeConfig points to a Lead who has left the room', () => {
    const r = room({ modeConfig: { leadAgentName: 'Ghost', leadAgentClient: 'cc' } });
    // Ghost is not in participants → fall back to first cc agent in join order.
    expect(pickLeadForSequential(r)).toEqual({ name: 'Lead', client: 'cc' });
  });
});

describe('buildSupplementQueue', () => {
  it('lists cc agents in join order, excluding the Lead and the host', () => {
    const r = room();
    const queue = buildSupplementQueue(r, { name: 'Lead', client: 'cc' });
    expect(queue).toEqual([
      { name: 'A', client: 'cc', role: 'supplement' },
      { name: 'B', client: 'cc', role: 'supplement' },
    ]);
  });

  it('filters out muted agents', () => {
    const r = room({
      participants: [
        part('host', 'web', 0),
        part('Lead', 'cc', 10),
        part('A', 'cc', 20, /*canSpeak*/ false),
        part('B', 'cc', 30),
      ],
    });
    const queue = buildSupplementQueue(r, { name: 'Lead', client: 'cc' });
    expect(queue).toEqual([{ name: 'B', client: 'cc', role: 'supplement' }]);
  });
});

describe('newSequentialTurn', () => {
  it('returns null when no cc agents are present', () => {
    const r = room({ participants: [part('host', 'web', 0)] });
    expect(newSequentialTurn(r, 1)).toBeNull();
  });

  it('starts with Lead current, supplement queue in join order', () => {
    const r = room();
    const state = newSequentialTurn(r, 100, 1000)!;
    expect(state.turnId).toBe(1000);
    expect(state.mode).toBe('sequential');
    expect(state.leadName).toBe('Lead');
    expect(state.currentName).toBe('Lead');
    expect(state.currentRole).toBe('lead');
    expect(state.deadline).toBe(1000 + 90_000); // default lead timeout
    expect(state.leadGraceUntil).toBe(1000 + 20_000); // default lead grace
    expect(state.queue).toEqual([
      { name: 'A', client: 'cc', role: 'supplement' },
      { name: 'B', client: 'cc', role: 'supplement' },
    ]);
    expect(state.spoken).toEqual([]);
  });

  it('omits leadGraceUntil when no supplements are waiting (pointless grace)', () => {
    const r = room({ participants: [part('host', 'web', 0), part('Lead', 'cc', 10)] });
    const state = newSequentialTurn(r, 100, 1000)!;
    expect(state.queue).toEqual([]);
    expect(state.leadGraceUntil).toBeUndefined();
  });
});

describe('advanceTurn', () => {
  it('moves current to spoken with given status, pops queue head into current', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    const after = advanceTurn(start, 'replied', r, 2000);
    expect(after.spoken).toEqual([
      { name: 'Lead', client: 'cc', role: 'lead', status: 'replied', at: 2000 },
    ]);
    expect(after.currentName).toBe('A');
    expect(after.currentRole).toBe('supplement');
    expect(after.deadline).toBe(2000 + 45_000); // default supplement timeout
    expect(after.queue).toEqual([{ name: 'B', client: 'cc', role: 'supplement' }]);
    // Grace window cleared once we leave the lead slot.
    expect(after.leadGraceUntil).toBeUndefined();
  });

  it('clears current/deadline when the queue empties', () => {
    const r = room({ participants: [part('host', 'web', 0), part('Lead', 'cc', 10)] });
    const start = newSequentialTurn(r, 100, 1000)!;
    expect(start.queue).toEqual([]);
    const after = advanceTurn(start, 'replied', r, 2000);
    expect(after.currentName).toBeUndefined();
    expect(after.deadline).toBeUndefined();
    expect(after.spoken).toHaveLength(1);
  });

  it('honors `no_addition` as a status without otherwise differing from `replied`', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    // Advance once to put a supplement in the current slot, then advance again with no_addition.
    const second = advanceTurn(start, 'replied', r, 2000);
    const third = advanceTurn(second, 'no_addition', r, 3000);
    expect(third.spoken[1]).toEqual({
      name: 'A', client: 'cc', role: 'supplement', status: 'no_addition', at: 3000,
    });
    expect(third.currentName).toBe('B');
  });
});

describe('advanceOnTimeout', () => {
  it('returns the same state when no deadline has passed', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    const { state, skipped } = advanceOnTimeout(start, r, /*now*/ 1500);
    expect(state).toEqual(start);
    expect(skipped).toEqual([]);
  });

  it('cascades multiple timeouts in one call when deadlines are stacked', () => {
    const r = room();
    // Manually craft a state with two consecutive zero-timeout entries to
    // force a cascade — easier than waiting for real time elapses.
    const stacked: TurnState = {
      turnId: 1,
      mode: 'sequential',
      leadName: 'Lead',
      leadClient: 'cc',
      currentName: 'Lead',
      currentClient: 'cc',
      currentRole: 'lead',
      deadline: 100, // already passed at now=1000
      queue: [
        { name: 'A', client: 'cc', role: 'supplement' },
        { name: 'B', client: 'cc', role: 'supplement' },
      ],
      spoken: [],
    };
    const r2 = room({
      modeConfig: { timeoutMs: { lead: 0, supplement: 0 } },
    });
    // Set the modeConfig timeouts to 0 so advanceTurn re-deadlines to `now`,
    // which is also already passed → cascade continues.
    const { state, skipped } = advanceOnTimeout(stacked, r2, 1000);
    expect(skipped.map(s => s.name)).toEqual(['Lead', 'A', 'B']);
    expect(state?.currentName).toBeUndefined();
    expect(state?.spoken).toHaveLength(3);
  });
});

describe('isCurrentSpeaker / isHumanSender / shouldStartNewTurn', () => {
  it('isCurrentSpeaker matches both name and client', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    expect(isCurrentSpeaker(start, 'Lead', 'cc')).toBe(true);
    expect(isCurrentSpeaker(start, 'Lead', 'web')).toBe(false);
    expect(isCurrentSpeaker(start, 'A', 'cc')).toBe(false);
    expect(isCurrentSpeaker(null, 'Lead', 'cc')).toBe(false);
  });

  it('isHumanSender: web client, or the room host (even if cc)', () => {
    const r = room();
    expect(isHumanSender(r, 'host', 'web')).toBe(true);
    expect(isHumanSender(r, 'guest', 'web')).toBe(true);
    expect(isHumanSender(r, 'A', 'cc')).toBe(false);
    // Host masquerading as cc still counts as human.
    expect(isHumanSender(r, 'host', 'cc')).toBe(true);
  });

  it('shouldStartNewTurn returns false in open mode', () => {
    const r = room({ replyMode: 'open' });
    expect(shouldStartNewTurn(null, r)).toBe(false);
  });

  it('shouldStartNewTurn returns true when no turn is in flight in sequential mode', () => {
    const r = room();
    expect(shouldStartNewTurn(null, r)).toBe(true);
  });

  it('shouldStartNewTurn returns true when prior turn is complete (current cleared, queue empty)', () => {
    const r = room();
    const finished: TurnState = {
      turnId: 1, mode: 'sequential', queue: [], spoken: [
        { name: 'Lead', client: 'cc', role: 'lead', status: 'replied', at: 1 },
      ],
    };
    expect(shouldStartNewTurn(finished, r)).toBe(true);
  });

  it('shouldStartNewTurn returns false while a turn is still in flight', () => {
    const r = room();
    const inflight = newSequentialTurn(r, 1, 1)!;
    expect(shouldStartNewTurn(inflight, r)).toBe(false);
  });
});

describe('consumeHostDirected', () => {
  it('returns false on empty allowlist', () => {
    const state: TurnState = {
      turnId: 1, mode: 'sequential', queue: [], spoken: [],
    };
    expect(consumeHostDirected(state, 'A', 'cc')).toBe(false);
  });

  it('returns true and removes the matching entry', () => {
    const state: TurnState = {
      turnId: 1, mode: 'sequential', queue: [], spoken: [],
      hostDirected: [
        { name: 'A', client: 'cc', addedAt: 1 },
        { name: 'B', client: 'cc', addedAt: 2 },
      ],
    };
    expect(consumeHostDirected(state, 'A', 'cc')).toBe(true);
    expect(state.hostDirected).toEqual([{ name: 'B', client: 'cc', addedAt: 2 }]);
  });
});

describe('timeoutForRole', () => {
  it('returns the default for unconfigured roles', () => {
    const r = room();
    expect(timeoutForRole(r, 'lead')).toBe(90_000);
    expect(timeoutForRole(r, 'supplement')).toBe(45_000);
    expect(timeoutForRole(r, 'moderator')).toBe(300_000);
    expect(timeoutForRole(r, 'assignee')).toBe(90_000);
  });

  it('honors modeConfig.timeoutMs overrides', () => {
    const r = room({ modeConfig: { timeoutMs: { lead: 5_000, supplement: 1_000 } } });
    expect(timeoutForRole(r, 'lead')).toBe(5_000);
    expect(timeoutForRole(r, 'supplement')).toBe(1_000);
    // Unconfigured roles still fall back.
    expect(timeoutForRole(r, 'moderator')).toBe(300_000);
  });

  it('returns Infinity for non-deadline roles (open, human, host_directed)', () => {
    const r = room();
    expect(timeoutForRole(r, 'open')).toBe(Number.POSITIVE_INFINITY);
    expect(timeoutForRole(r, 'human')).toBe(Number.POSITIVE_INFINITY);
    expect(timeoutForRole(r, 'host_directed')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('newModeratorTurn', () => {
  it('returns null when no moderator is configured', () => {
    const r = room({ replyMode: 'moderator', modeConfig: {} });
    expect(newModeratorTurn(r, 1)).toBeNull();
  });

  it('returns null when configured moderator is absent from the room', () => {
    const r = room({
      replyMode: 'moderator',
      modeConfig: { moderatorAgentName: 'Ghost', moderatorAgentClient: 'cc' },
    });
    expect(newModeratorTurn(r, 1)).toBeNull();
  });

  it('returns null when configured moderator is muted', () => {
    const r = room({
      replyMode: 'moderator',
      modeConfig: { moderatorAgentName: 'Lead', moderatorAgentClient: 'cc' },
      participants: [
        part('host', 'web', 0),
        part('Lead', 'cc', 10, /*canSpeak*/ false),
      ],
    });
    expect(newModeratorTurn(r, 1)).toBeNull();
  });

  it('starts with moderator as current and empty queue', () => {
    const r = room({
      replyMode: 'moderator',
      modeConfig: { moderatorAgentName: 'Lead', moderatorAgentClient: 'cc' },
    });
    const state = newModeratorTurn(r, 100, 1000)!;
    expect(state.mode).toBe('moderator');
    expect(state.moderatorName).toBe('Lead');
    expect(state.currentName).toBe('Lead');
    expect(state.currentRole).toBe('moderator');
    expect(state.queue).toEqual([]);
    expect(state.deadline).toBe(1000 + 300_000); // default moderator timeout
  });
});

describe('moderatorReply', () => {
  it('keeps current = moderator, resets deadline, logs in spoken', () => {
    const r = room({
      replyMode: 'moderator',
      modeConfig: { moderatorAgentName: 'Lead', moderatorAgentClient: 'cc' },
    });
    const start = newModeratorTurn(r, 100, 1000)!;
    const after = moderatorReply(start, r, 5000);
    expect(after.currentName).toBe('Lead');
    expect(after.currentRole).toBe('moderator');
    expect(after.deadline).toBe(5000 + 300_000);
    expect(after.spoken).toEqual([
      { name: 'Lead', client: 'cc', role: 'moderator', status: 'replied', at: 5000 },
    ]);
  });
});

describe('addHostDirected / consumeHostDirectedDetailed', () => {
  it('records source on addHostDirected and surfaces it on consume', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    const withDirected = addHostDirected(start, 'A', 'cc', 'moderator', 2000);
    const detailed = consumeHostDirectedDetailed(withDirected, 'A', 'cc');
    expect(detailed.consumed).toBe(true);
    expect(detailed.source).toBe('moderator');
  });

  it('defaults source to "host" when not specified', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    const withDirected = addHostDirected(start, 'A', 'cc');
    const detailed = consumeHostDirectedDetailed(withDirected, 'A', 'cc');
    expect(detailed.source).toBe('host');
  });

  it('returns consumed=false when target is not in the allowlist', () => {
    const r = room();
    const start = newSequentialTurn(r, 100, 1000)!;
    expect(consumeHostDirectedDetailed(start, 'A', 'cc')).toEqual({ consumed: false });
  });

  it('addHostDirected is idempotent (no stacking)', () => {
    const r = room();
    let state = newSequentialTurn(r, 100, 1000)!;
    state = addHostDirected(state, 'A', 'cc', 'host', 2000);
    state = addHostDirected(state, 'A', 'cc', 'host', 3000); // duplicate
    expect(state.hostDirected).toHaveLength(1);
  });
});

describe('myRoleInTurn', () => {
  it('returns observer when no turn is active', () => {
    expect(myRoleInTurn(null, 'A', 'cc')).toBe('observer');
  });

  it('returns the role of the current speaker', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1)!;
    expect(myRoleInTurn(state, 'Lead', 'cc')).toBe('lead');
  });

  it('returns "queued" for upcoming supplements before lead-grace elapses', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    // 5s into the turn — well within the 20s lead grace window.
    expect(myRoleInTurn(state, 'A', 'cc', 6000)).toBe('queued');
    expect(myRoleInTurn(state, 'B', 'cc', 6000)).toBe('queued');
  });

  it('returns "spoken" once the participant has replied or been skipped', () => {
    const r = room();
    const start = newSequentialTurn(r, 1, 1)!;
    const after = advanceTurn(start, 'replied', r, 100);
    expect(myRoleInTurn(after, 'Lead', 'cc')).toBe('spoken');
    expect(myRoleInTurn(after, 'A', 'cc')).toBe('supplement'); // now current
  });

  it('returns "host_directed" when present in the one-shot allowlist', () => {
    const state: TurnState = {
      turnId: 1, mode: 'sequential', queue: [], spoken: [],
      hostDirected: [{ name: 'A', client: 'cc', addedAt: 0 }],
    };
    expect(myRoleInTurn(state, 'A', 'cc')).toBe('host_directed');
  });
});

describe('lead grace', () => {
  it('leadGraceMs honors modeConfig override and falls back to default', () => {
    expect(leadGraceMs(room())).toBe(20_000);
    expect(leadGraceMs(room({ modeConfig: { leadGraceMs: 5_000 } }))).toBe(5_000);
  });

  it('canAgentSpeakNow: Lead always, queue head only after grace, others never', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    // Inside grace: only Lead can speak.
    expect(canAgentSpeakNow(state, 'Lead', 'cc', 5000)).toBe(true);
    expect(canAgentSpeakNow(state, 'A', 'cc', 5000)).toBe(false);
    expect(canAgentSpeakNow(state, 'B', 'cc', 5000)).toBe(false);
    // Past grace: queue head A unlocks; B (not at head) stays gated.
    expect(canAgentSpeakNow(state, 'Lead', 'cc', 25_000)).toBe(true);
    expect(canAgentSpeakNow(state, 'A', 'cc', 25_000)).toBe(true);
    expect(canAgentSpeakNow(state, 'B', 'cc', 25_000)).toBe(false);
  });

  it('isGraceSupplementSpeaker distinguishes grace-path from current-speaker path', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    expect(isGraceSupplementSpeaker(state, 'Lead', 'cc', 25_000)).toBe(false); // is current
    expect(isGraceSupplementSpeaker(state, 'A', 'cc', 25_000)).toBe(true);     // grace path
    expect(isGraceSupplementSpeaker(state, 'A', 'cc', 5_000)).toBe(false);     // still in grace
  });

  it('myRoleInTurn surfaces the queue-head supplement as "supplement" after grace', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    expect(myRoleInTurn(state, 'A', 'cc', 5_000)).toBe('queued');
    expect(myRoleInTurn(state, 'A', 'cc', 25_000)).toBe('supplement');
    // Non-head supplement stays queued — only the head is grace-eligible.
    expect(myRoleInTurn(state, 'B', 'cc', 25_000)).toBe('queued');
  });

  it('applyGraceSupplementReply marks Lead skipped_by_grace and advances the queue', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    const { state: after, leadSkipped } = applyGraceSupplementReply(
      state, 'A', 'cc', r, 25_000,
    );
    expect(leadSkipped).toEqual({
      name: 'Lead', client: 'cc', role: 'lead', status: 'skipped_by_grace', at: 25_000,
    });
    expect(after.spoken).toEqual([
      { name: 'Lead', client: 'cc', role: 'lead', status: 'skipped_by_grace', at: 25_000 },
      { name: 'A', client: 'cc', role: 'supplement', status: 'replied', at: 25_000 },
    ]);
    expect(after.currentName).toBe('B');
    expect(after.queue).toEqual([]);
    expect(after.leadGraceUntil).toBeUndefined();
  });

  it('applyGraceSupplementReply clears current/deadline when queue empties out', () => {
    const r = room({ participants: [part('host', 'web', 0), part('Lead', 'cc', 10), part('A', 'cc', 20)] });
    const state = newSequentialTurn(r, 1, 1000)!;
    const { state: after } = applyGraceSupplementReply(state, 'A', 'cc', r, 25_000);
    expect(after.currentName).toBeUndefined();
    expect(after.queue).toEqual([]);
    expect(after.leadGraceUntil).toBeUndefined();
  });

  it('Lead reply during grace uses normal advanceTurn (no skip)', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    const after = advanceTurn(state, 'replied', r, 5_000);
    expect(after.spoken[0]?.status).toBe('replied');
    expect(after.currentName).toBe('A');
    expect(after.leadGraceUntil).toBeUndefined();
  });

  it('skipQueueHead drops the head supplement without preempting the Lead', () => {
    const r = room();
    const state = newSequentialTurn(r, 1, 1000)!;
    const after = skipQueueHead(state, 'no_addition', 25_000);
    // Lead still current; A removed from queue with no_addition status.
    expect(after.currentName).toBe('Lead');
    expect(after.currentRole).toBe('lead');
    expect(after.leadGraceUntil).toBe(state.leadGraceUntil);
    expect(after.queue).toEqual([{ name: 'B', client: 'cc', role: 'supplement' }]);
    expect(after.spoken).toEqual([
      { name: 'A', client: 'cc', role: 'supplement', status: 'no_addition', at: 25_000 },
    ]);
  });

  it('skipQueueHead is a no-op when the queue is empty', () => {
    const r = room({ participants: [part('host', 'web', 0), part('Lead', 'cc', 10)] });
    const state = newSequentialTurn(r, 1, 1000)!;
    expect(state.queue).toEqual([]);
    const after = skipQueueHead(state, 'no_addition', 25_000);
    expect(after).toEqual(state);
  });
});
