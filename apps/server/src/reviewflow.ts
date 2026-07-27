// T-16: review handoff — the board routes attention instead of waiting to be
// polled. A submitted task pages its verifier in the room (the @mention is
// what makes a listening agent's loop flag it, and what earns the host a
// push); a verdict pages the owner so builders learn accept/reject without
// re-reading the board. Composition lives here, pure and testable; the board
// actions call these best-effort — routing must never fail a submit/verify.

export interface RoutableTask {
  id: string;
  title: string;
  owner?: string;
  verifier?: string;
}

/** The room line posted when a task lands in awaiting_review. */
export function reviewHandoffLine(task: RoutableTask): string {
  const title = task.title ? ` "${task.title}"` : '';
  const owner = task.owner ? `@${task.owner}` : 'its owner';
  if (task.verifier && task.verifier !== task.owner) {
    return `📋 [REVIEW] @${task.verifier} — ${task.id}${title} was submitted by ${owner} with evidence and awaits your verdict. Rule on it from the Board tab or with room_task_verify.`;
  }
  // No usable designated verifier: open review — anyone but the owner.
  return `📋 [REVIEW] ${task.id}${title} was submitted by ${owner} with evidence. No designated verifier — any participant except the owner may rule on it (Board tab or room_task_verify).`;
}

/** The room line posted when a verifier rules on a task. */
export function verdictLine(task: RoutableTask, verdict: 'done' | 'rejected', verifiedBy: string, note?: string): string {
  const title = task.title ? ` "${task.title}"` : '';
  const owner = task.owner ? `@${task.owner}` : 'the owner';
  const suffix = note && note.trim() ? ` Note: ${note.trim()}` : '';
  if (verdict === 'done') {
    return `✅ [VERDICT] ${owner} — ${task.id}${title} was verified DONE by ${verifiedBy}.${suffix}`;
  }
  return `❌ [VERDICT] ${owner} — ${task.id}${title} was REJECTED by ${verifiedBy}. Rework and resubmit with fresh evidence.${suffix}`;
}

/** Push payload for the host when THEY are the designated verifier — the one
 *  case where a room line alone can go unseen for hours (humans don't hold
 *  listen loops). Null when the verifier isn't the host or isn't set. */
export function reviewPushForHost(
  task: RoutableTask,
  code: string,
  hostName: string,
): { title: string; body: string; url: string; tag: string } | null {
  if (!task.verifier || task.verifier !== hostName || task.verifier === task.owner) return null;
  return {
    title: `${task.id} awaits your verify`,
    body: `${task.owner ? `${task.owner} submitted ` : ''}${task.title}`.slice(0, 140),
    url: `/r/${code}`,
    tag: `review-${code}-${task.id}`,
  };
}
