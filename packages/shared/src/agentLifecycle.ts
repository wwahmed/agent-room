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

export interface AgentAliasCandidate {
  sessionId: string;
  displayName: string;
  requestedAlias?: string;
  role?: string;
  joinedAt: number;
}

export interface AgentAliasAssignment extends AgentAliasCandidate {
  /** Present only when a same-name live sibling requires disambiguation. */
  visibleAlias?: string;
}

const normalizedLabel = (value: string | undefined): string | undefined => {
  const label = value?.trim().replace(/\s+/g, ' ');
  return label || undefined;
};

/**
 * Assigns deterministic, human-visible aliases to concurrently live sessions
 * that share a display name. Identity remains sessionId; aliases are labels.
 */
export function assignVisibleAgentAliases(candidates: readonly AgentAliasCandidate[]): AgentAliasAssignment[] {
  const groups = new Map<string, AgentAliasCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.displayName.trim().toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const aliases = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.joinedAt - b.joinedAt || a.sessionId.localeCompare(b.sessionId));
    const claimed = new Map<string, number>();
    for (const candidate of ordered) {
      const base = normalizedLabel(candidate.requestedAlias) ?? normalizedLabel(candidate.role) ?? 'session';
      const key = base.toLocaleLowerCase();
      const ordinal = (claimed.get(key) ?? 0) + 1;
      claimed.set(key, ordinal);
      aliases.set(candidate.sessionId, ordinal === 1 && !ordered.some(
        other => other.sessionId !== candidate.sessionId
          && (normalizedLabel(other.requestedAlias) ?? normalizedLabel(other.role) ?? 'session').toLocaleLowerCase() === key,
      ) ? base : `${base} ${ordinal}`);
    }
  }

  return candidates.map(candidate => ({
    ...candidate,
    ...(aliases.has(candidate.sessionId) ? { visibleAlias: aliases.get(candidate.sessionId) } : {}),
  }));
}

export const AGENT_ACTIVITY_KINDS = [
  'joined',
  'reconnected',
  'renamed',
  'listening',
  'degraded',
  'stale',
  'swept',
  'self_left',
  'host_removed',
  'identity_replaced',
  'credential_issued',
  'credential_rotated',
  'credential_rejected',
  'incident_opened',
  'incident_acknowledged',
  'incident_resolved',
  'recovery_started',
  'recovery_succeeded',
  'recovery_failed',
] as const;

export type AgentActivityKind = typeof AGENT_ACTIVITY_KINDS[number];

export interface AgentActivityEvent {
  eventId: string;
  protocolVersion: typeof AGENT_LIFECYCLE_PROTOCOL_VERSION;
  roomCode: string;
  participantId: string;
  sessionId: string;
  occurredAt: number;
  kind: AgentActivityKind;
  actor: 'host' | 'server' | 'self' | 'custodian' | 'unknown';
  mechanism: string;
  reason?: AgentTerminationReason;
  outcome: 'succeeded' | 'failed' | 'observed';
  supersedesEventId?: string;
}

export function isAgentActivityEvent(value: unknown): value is AgentActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<AgentActivityEvent>;
  return event.protocolVersion === AGENT_LIFECYCLE_PROTOCOL_VERSION
    && typeof event.eventId === 'string' && event.eventId.length > 0
    && typeof event.roomCode === 'string' && event.roomCode.length > 0
    && typeof event.participantId === 'string' && event.participantId.length > 0
    && typeof event.sessionId === 'string' && event.sessionId.length > 0
    && typeof event.occurredAt === 'number' && Number.isFinite(event.occurredAt)
    && AGENT_ACTIVITY_KINDS.includes(event.kind as AgentActivityKind)
    && ['host', 'server', 'self', 'custodian', 'unknown'].includes(String(event.actor))
    && typeof event.mechanism === 'string' && event.mechanism.length > 0
    && ['succeeded', 'failed', 'observed'].includes(String(event.outcome))
    && (event.reason === undefined || AGENT_TERMINATION_REASONS.includes(event.reason));
}

/** Append-only + idempotent by eventId. Conflicting replays fail closed. */
export function appendAgentActivity(
  ledger: readonly AgentActivityEvent[],
  event: AgentActivityEvent,
): AgentActivityEvent[] {
  if (!isAgentActivityEvent(event)) throw new TypeError('Invalid agent activity event.');
  const previous = ledger.find(entry => entry.eventId === event.eventId);
  if (!previous) return [...ledger, event];
  if (JSON.stringify(previous) !== JSON.stringify(event)) {
    throw new Error(`Agent activity event "${event.eventId}" conflicts with its existing append-only record.`);
  }
  return [...ledger];
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
