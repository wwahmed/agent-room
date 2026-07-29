// T-46 rev3: server-side validation of a structured-view action request.
//
// rev2 restricted action ids to an opaque token and moved the label out of message
// text. A verifier then made the obvious next point: all of that is CLIENT-side, so
// it constrains an honest client and nothing else. A forged or replayed request can
// carry any actionId, any label, any sourceMessageId, and the server would append
// it unquestioned — including a receipt whose label is whatever the requester says
// it is.
//
// So the server resolves the claim instead of trusting it:
//
//   1. The source message must exist.
//   2. It must actually contain a v1 structured view.
//   3. That view must declare an action with exactly this id.
//   4. The receipt label is taken FROM THE VALIDATED VIEW, never from the request.
//   5. The (source message, action) pair may fire once — enforced in shared state,
//      so double clicks, retries, two tabs, a refresh and a replay all collapse to
//      one, which a client-generated nonce and a local ref cannot do.
//
// Actor binding needs no work here: the send path already authenticates the sender
// against its participant row (T-30 F2), so the request is attributed to whoever
// proved they own that row.

import type { Message } from '@agent-room/shared';
import { extractViewBlock, parseStructuredView } from '@agent-room/shared';

export interface ViewActionClaim {
  actionId?: unknown;
  label?: unknown;
  sourceMessageId?: unknown;
  viewVersion?: unknown;
  nonce?: unknown;
}

export type ViewActionCheck =
  | { ok: true; actionId: string; label: string; sourceMessageId: number; sourceSender: string; sourceSenderClient: string }
  | { ok: false; reason: string };

/** The idempotency key that actually matters. A client nonce identifies a click;
 *  this identifies the INTENT, so two tabs pressing the same button collapse. */
export function viewActionKey(code: string, sourceMessageId: number, actionId: string): string {
  return `viewaction:${code}:${sourceMessageId}:${actionId}`;
}

/**
 * Validate a claim against the real source message.
 *
 * `findMessage` is injected so this stays a pure decision, testable without a
 * store. Returning the source SENDER lineage lets the caller bind the request to
 * the agent that offered the action rather than to whichever agent answers first.
 */
export async function checkViewAction(
  claim: ViewActionClaim,
  findMessage: (id: number) => Promise<Message | null>,
): Promise<ViewActionCheck> {
  const actionId = typeof claim.actionId === 'string' ? claim.actionId : '';
  const sourceMessageId = Number(claim.sourceMessageId);
  if (!actionId) return { ok: false, reason: 'viewAction.actionId is required' };
  if (!Number.isFinite(sourceMessageId)) return { ok: false, reason: 'viewAction.sourceMessageId must be a number' };

  const source = await findMessage(sourceMessageId);
  // A deleted or trimmed source cannot authorise anything, and saying so beats
  // appending a request nobody can trace back.
  if (!source) return { ok: false, reason: 'the message this action came from no longer exists' };

  const block = extractViewBlock(String(source.text ?? ''));
  if (!block) return { ok: false, reason: 'the source message contains no structured view' };

  const parsed = parseStructuredView(block.json);
  if (!parsed.ok) return { ok: false, reason: `the source view is not valid: ${parsed.reason}` };

  const view = parsed.view;
  const declared = view.kind === 'detail' || view.kind === 'draft' ? view.actions ?? [] : [];
  // `confirm` offers its two buttons implicitly rather than in an actions array.
  const implicit = view.kind === 'confirm'
    ? [{ id: 'confirm', label: view.confirmLabel }, { id: 'cancel', label: view.cancelLabel || 'Cancel' }]
    : [];
  const match = [...declared, ...implicit].find(a => a.id === actionId);
  if (!match) {
    return { ok: false, reason: `the source view does not offer an action called ${JSON.stringify(actionId)}` };
  }

  return {
    ok: true,
    actionId,
    // From the validated view — a request cannot choose what the receipt says.
    label: match.label,
    sourceMessageId,
    sourceSender: String(source.name ?? ''),
    sourceSenderClient: String(source.client ?? ''),
  };
}
