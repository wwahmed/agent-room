import { describe, expect, it } from 'vitest';
import { liveAgentFor, newestAgentFor, processBadge, removalPlan, staleAgentRows } from './removal.js';
import type { SummonedAgent } from './api.js';

// The unified "Remove from room" verb: one confirm that says exactly what
// will happen, one action that covers BOTH the process and the row.

function rec(over: Partial<SummonedAgent>): SummonedAgent {
  return {
    agentId: 'room-agent-1', name: 'Agent', role: 'AI Agent', provider: 'claude-corporate',
    model: 'claude-fable-5', workspace: '/w', room: 'r', mode: 'build', status: 'active',
    health: 'online', tmuxSession: 'sm-x', access: [], createdAt: 1000,
    ...over,
  };
}

describe('record selection', () => {
  it('newestAgentFor picks the most recent record regardless of status', () => {
    const rs = [rec({ agentId: 'a', createdAt: 1, status: 'dismissed' }), rec({ agentId: 'b', createdAt: 2, status: 'active' })];
    expect(newestAgentFor(rs, 'Agent')?.agentId).toBe('b');
    expect(newestAgentFor(rs, 'Other')).toBe(null);
  });

  it('liveAgentFor only returns an ACTIVE record — dismissed processes cannot be stopped again', () => {
    const rs = [rec({ agentId: 'a', createdAt: 2, status: 'dismissed' })];
    expect(liveAgentFor(rs, 'Agent')).toBe(null);
    rs.push(rec({ agentId: 'b', createdAt: 1, status: 'active' }));
    expect(liveAgentFor(rs, 'Agent')?.agentId).toBe('b');
  });
});

describe('removalPlan — the confirm says exactly what will happen', () => {
  it('summoned + live: stops the process AND frees the row', () => {
    const plan = removalPlan({ name: 'Agent', client: 'cc' }, [rec({})]);
    expect(plan.agentId).toBe('room-agent-1');
    expect(plan.confirm).toContain('stops its agent process');
    expect(plan.confirm).toContain('claude-corporate · claude-fable-5');
  });

  it('summoned but already dismissed: only clears the stale row, no process claim', () => {
    const plan = removalPlan({ name: 'Agent', client: 'cc' }, [rec({ status: 'dismissed' })]);
    expect(plan.agentId).toBe(null);
    expect(plan.confirm).toContain('already dismissed');
  });

  it('join-code agent: says the process is not ours to stop', () => {
    const plan = removalPlan({ name: 'Stranger', client: 'cc' }, [rec({})]);
    expect(plan.agentId).toBe(null);
    expect(plan.confirm).toContain("isn't managed here");
  });

  it('web participant: plain removal, they can rejoin by code', () => {
    const plan = removalPlan({ name: 'Human', client: 'web' }, [rec({ name: 'Human' })]);
    expect(plan.agentId).toBe(null);
    expect(plan.confirm).toContain('rejoin');
  });
});

describe('processBadge — process truth, not presence', () => {
  it('maps live health to a badge and never badges web rows or unknown registries', () => {
    expect(processBadge({ name: 'Agent', client: 'cc' }, [rec({})])).toEqual({ label: 'process online', tone: 'ok' });
    expect(processBadge({ name: 'Agent', client: 'cc' }, [rec({ health: 'starting' })])).toEqual({ label: 'process starting', tone: 'warn' });
    expect(processBadge({ name: 'Agent', client: 'cc' }, [rec({ health: 'stopped' })])?.tone).toBe('dead');
    expect(processBadge({ name: 'Human', client: 'web' }, [rec({})])).toBe(null);
    expect(processBadge({ name: 'Agent', client: 'cc' }, null)).toBe(null);
  });

  it('flags a dismissed process as a stale row and an unmanaged agent as not ours', () => {
    expect(processBadge({ name: 'Agent', client: 'cc' }, [rec({ status: 'dismissed' })]))
      .toEqual({ label: 'process dismissed — row is stale', tone: 'dead' });
    expect(processBadge({ name: 'Stranger', client: 'cc' }, [rec({})]))
      .toEqual({ label: 'process not managed here', tone: 'muted' });
  });
});

describe('staleAgentRows — the room-open ghost sweep', () => {
  const participants = [
    { name: 'Ghost', client: 'cc' },
    { name: 'Alive', client: 'cc' },
    { name: 'Stranger', client: 'cc' },
    { name: 'Waqas', client: 'web' },
  ];
  const records = [
    rec({ name: 'Ghost', agentId: 'g', status: 'dismissed' }),
    rec({ name: 'Alive', agentId: 'l', status: 'active' }),
  ];

  it('sweeps only summoner-known, process-dead, server-disconnected rows', () => {
    const ghosts = staleAgentRows(participants, records, (p) => (p.name === 'Ghost' ? 'disconnected' : 'listening'));
    expect(ghosts.map((g) => g.name)).toEqual(['Ghost']);
  });

  it('a manually-resumed session keeps its seat (still listening ≠ ghost)', () => {
    const ghosts = staleAgentRows(participants, records, () => 'listening');
    expect(ghosts).toEqual([]);
  });

  it('is conservative on unknown presence', () => {
    const ghosts = staleAgentRows(participants, records, () => null);
    expect(ghosts).toEqual([]);
  });
});
