import { describe, expect, it } from 'vitest';
import {
  AGENT_LIFECYCLE_PROTOCOL_VERSION,
  appendAgentActivity,
  agentIdentityViolations,
  assignVisibleAgentAliases,
  isAgentActivityEvent,
  isAgentReliabilityIncident,
  transitionAgentLifecycle,
  type AgentLifecycleEvent,
  type AgentLifecycleState,
} from './agentLifecycle.js';

function run(initial: AgentLifecycleState, events: AgentLifecycleEvent[]): AgentLifecycleState {
  return events.reduce<AgentLifecycleState>((state, event) => {
    const result = transitionAgentLifecycle(state, event);
    if (!result.ok) throw new Error(result.message);
    return result.transition.to;
  }, initial);
}

describe('WakiChat Agent Lifecycle Protocol v1', () => {
  it('supports join, listen, network degradation, and recovery without a new identity', () => {
    expect(run('new', [
      'connect_requested',
      'join_accepted',
      'listen_started',
      'transport_lost',
      'recovery_started',
      'recovery_succeeded',
      'listen_started',
    ])).toBe('listening');
  });

  it('requires an explicit recovery transition after involuntary removal', () => {
    expect(run('online', ['identity_replaced'])).toBe('removed');
    expect(transitionAgentLifecycle('removed', 'connect_requested')).toMatchObject({
      ok: false,
      code: 'invalid_transition',
    });
    expect(run('removed', ['recovery_started', 'recovery_succeeded'])).toBe('online');
  });

  it('keeps ended terminal and returns actionable invalid-transition details', () => {
    const result = transitionAgentLifecycle('ended', 'join_accepted');
    expect(result).toEqual({
      ok: false,
      state: 'ended',
      event: 'join_accepted',
      code: 'invalid_transition',
      message: 'Agent lifecycle event "join_accepted" is not valid while state is "ended".',
    });
  });

  it('detects split-brain credential/presence/message identity projections', () => {
    expect(agentIdentityViolations({
      sessionId: 'session-a',
      participantSessionId: 'session-a',
      credentialSessionId: 'session-b',
      presenceSessionId: 'session-a',
      messageSessionId: 'session-b',
      mentionTargetSessionId: 'session-a',
    })).toEqual([
      { surface: 'credential', expectedSessionId: 'session-a', actualSessionId: 'session-b' },
      { surface: 'message', expectedSessionId: 'session-a', actualSessionId: 'session-b' },
    ]);
  });

  it('accepts a complete secret-free reliability incident and rejects malformed input', () => {
    const incident = {
      protocolVersion: AGENT_LIFECYCLE_PROTOCOL_VERSION,
      roomCode: 'twig-ant-stem',
      participantId: 'participant-1',
      sessionId: 'session-a',
      occurredAt: 1_784_605_000_000,
      reason: 'credential_invalid',
      actor: 'server',
      lastCursor: 227,
      recoveryHint: 'reauthenticate',
    } as const;
    expect(isAgentReliabilityIncident(incident)).toBe(true);
    expect(isAgentReliabilityIncident({ ...incident, occurredAt: Number.NaN })).toBe(false);
    expect(isAgentReliabilityIncident({ ...incident, reason: 'some prose guess' })).toBe(false);
  });

  it('gives concurrent same-name siblings stable, distinct human aliases', () => {
    const candidates = [
      { sessionId: 's-review', displayName: 'Codex', role: 'review', joinedAt: 20 },
      { sessionId: 's-build-2', displayName: 'Codex', role: 'build', joinedAt: 30 },
      { sessionId: 's-build-1', displayName: 'Codex', role: 'build', joinedAt: 10 },
      { sessionId: 's-other', displayName: 'Claude', role: 'build', joinedAt: 5 },
    ];
    const assigned = assignVisibleAgentAliases(candidates);
    expect(assigned.map(candidate => [candidate.sessionId, candidate.visibleAlias])).toEqual([
      ['s-review', 'review'],
      ['s-build-2', 'build 2'],
      ['s-build-1', 'build 1'],
      ['s-other', undefined],
    ]);
    expect(assignVisibleAgentAliases([...candidates].reverse()).find(c => c.sessionId === 's-build-2')?.visibleAlias).toBe('build 2');
  });

  it('keeps Activity append-only and makes exact replay idempotent', () => {
    const event = {
      eventId: 'event-1',
      protocolVersion: AGENT_LIFECYCLE_PROTOCOL_VERSION,
      roomCode: 'twig-ant-stem',
      participantId: 'participant-1',
      sessionId: 'session-1',
      occurredAt: 1_784_605_000_000,
      kind: 'recovery_succeeded',
      actor: 'custodian',
      mechanism: 'reclaim_credential',
      outcome: 'succeeded',
    } as const;
    expect(isAgentActivityEvent(event)).toBe(true);
    expect(appendAgentActivity([], event)).toEqual([event]);
    expect(appendAgentActivity([event], event)).toEqual([event]);
    expect(() => appendAgentActivity([event], { ...event, outcome: 'failed' })).toThrow(/conflicts/);
    expect(isAgentActivityEvent({ ...event, occurredAt: Number.NaN })).toBe(false);
  });
});
