import { describe, expect, it } from 'vitest';
import {
  agentStatusView,
  recoveryLadder,
  reviveCapability,
  type RevivableAgent,
} from './agentRecovery.js';
import type { ParticipantHealth, PresenceState } from './presence.js';

function health(state: PresenceState, over: Partial<ParticipantHealth> = {}): ParticipantHealth {
  return {
    name: 'CoPilotWatcher', client: 'cc', role: 'AI Agent', state,
    lastSeenAgoMs: 600_000, listenRemainingMs: 0, ...over,
  };
}
const summoned: RevivableAgent = { agentId: 'grin-rib-tank-copilotwatcher-87a7f998', accessLevel: 'build', status: 'active' };

describe('reviveCapability', () => {
  it('revives a summoned agent at the level it is already running', () => {
    expect(reviveCapability(summoned)).toEqual({ ok: true, agentId: summoned.agentId, mode: 'build' });
  });

  it('never invents a level when only the raw mode is recorded', () => {
    expect(reviveCapability({ agentId: 'a', mode: 'chat' })).toEqual({ ok: true, agentId: 'a', mode: 'chat' });
  });

  it('refuses an adopted agent — the summoner holds no launch spec for it', () => {
    expect(reviveCapability({ ...summoned, adopted: true })).toEqual({ ok: false, reason: 'adopted' });
  });

  it('refuses an agent with no summoner record at all (joined by code)', () => {
    expect(reviveCapability(null)).toEqual({ ok: false, reason: 'no-record' });
    expect(reviveCapability(undefined)).toEqual({ ok: false, reason: 'no-record' });
  });

  it('refuses a record carrying no level, rather than guessing one', () => {
    // Guessing would silently re-permission the agent on every revive.
    expect(reviveCapability({ agentId: 'a' })).toEqual({ ok: false, reason: 'no-record' });
  });
});

describe('agentStatusView', () => {
  it('speaks plainly and never leaks protocol vocabulary', () => {
    const words = /listen|loop|heartbeat|tmux|harness|stale|disconnected|window/i;
    for (const state of ['listening', 'online', 'working', 'stale', 'disconnected'] as PresenceState[]) {
      const v = agentStatusView(health(state));
      expect(v.label).not.toMatch(words);
      expect(v.detail).not.toMatch(words);
    }
  });

  it('treats a quiet agent as probably busy, not probably dead', () => {
    // The old copy said "no heartbeat — loop may be dead" about agents that
    // were mid-turn, which is what made the pane read as alarming.
    const v = agentStatusView(health('stale'));
    expect(v.detail).toContain('long task');
    expect(v.needsAttention).toBe(true);
  });

  it('says a stopped agent will miss messages, which is the consequence that matters', () => {
    expect(agentStatusView(health('disconnected')).detail).toContain('will not see new messages');
  });

  it('credits the terminal when that is what vouched for the work', () => {
    expect(agentStatusView(health('working', { workingBy: 'terminal' })).detail).toContain('terminal');
    expect(agentStatusView(health('working', { workingBy: 'self' })).detail).toContain('said so');
  });

  it('leaves healthy agents and browser tabs alone', () => {
    expect(agentStatusView(health('listening')).needsAttention).toBe(false);
    expect(agentStatusView(health('working')).needsAttention).toBe(false);
    // A web participant is a browser tab; nobody recovers a browser tab.
    expect(agentStatusView(health('disconnected', { client: 'web' })).needsAttention).toBe(false);
  });
});

describe('recoveryLadder', () => {
  const ids = (l: ReturnType<typeof recoveryLadder>) => l.steps.map(s => s.id);

  it('offers nothing when nothing is wrong', () => {
    expect(recoveryLadder({ health: health('listening'), agent: summoned }).needed).toBe(false);
    expect(recoveryLadder({ health: null, agent: summoned }).needed).toBe(false);
  });

  it('recovers nothing in an ended room — the seat itself is gone', () => {
    expect(recoveryLadder({ health: health('disconnected'), agent: summoned, ended: true }).needed).toBe(false);
  });

  it('leads a stopped agent with the app doing the work', () => {
    const ladder = recoveryLadder({ health: health('disconnected'), agent: summoned });
    expect(ids(ladder)).toEqual(['bring-back', 'manual']);
    const bringBack = ladder.steps[0]!;
    expect(bringBack.emphasis).toBe('primary');
    expect(bringBack.automatic).toBe(true);
  });

  it('leads a quiet agent with waiting, so a busy agent is not interrupted', () => {
    const ladder = recoveryLadder({ health: health('stale'), agent: summoned });
    expect(ids(ladder)).toEqual(['wait', 'bring-back', 'manual']);
    expect(ladder.steps[0]!.emphasis).toBe('primary');
    // Bring-back is still available, just no longer the loudest thing on screen.
    expect(ladder.steps[1]!.emphasis).toBe('secondary');
  });

  it('demotes the terminal path to advanced once the app can do the job', () => {
    const ladder = recoveryLadder({ health: health('disconnected'), agent: summoned });
    const manual = ladder.steps.find(s => s.id === 'manual')!;
    expect(manual.emphasis).toBe('advanced');
    expect(ladder.blocked).toBeUndefined();
  });

  it('promotes the terminal path and explains why for an adopted agent', () => {
    const ladder = recoveryLadder({ health: health('disconnected'), agent: { ...summoned, adopted: true } });
    // No bring-back offered at all: a button that always 409s is worse than none.
    expect(ids(ladder)).toEqual(['manual']);
    expect(ladder.blocked).toBe('adopted');
    expect(ladder.steps[0]!.emphasis).toBe('primary');
    expect(ladder.steps[0]!.detail).toContain('already running when the app attached');
  });

  it('explains a join-code agent in terms of who owns its process', () => {
    const ladder = recoveryLadder({ health: health('disconnected'), agent: null });
    expect(ladder.blocked).toBe('no-record');
    expect(ladder.steps[0]!.detail).toContain('invite code');
  });

  it('offers removal only to the host, and only last', () => {
    expect(ids(recoveryLadder({ health: health('disconnected'), agent: summoned, isHost: false })))
      .not.toContain('remove');
    const hosted = recoveryLadder({ health: health('disconnected'), agent: summoned, isHost: true });
    expect(ids(hosted).at(-1)).toBe('remove');
    expect(hosted.steps.at(-1)!.emphasis).toBe('destructive');
  });

  it('ranks every ladder gentlest-first', () => {
    // The ordering IS the feature: one loud primary, then quieter options, and
    // the irreversible one at the bottom.
    const order: Record<string, number> = { wait: 0, 'bring-back': 1, manual: 2, remove: 3 };
    for (const state of ['stale', 'disconnected'] as PresenceState[]) {
      for (const agent of [summoned, { ...summoned, adopted: true }, null]) {
        const ranks = recoveryLadder({ health: health(state), agent, isHost: true }).steps.map(s => order[s.id]!);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }
    }
  });
});
