// T-34 (T-31 spec v2): pure logic for the room-card agent facepile.
// The server sends up to 4 agent faces (healthy-first) plus agentCount and
// agentStaleCount; this module turns that into what the cluster renders and
// says. Kept out of the component so the wording and windowing are unit-tested.

export type AgentPresence = 'listening' | 'online' | 'stale' | 'disconnected';

export interface AgentFace {
  name: string;
  color: string;
  initials: string;
  state: AgentPresence;
}

export const FACEPILE_VISIBLE_MAX = 3;

export type FacepileSeverity = 'healthy' | 'degraded' | 'down';

export function isStaleState(state: AgentPresence): boolean {
  return state === 'stale' || state === 'disconnected';
}

export function facepileSeverity(agentCount: number, staleCount: number): FacepileSeverity {
  if (staleCount <= 0) return 'healthy';
  return staleCount >= agentCount ? 'down' : 'degraded';
}

/** Faces shown as avatars, and how many fold into the "+N" overflow chip.
 *  Overflow counts from the TRUE agent count, not the capped payload. */
export function facepileWindow(faces: AgentFace[], agentCount: number): { visible: AgentFace[]; overflow: number } {
  const visible = faces.slice(0, FACEPILE_VISIBLE_MAX);
  return { visible, overflow: Math.max(0, agentCount - visible.length) };
}

/** The cluster's accessible name. Severity is worded, never color-only:
 *  "2 agents, 1 needs attention. Open People panel." */
export function facepileLabel(agentCount: number, staleCount: number): string {
  const agents = `${agentCount} agent${agentCount === 1 ? '' : 's'}`;
  const severity = facepileSeverity(agentCount, staleCount);
  if (severity === 'healthy') return `${agents}, all responding. Open People panel.`;
  if (severity === 'down') return `${agents}, none responding. Open People panel.`;
  return `${agents}, ${staleCount} need${staleCount === 1 ? 's' : ''} attention. Open People panel.`;
}

/** Short tooltip line (S7: a real hover/focus tooltip, never a bare title). */
export function facepileTooltip(agentCount: number, staleCount: number): string {
  const severity = facepileSeverity(agentCount, staleCount);
  if (severity === 'healthy') return `${agentCount} agent${agentCount === 1 ? '' : 's'} · all responding`;
  if (severity === 'down') return `${agentCount} agent${agentCount === 1 ? '' : 's'} · none responding`;
  return `${staleCount} of ${agentCount} agents need attention`;
}
