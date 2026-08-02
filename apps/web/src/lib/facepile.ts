// T-34 (T-31 spec v2): pure logic for the room-card agent facepile.
// The server sends up to 4 agent faces (healthy-first), total/listening counts,
// and a stale count. Listening is the delivery truth; stale remains a separate
// stronger failure signal. This module keeps wording/windowing unit-testable.

export type AgentPresence = 'listening' | 'online' | 'working' | 'stale' | 'disconnected';

export interface AgentFace {
  name: string;
  color: string;
  initials: string;
  /** T-47: harness metadata for the provider badge (28px faces only). */
  harness?: string;
  state: AgentPresence;
}

// R1 (T-34 rev2): the cluster must fit the FIXED 64px identity column, so at
// most 3 circles render in total — 3 avatars when everyone fits, or 2 avatars
// + the "+N" chip when there is overflow. 28px circles at 14px overlap steps:
// 28 + 14 + 14 = 56px worst case, inside 64.
export const FACEPILE_VISIBLE_MAX = 3;

export type FacepileSeverity = 'healthy' | 'degraded' | 'down';

export function isStaleState(state: AgentPresence): boolean {
  return state === 'stale' || state === 'disconnected';
}

export function facepileSeverity(agentCount: number, staleCount: number, listeningCount: number): FacepileSeverity {
  if (agentCount <= 0) return 'healthy';
  if (staleCount >= agentCount) return 'down';
  if (listeningCount >= agentCount) return 'healthy';
  return 'degraded';
}

/** Faces shown as avatars, and how many fold into the "+N" overflow chip.
 *  Overflow counts from the TRUE agent count, not the capped payload. When
 *  overflow exists the chip takes the third circle slot (R1: never more than
 *  three circles total, so the cluster always fits the fixed column). */
export function facepileWindow(faces: AgentFace[], agentCount: number): { visible: AgentFace[]; overflow: number } {
  const avatarSlots = agentCount > FACEPILE_VISIBLE_MAX ? FACEPILE_VISIBLE_MAX - 1 : FACEPILE_VISIBLE_MAX;
  const visible = faces.slice(0, avatarSlots);
  return { visible, overflow: Math.max(0, agentCount - visible.length) };
}

/** The cluster's accessible name states the exact active-listener count rather
 * than the ambiguous former claim that connected agents were "responding." */
export function facepileLabel(agentCount: number, staleCount: number, listeningCount: number): string {
  const agents = `${agentCount} agent${agentCount === 1 ? '' : 's'}`;
  const listening = `${listeningCount} listening`;
  const stale = staleCount > 0
    ? `, ${staleCount} stale or disconnected`
    : '';
  return `${agents}, ${listening}${stale}. Open People panel.`;
}

/** Short tooltip line (S7: a real hover/focus tooltip, never a bare title). */
export function facepileTooltip(agentCount: number, staleCount: number, listeningCount: number): string {
  const agents = `${agentCount} agent${agentCount === 1 ? '' : 's'}`;
  const stale = staleCount > 0 ? ` · ${staleCount} stale` : '';
  return `${agents} · ${listeningCount} listening${stale}`;
}
