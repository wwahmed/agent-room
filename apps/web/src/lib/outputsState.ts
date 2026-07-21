import type { RoomArtifact } from '@agent-room/shared';

// T-71: pure view-state logic for the Outputs page and contextual rail —
// extracted so each demanded failure mode is unit-testable without
// rendering the Room monolith.

export interface ArtifactFetchState {
  room: string;
  artifacts: RoomArtifact[];
}

/** Stale data is unrenderable BY CONSTRUCTION: a fetch result only counts
 *  for the room it was fetched for, so room A's outputs can never flash
 *  while room B loads (rev15 review item 3). */
export function artifactsForRoom(state: ArtifactFetchState | null, code: string): RoomArtifact[] | null {
  return state && state.room === code ? state.artifacts : null;
}

export type OutputsView = 'loading' | 'error' | 'ready';

/** Initial load shows Loading, never a false zero; an error with no data is
 *  the error state; data always wins over a background refresh error. */
export function outputsViewState(artifacts: RoomArtifact[] | null, error: boolean): OutputsView {
  if (artifacts != null) return 'ready';
  return error ? 'error' : 'loading';
}

export function producedWorkOf(artifacts: RoomArtifact[]): RoomArtifact[] {
  return artifacts.filter(a => a.kind !== 'status');
}

/** The rail earns its column only with two populated PRODUCED-work-aware
 *  sections; STATUS never counts (rev15 review item 8). */
export function railSectionCount(agentCount: number, taskCount: number, artifacts: RoomArtifact[] | null): number {
  return [agentCount > 0, taskCount > 0, producedWorkOf(artifacts ?? []).length > 0].filter(Boolean).length;
}

/** A freshly arrived line-level marker should refresh the durable index
 *  promptly instead of waiting out the minute poll. */
export function hasLineMarker(texts: Array<string | undefined>): boolean {
  return texts.some(t => /^ {0,3}\[(DECISION|TODO|STATUS|RESULT)\]/im.test(t ?? ''));
}

export type SeekAction = 'found' | 'load-more' | 'wait' | 'give-up-trimmed' | 'give-up-error';

/** One decision step of the source-seek loop (rev17 item 5: the loop must
 *  be BOUNDED — repeated loadOlder failures with hasOlder stuck true would
 *  otherwise retry forever). */
export function seekStep(found: boolean, hasOlder: boolean, loadingOlder: boolean, attempts: number, maxAttempts: number): SeekAction {
  if (found) return 'found';
  if (attempts >= maxAttempts) return 'give-up-error';
  if (!hasOlder) return 'give-up-trimmed';
  return loadingOlder ? 'wait' : 'load-more';
}

/** The seek's page budget is the room's ACTUAL retained history, not a
 *  blind retry count: total messages over the page size, plus slack. */
export function seekPageBudget(messageTotal: number, pageSize: number): number {
  return Math.ceil(Math.max(1, messageTotal) / Math.max(1, pageSize)) + 2;
}

export interface SeekTicket { generation: number; code: string; target: number }

/** rev19 item 1: every async seek completion must prove it still speaks for
 *  the CURRENT seek — same generation, same room, same target. State reset
 *  is not cancellation; this is. */
export function isCurrentSeek(ticket: SeekTicket, current: { generation: number; code: string; target: number | null }): boolean {
  return ticket.generation === current.generation
    && ticket.code === current.code
    && ticket.target === current.target;
}

export type SeekExit = 'found' | 'failed-page' | 'give-up-trimmed' | 'give-up-error';
/** Failure identity is the ARTIFACT (the card the user activated), not the
 *  source message — one message can yield several cards, and exactly one of
 *  them failed (rev20b implementation review). Source id rides along for
 *  the jump itself. */
export interface SeekRecovery { artifactId: string; sourceMessageId: number; reason: 'failed-page' | 'exhausted' }

/** rev20b: BOTH recoverable exits route through one recovery state keyed to
 *  the originating card; the genuinely trimmed source is terminal — toast
 *  only, never a retry. */
export function seekExitRecovery(exit: SeekExit, artifactId: string, sourceMessageId: number): { recovery: SeekRecovery | null; terminalToast: string | null } {
  if (exit === 'failed-page') return { recovery: { artifactId, sourceMessageId, reason: 'failed-page' }, terminalToast: null };
  if (exit === 'give-up-error') return { recovery: { artifactId, sourceMessageId, reason: 'exhausted' }, terminalToast: null };
  if (exit === 'give-up-trimmed') return { recovery: null, terminalToast: 'The source message is no longer available in this room\u2019s history.' };
  return { recovery: null, terminalToast: null };
}

/** Exactly ONE card wears the failure: the activated artifact, never its
 *  same-source siblings. */
export function isFailedCard(recovery: SeekRecovery | null, artifactId: string): boolean {
  return recovery != null && recovery.artifactId === artifactId;
}

export type SeekFailureEvent =
  | { type: 'exit'; exit: SeekExit; artifactId: string; sourceMessageId: number }
  | { type: 'retry' }
  | { type: 'found' }
  | { type: 'room-change' };

/** The COMPLETE failure-state transition table the component dispatches
 *  through — every clearing path (retry, success, room change) is a tested
 *  transition, not an ad-hoc setState. */
export function seekFailureReducer(state: SeekRecovery | null, ev: SeekFailureEvent): SeekRecovery | null {
  switch (ev.type) {
    case 'exit': return seekExitRecovery(ev.exit, ev.artifactId, ev.sourceMessageId).recovery;
    case 'retry':
    case 'found':
    case 'room-change':
      return null;
  }
}

interface FocusableCard { scrollIntoView(opts?: unknown): void; focus(): void }
interface CardRoot { querySelector(sel: string): FocusableCard | null }

/** Focus the EXACT recovery card if it exists in the current render;
 *  returns whether it did — a missing card is a no-op, never a stale
 *  focus on something else. */
export function focusRecoveryCard(artifactId: string, root: CardRoot): boolean {
  const card = root.querySelector(`[data-artifact-card="${artifactId.replace(/"/g, '')}"]`);
  if (!card) return false;
  card.scrollIntoView({ block: 'center' });
  card.focus();
  return true;
}

/** VA-0041: focus fires ONCE per failure identity, on the first render
 *  where the card exists. Dependency churn (polls, filters, pagination)
 *  after a successful focus does nothing; a NEW failure identity may focus
 *  once again; clearing the failure resets the latch. */
export function nextFocusAction(
  handled: string | null,
  failure: { artifactId: string } | null,
  cardMounted: boolean,
): { focus: boolean; handled: string | null } {
  if (!failure) return { focus: false, handled: null };
  if (handled === failure.artifactId) return { focus: false, handled };
  if (!cardMounted) return { focus: false, handled };
  return { focus: true, handled: failure.artifactId };
}
