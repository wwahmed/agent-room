import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { LIFECYCLE_EVENT_TYPES, countsAsActivity, lastActivityTime } from './activitySignal.js';

const serverIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const msg = (over: Record<string, unknown> = {}) => ({ type: 'msg', time: 1_000, ...over }) as never;
const sys = (eventType: string, time = 1_000) => ({ type: 'sys', time, metadata: { eventType } }) as never;
const ping = (time = 1_000) => ({ type: 'msg', time, metadata: { kind: 'status' } }) as never;

// T-43: the host saw "now" beside rooms nobody had spoken in for an hour, because a
// `[STATUS] Still present and listening` heartbeat counted as activity. Same wrong
// signal reshuffled the activity-ordered rail every few minutes, which is how he
// kept typing into a room that had moved.
describe('Activity signal — conversation, not twitching', () => {
  it('a heartbeat ping is never activity', () => {
    expect(countsAsActivity(ping())).toBe(false);
    // Even on a sys row, and regardless of any event type alongside it.
    expect(countsAsActivity({ type: 'sys', metadata: { kind: 'status', eventType: 'whatever' } } as never)).toBe(false);
  });

  it('presence and membership events are lifecycle, not activity', () => {
    for (const t of ['agent_auto_nudged', 'participant_removed', 'ghost_sweep', 'nobody_listening', 'last_agent_left']) {
      expect(countsAsActivity(sys(t)), t).toBe(false);
      expect(LIFECYCLE_EVENT_TYPES.has(t)).toBe(true);
    }
  });

  it('real talk and real work DO count', () => {
    expect(countsAsActivity(msg())).toBe(true);
    // Work events: a submission, a verdict, a promotion, a decision.
    for (const t of ['task_submitted', 'task_verified', 'deployed', 'pin', 'mode_changed']) {
      expect(countsAsActivity(sys(t)), t).toBe(true);
    }
    // Allow-by-default is deliberate: a NEW substantive event type counts the day
    // it is added, and forgetting to exclude a new PRESENCE event shows up as a
    // visible room-list bug rather than silently losing a real signal.
    expect(countsAsActivity(sys('some_future_event'))).toBe(true);
  });

  it('scans past a tail of heartbeats to find the last real activity', () => {
    // The exact shape that broke the list: a real message, then a run of pings.
    const history = [msg({ time: 5_000 }), ping(9_000), ping(9_500), sys('agent_auto_nudged', 9_800)];
    expect(lastActivityTime(history)).toBe(5_000);
    // No real activity at all → undefined, so callers fall back to createdAt
    // rather than inventing a timestamp.
    expect(lastActivityTime([ping(9_000)])).toBeUndefined();
    expect(lastActivityTime([])).toBeUndefined();
    // Garbage timestamps are skipped, not trusted.
    expect(lastActivityTime([msg({ time: 7_000 }), msg({ time: 0 })])).toBe(7_000);
  });

  it('both append paths are gated, and the backfill reads a tail not just the last row', () => {
    // Before this, appendSystemMessage bumped unconditionally — every ping,
    // nudge and sweep line marked the room freshly active.
    expect(serverIndex).toContain('if (result.appended && countsAsActivity(args[2] as never))');
    expect(serverIndex).toContain('if (countsAsActivity(args[2] as never)) await safelyTouchRoomActivityIndex(args[1]);');
    // A rebuild seeded from the single newest row would restore the lie, because
    // the newest row is so often a heartbeat.
    expect(serverIndex).toContain('lrange(`room-msgs:${code}`, -ACTIVITY_BACKFILL_TAIL, -1)');
    expect(serverIndex).toContain('lastMessageAt = lastActivityTime(parsed)');
  });
});
