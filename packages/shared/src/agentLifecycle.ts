/**
 * WakiChat Agent Lifecycle Protocol v1.
 *
 * This module is deliberately dependency-free so the server, MCP client,
 * browser, proxy, migration tools, and conformance tests all consume the same
 * transition and reason-code contract.
 */
export const AGENT_LIFECYCLE_PROTOCOL_VERSION = 1 as const;

export const AGENT_TERMINATION_REASONS = [
  'credential_invalid',
  'host_removed',
  'identity_replaced',
  'liveness_expired',
  'protocol_violation',
  'room_ended',
  'self_left',
  'transport_lost',
  'unknown',
] as const;

export type AgentTerminationReason = typeof AGENT_TERMINATION_REASONS[number];

export type AgentLifecycleState =
  | 'new'
  | 'joining'
  | 'online'
  | 'listening'
  | 'degraded'
  | 'stale'
  | 'disconnected'
  | 'removed'
  | 'recovering'
  | 'ended';

export type AgentLifecycleEvent =
  | 'connect_requested'
  | 'join_accepted'
  | 'heartbeat'
  | 'listen_started'
  | 'listen_elapsed'
  | 'transport_lost'
  | 'liveness_expired'
  | 'disconnect_requested'
  | 'host_removed'
  | 'identity_replaced'
  | 'credential_rejected'
  | 'recovery_started'
  | 'recovery_succeeded'
  | 'recovery_failed'
  | 'room_ended';

export interface AgentLifecycleTransition {
  from: AgentLifecycleState;
  event: AgentLifecycleEvent;
  to: AgentLifecycleState;
  reason?: AgentTerminationReason;
  audit: AgentLifecycleAuditKind;
}

export type AgentLifecycleAuditKind =
  | 'join'
  | 'presence'
  | 'disconnect'
  | 'stale'
  | 'remove'
  | 'incident'
  | 'recovery'
  | 'end';

export type AgentLifecycleResult =
  | { ok: true; transition: AgentLifecycleTransition }
  | { ok: false; state: AgentLifecycleState; event: AgentLifecycleEvent; code: 'invalid_transition'; message: string };

type TransitionTarget = Omit<AgentLifecycleTransition, 'from' | 'event'>;

const transition = (
  to: AgentLifecycleState,
  audit: AgentLifecycleAuditKind,
  reason?: AgentTerminationReason,
): TransitionTarget => ({ to, audit, ...(reason ? { reason } : {}) });

const TRANSITIONS: Record<AgentLifecycleState, Partial<Record<AgentLifecycleEvent, TransitionTarget>>> = {
  new: {
    connect_requested: transition('joining', 'join'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  joining: {
    join_accepted: transition('online', 'join'),
    credential_rejected: transition('disconnected', 'incident', 'credential_invalid'),
    transport_lost: transition('disconnected', 'incident', 'transport_lost'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  online: {
    heartbeat: transition('online', 'presence'),
    listen_started: transition('listening', 'presence'),
    transport_lost: transition('degraded', 'incident', 'transport_lost'),
    liveness_expired: transition('stale', 'stale', 'liveness_expired'),
    disconnect_requested: transition('disconnected', 'disconnect', 'self_left'),
    host_removed: transition('removed', 'remove', 'host_removed'),
    identity_replaced: transition('removed', 'incident', 'identity_replaced'),
    credential_rejected: transition('disconnected', 'incident', 'credential_invalid'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  listening: {
    heartbeat: transition('listening', 'presence'),
    listen_started: transition('listening', 'presence'),
    listen_elapsed: transition('online', 'presence'),
    transport_lost: transition('degraded', 'incident', 'transport_lost'),
    liveness_expired: transition('stale', 'stale', 'liveness_expired'),
    disconnect_requested: transition('disconnected', 'disconnect', 'self_left'),
    host_removed: transition('removed', 'remove', 'host_removed'),
    identity_replaced: transition('removed', 'incident', 'identity_replaced'),
    credential_rejected: transition('disconnected', 'incident', 'credential_invalid'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  degraded: {
    heartbeat: transition('online', 'recovery'),
    listen_started: transition('listening', 'recovery'),
    liveness_expired: transition('stale', 'stale', 'liveness_expired'),
    disconnect_requested: transition('disconnected', 'disconnect', 'self_left'),
    host_removed: transition('removed', 'remove', 'host_removed'),
    credential_rejected: transition('disconnected', 'incident', 'credential_invalid'),
    recovery_started: transition('recovering', 'recovery'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  stale: {
    heartbeat: transition('online', 'recovery'),
    listen_started: transition('listening', 'recovery'),
    disconnect_requested: transition('disconnected', 'disconnect', 'self_left'),
    host_removed: transition('removed', 'remove', 'host_removed'),
    recovery_started: transition('recovering', 'recovery'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  disconnected: {
    connect_requested: transition('joining', 'recovery'),
    recovery_started: transition('recovering', 'recovery'),
    host_removed: transition('removed', 'remove', 'host_removed'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  removed: {
    recovery_started: transition('recovering', 'recovery'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  recovering: {
    recovery_succeeded: transition('online', 'recovery'),
    recovery_failed: transition('disconnected', 'incident', 'unknown'),
    credential_rejected: transition('disconnected', 'incident', 'credential_invalid'),
    room_ended: transition('ended', 'end', 'room_ended'),
  },
  ended: {},
};

export function transitionAgentLifecycle(
  state: AgentLifecycleState,
  event: AgentLifecycleEvent,
): AgentLifecycleResult {
  const target = TRANSITIONS[state][event];
  if (!target) {
    return {
      ok: false,
      state,
      event,
      code: 'invalid_transition',
      message: `Agent lifecycle event "${event}" is not valid while state is "${state}".`,
    };
  }
  return { ok: true, transition: { from: state, event, ...target } };
}

/** The projections that MUST resolve to one session lineage. */
export interface AgentIdentityProjection {
  sessionId: string;
  participantSessionId?: string;
  credentialSessionId?: string;
  presenceSessionId?: string;
  messageSessionId?: string;
  mentionTargetSessionId?: string;
}

export type AgentIdentitySurface =
  | 'participant'
  | 'credential'
  | 'presence'
  | 'message'
  | 'mention';

export interface AgentIdentityViolation {
  surface: AgentIdentitySurface;
  expectedSessionId: string;
  actualSessionId: string;
}

/**
 * Returns every split-brain surface. Missing optional projections mean the
 * surface has not been created yet; a present but different id is a violation.
 */
export function agentIdentityViolations(identity: AgentIdentityProjection): AgentIdentityViolation[] {
  const surfaces: Array<[AgentIdentitySurface, string | undefined]> = [
    ['participant', identity.participantSessionId],
    ['credential', identity.credentialSessionId],
    ['presence', identity.presenceSessionId],
    ['message', identity.messageSessionId],
    ['mention', identity.mentionTargetSessionId],
  ];
  return surfaces.flatMap(([surface, actualSessionId]) => (
    actualSessionId && actualSessionId !== identity.sessionId
      ? [{ surface, expectedSessionId: identity.sessionId, actualSessionId }]
      : []
  ));
}

export interface AgentReliabilityIncident {
  protocolVersion: typeof AGENT_LIFECYCLE_PROTOCOL_VERSION;
  roomCode: string;
  participantId: string;
  sessionId: string;
  occurredAt: number;
  reason: AgentTerminationReason;
  actor: 'host' | 'server' | 'self' | 'unknown';
  lastCursor?: number;
  recoveryHint: 'rejoin' | 'reauthenticate' | 'contact_host' | 'none';
}

export function isAgentReliabilityIncident(value: unknown): value is AgentReliabilityIncident {
  if (!value || typeof value !== 'object') return false;
  const incident = value as Partial<AgentReliabilityIncident>;
  return incident.protocolVersion === AGENT_LIFECYCLE_PROTOCOL_VERSION
    && typeof incident.roomCode === 'string'
    && typeof incident.participantId === 'string'
    && typeof incident.sessionId === 'string'
    && typeof incident.occurredAt === 'number'
    && Number.isFinite(incident.occurredAt)
    && AGENT_TERMINATION_REASONS.includes(incident.reason as AgentTerminationReason)
    && ['host', 'server', 'self', 'unknown'].includes(String(incident.actor))
    && ['rejoin', 'reauthenticate', 'contact_host', 'none'].includes(String(incident.recoveryHint));
}
