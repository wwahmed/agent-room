// One removal verb (host order): "Remove from room" must mean ONE thing no
// matter where it's clicked. Historically the People-row × only removed the
// participant row (the process kept running) while Dismiss in the agent sheets
// only killed the process (the row could linger as a ghost). This module is
// the shared brain for the unified action: what the confirm dialog must say,
// which summoner record (if any) to dismiss alongside the row, how to badge a
// row's process state, and which stale rows a room-open sweep may clean up.

import type { SummonedAgent } from './api.js';

export interface RemovalParticipant {
  name: string;
  client: string; // 'web' | 'cc'
}

/** Newest summoner record for this (room-scoped) agent name, live or not. */
export function newestAgentFor(records: SummonedAgent[], name: string): SummonedAgent | null {
  const matches = records.filter((a) => a.name === name).sort((a, b) => b.createdAt - a.createdAt);
  return matches[0] ?? null;
}

/** The record whose process the unified removal should stop: the newest
 *  ACTIVE one. Dismissed/archived records have no process left to stop. */
export function liveAgentFor(records: SummonedAgent[], name: string): SummonedAgent | null {
  const matches = records
    .filter((a) => a.name === name && a.status === 'active')
    .sort((a, b) => b.createdAt - a.createdAt);
  return matches[0] ?? null;
}

export interface RemovalPlan {
  /** Summoner process to dismiss alongside the row; null = nothing we manage. */
  agentId: string | null;
  /** Exactly what will happen, shown in the confirm dialog. */
  confirm: string;
}

/** What clicking "Remove from room" will do for this participant — the same
 *  answer everywhere the button appears. */
export function removalPlan(p: RemovalParticipant, records: SummonedAgent[]): RemovalPlan {
  if (p.client !== 'cc') {
    return { agentId: null, confirm: `Remove ${p.name} from the room? They can rejoin with the room code.` };
  }
  const live = liveAgentFor(records, p.name);
  if (live) {
    const what = [live.provider, live.model].filter(Boolean).join(' · ');
    return {
      agentId: live.agentId,
      confirm:
        `Remove ${p.name} from the room?\n\n` +
        `This also stops its agent process on this Mac (${what || 'summoned agent'}). ` +
        `You can summon it again later.`,
    };
  }
  const newest = newestAgentFor(records, p.name);
  if (newest) {
    // We summoned it once, but the process is already gone — the row is stale.
    return {
      agentId: null,
      confirm:
        `Remove ${p.name} from the room?\n\n` +
        `Its agent process was already dismissed — this just clears the leftover row.`,
    };
  }
  return {
    agentId: null,
    confirm:
      `Remove ${p.name} from the room?\n\n` +
      `Its process isn't managed here (it joined by code), so nothing is stopped — ` +
      `it only loses its seat in this room.`,
  };
}

export interface ProcessBadge {
  label: string;
  tone: 'ok' | 'warn' | 'dead' | 'muted';
}

/** People-pane badge for an agent row's PROCESS (summoner registry view) —
 *  distinct from room presence, which is the server's listen-loop verdict.
 *  null for web rows (no process of ours) and while records are unknown. */
export function processBadge(p: RemovalParticipant, records: SummonedAgent[] | null): ProcessBadge | null {
  if (p.client !== 'cc' || records === null) return null;
  const newest = newestAgentFor(records, p.name);
  if (!newest) return { label: 'process not managed here', tone: 'muted' };
  const live = liveAgentFor(records, p.name);
  if (!live) return { label: 'process dismissed — row is stale', tone: 'dead' };
  if (live.health === 'online') return { label: 'process online', tone: 'ok' };
  if (live.health === 'starting') return { label: 'process starting', tone: 'warn' };
  return { label: `process ${live.health || 'stopped'}`, tone: 'dead' };
}

/** Ghost rows a room-open sweep may clear WITHOUT asking: we summoned the
 *  agent, its newest record says the process was dismissed/stopped being
 *  active, and the room server does not currently see it listening or online
 *  (a manually-resumed session keeps its seat). Conservative on unknowns:
 *  missing health rows are skipped, join-code agents are never touched. */
export function staleAgentRows(
  participants: RemovalParticipant[],
  records: SummonedAgent[],
  presenceStateFor: (p: RemovalParticipant) => string | null,
): RemovalParticipant[] {
  return participants.filter((p) => {
    if (p.client !== 'cc') return false;
    const newest = newestAgentFor(records, p.name);
    if (!newest) return false; // not ours to judge
    if (liveAgentFor(records, p.name)) return false; // process still active
    const state = presenceStateFor(p);
    return state === 'disconnected';
  });
}
