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

import { isWellFormedLineage } from './lineage.js';

export interface ViewActionClaim {
  actionId?: unknown;
  label?: unknown;
  sourceMessageId?: unknown;
  viewVersion?: unknown;
  nonce?: unknown;
}

export type ViewActionCheck =
  | {
      ok: true; actionId: string; label: string; sourceMessageId: number;
      sourceSender: string; sourceSenderClient: string;
      /** T-49: lineage of the session that OFFERED the action. Requests bind to
       *  this, so a request routes back to the producer session rather than to a
       *  display name that another participant could be wearing. */
      sourceLineage: string;
    }
  | {
      ok: false; reason: string;
      /** True when the refusal is a temporary state rather than a verdict: the
       *  producer session is simply not here. The client shows a retryable failure
       *  and the same click works again once that exact session resumes. */
      retryable?: boolean;
    };

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
  isLineagePresent?: (lineage: string) => boolean,
): Promise<ViewActionCheck> {
  const actionId = typeof claim.actionId === 'string' ? claim.actionId : '';
  const sourceMessageId = Number(claim.sourceMessageId);
  if (!actionId) return { ok: false, reason: 'viewAction.actionId is required' };
  if (!Number.isFinite(sourceMessageId)) return { ok: false, reason: 'viewAction.sourceMessageId must be a number' };

  const source = await findMessage(sourceMessageId);
  // A deleted or trimmed source cannot authorise anything, and saying so beats
  // appending a request nobody can trace back.
  if (!source) return { ok: false, reason: 'the message this action came from no longer exists' };

  // T-49: an UNBOUND source cannot authorise anything. Messages predating lineage
  // carry no session identity, and the alternative — inferring the producer from
  // name + client — is precisely the guesswork this replaced: names are mutable,
  // they duplicate, and a rejoined session wears the same one. Fail closed.
  // A system message is never actionable, and for this task a web-authored view is
  // fail-closed too: routing a request to a human's session needs an owner-selected
  // target, which does not exist yet. Agent-authored views only.
  if (source.type === 'sys') return { ok: false, reason: 'system messages are not actionable' };
  if (source.client !== 'cc') {
    return { ok: false, reason: 'only agent-authored views offer actions' };
  }
  const sourceLineage = source.metadata?.senderLineage;
  if (!isWellFormedLineage(sourceLineage)) {
    return { ok: false, reason: 'the source message has no session lineage, so its actions are disabled' };
  }

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

  // T-49 target binding, enforced rather than recorded. A request is addressed to
  // the exact session that offered it, so it must be here to receive it. Absence is
  // a RETRYABLE state, not retirement: an agent that reconnects on the same
  // credential keeps its lineage and its old cards start working again, while a
  // replacement wearing the same display name never inherits them.
  if (isLineagePresent && !isLineagePresent(sourceLineage)) {
    return {
      ok: false,
      retryable: true,
      reason: `${source.name || 'The agent'} — the session that offered this action — is not in the room right now. It will work again when that session resumes.`,
    };
  }

  return {
    ok: true,
    actionId,
    // From the validated view — a request cannot choose what the receipt says.
    label: match.label,
    sourceMessageId,
    sourceSender: String(source.name ?? ''),
    sourceSenderClient: String(source.client ?? ''),
    sourceLineage,
  };
}

// ---------------------------------------------------------------------------
// Crash safety across the reservation -> append window.
//
// A verifier's objection, and it was right: `SET NX` then append is not atomic.
// Release-on-caught-exception is hygiene; it does nothing for a SIGKILL between the
// two, which leaves the intent permanently "used" with no receipt and no way to
// retry — strictly worse than the duplicate the reservation existed to prevent.
//
// So the reservation is a DURABLE RECORD rather than a flag, and a later attempt
// reconciles it against reality: if a pending record is older than the window any
// real request completes in, we look for the receipt it should have produced. A
// receipt means it really did fire (mark done, refuse the duplicate). No receipt
// means the process died holding the reservation, so the intent is taken over and
// allowed to proceed.
// ---------------------------------------------------------------------------

/** How long a pending reservation is believed before it is reconciled. Long enough
 *  that two tabs racing collapse on the fast path; short enough that a crash does
 *  not strand a button for a human's attention span. */
export const PENDING_RECONCILE_MS = 10_000;

export interface ReservationRecord {
  /** 'pending' = claimed, receipt not confirmed. 'done' = a receipt exists. */
  s: 'pending' | 'done';
  at: number;
  /** Unique owner of this attempt. Every takeover/release/promotion is
   * compare-and-set against this token so a stale process cannot mutate a
   * successor's reservation. */
  token?: string;
  /** Message id of the receipt, once there is one. */
  id?: number;
}

export function pendingRecord(now: number, token?: string): string {
  return JSON.stringify({ s: 'pending', at: now, ...(token ? { token } : {}) } satisfies ReservationRecord);
}
export function doneRecord(now: number, messageId: number | null): string {
  return JSON.stringify({ s: 'done', at: now, ...(messageId === null ? {} : { id: messageId }) } satisfies ReservationRecord);
}

export function parseReservation(raw: unknown): ReservationRecord | null {
  if (typeof raw !== 'string' || !raw) return null;
  // A pre-record reservation (the old literal '1') is a real claim that we cannot
  // date. Treat anything unrecognised as pending from time zero so it reconciles
  // immediately, rather than either ignoring a live claim or blocking the intent
  // until tomorrow's TTL.
  const undatable: ReservationRecord = { s: 'pending', at: 0 };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undatable;
  }
  if (typeof v !== 'object' || v === null) return undatable;
  const rec = v as Partial<ReservationRecord>;
  if (rec.s !== 'pending' && rec.s !== 'done') return undatable;
  return {
    s: rec.s,
    at: Number(rec.at) || 0,
    ...(typeof rec.id === 'number' ? { id: rec.id } : {}),
    ...(typeof rec.token === 'string' && rec.token ? { token: rec.token } : {}),
  };
}

/** Atomic compare-and-replace/delete scripts. The expected value is the exact
 * serialized record observed by the caller, eliminating the stale GET→SET and
 * stale-owner DEL races. */
export const RESERVATION_REPLACE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end";
export const RESERVATION_DELETE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

export interface ReservationStore {
  command<T>(command: readonly (string | number)[]): Promise<T>;
}

export type ReservationClaim =
  | { ok: true; ownedValue: string }
  | { ok: false; reason: 'in_flight' | 'duplicate' | 'lost_race' };

/** Claim or safely take over one action intent. Every mutation compares the exact
 * record observed, so two stale reclaimers cannot both win. */
export async function claimReservation(
  store: ReservationStore,
  key: string,
  now: number,
  token: string,
  receiptExists: () => Promise<boolean>,
): Promise<ReservationClaim> {
  const ownedValue = pendingRecord(now, token);
  const fresh = await store.command<string | null>(['SET', key, ownedValue, 'EX', 86_400, 'NX']);
  if (fresh !== null) return { ok: true, ownedValue };

  const observed = await store.command<string | null>(['GET', key]);
  if (observed === null) {
    const retry = await store.command<string | null>(['SET', key, ownedValue, 'EX', 86_400, 'NX']);
    return retry === null ? { ok: false, reason: 'lost_race' } : { ok: true, ownedValue };
  }
  const record = parseReservation(observed);
  if (record?.s === 'done') return { ok: false, reason: 'duplicate' };
  if (record && now - record.at < PENDING_RECONCILE_MS) return { ok: false, reason: 'in_flight' };
  if (await receiptExists()) return { ok: false, reason: 'duplicate' };

  const replaced = Number(await store.command([
    'EVAL', RESERVATION_REPLACE_SCRIPT, 1, key, observed, ownedValue, 86_400,
  ]));
  return replaced === 1
    ? { ok: true, ownedValue }
    : { ok: false, reason: 'lost_race' };
}

export async function releaseReservation(
  store: ReservationStore,
  key: string,
  ownedValue: string,
): Promise<boolean> {
  return Number(await store.command([
    'EVAL', RESERVATION_DELETE_SCRIPT, 1, key, ownedValue,
  ])) === 1;
}

export async function completeReservation(
  store: ReservationStore,
  key: string,
  ownedValue: string,
  doneValue: string,
): Promise<boolean> {
  return Number(await store.command([
    'EVAL', RESERVATION_REPLACE_SCRIPT, 1, key, ownedValue, doneValue, 86_400,
  ])) === 1;
}

export type ReservationVerdict = 'duplicate' | 'takeover' | 'wait';

/**
 * Decide what a losing writer should do, given the record it collided with.
 *
 * Pure so the crash case is testable without killing a process: 'wait' means a
 * request is genuinely in flight (two tabs, a double click), 'duplicate' means a
 * receipt exists, 'takeover' means someone died holding the claim.
 */
export function reconcileReservation(
  record: ReservationRecord | null,
  receiptExists: boolean,
  now: number,
  staleAfterMs: number = PENDING_RECONCILE_MS,
): ReservationVerdict {
  if (!record) return 'takeover';        // key vanished under us
  if (record.s === 'done') return 'duplicate';
  if (receiptExists) return 'duplicate'; // it did fire; the record just lagged
  if (now - record.at < staleAfterMs) return 'wait';
  return 'takeover';
}

/** Is this message the receipt for that intent? Used to reconcile a stale claim
 *  against what the transcript actually contains. */
export function isReceiptFor(m: Message, sourceMessageId: number, actionId: string): boolean {
  const va = m.metadata?.viewAction;
  return !!va && Number(va.sourceMessageId) === sourceMessageId && va.actionId === actionId;
}

// ---------------------------------------------------------------------------
// The other half of target binding: only the addressed session may ACK.
// ---------------------------------------------------------------------------

export type AckCheck =
  | { ok: true; requestMessageId: number; actionId: string; label: string; requestedBy: string }
  | { ok: false; reason: string; forbidden?: boolean };

/**
 * Validate an acknowledgement of a view-action request.
 *
 * Recording the producer lineage on a request only documents an intention; this is
 * what makes it an ENFORCEMENT. A request is addressed to one session, and any other
 * participant claiming to have taken it is refused — so "whichever agent answers
 * first" cannot pick up work addressed elsewhere.
 */
export function checkViewActionAck(
  requestMessage: Message | null,
  ackerLineage: string | null,
): AckCheck {
  if (!requestMessage) return { ok: false, reason: 'the request being acknowledged no longer exists' };
  const va = requestMessage.metadata?.viewAction;
  if (!va) return { ok: false, reason: 'that message is not a view action request' };
  const target = va.sourceLineage;
  if (!isWellFormedLineage(target)) {
    return { ok: false, reason: 'that request is not bound to a session, so it cannot be acknowledged' };
  }
  if (!isWellFormedLineage(ackerLineage) || ackerLineage !== target) {
    return {
      ok: false,
      forbidden: true,
      reason: 'this request was addressed to a different session',
    };
  }
  return {
    ok: true,
    requestMessageId: Number(requestMessage.id),
    actionId: String(va.actionId ?? ''),
    label: String(va.label ?? ''),
    requestedBy: String(requestMessage.name ?? ''),
  };
}

export type ActionUpdateCheck =
  | {
      ok: true; requestMessageId: number; status: 'completed' | 'failed' | 'cancelled';
      actionId: string; label: string; requestedBy: string; note?: string;
    }
  | { ok: false; reason: string; forbidden?: boolean };

export function checkViewActionUpdate(
  requestMessage: Message | null,
  updaterLineage: string | null,
  claim: { status?: unknown; note?: unknown },
): ActionUpdateCheck {
  const bound = checkViewActionAck(requestMessage, updaterLineage);
  if (!bound.ok) return bound;
  const status = claim.status;
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
    return { ok: false, reason: 'status must be completed, failed, or cancelled' };
  }
  const rawNote = typeof claim.note === 'string' ? claim.note.trim() : '';
  if (rawNote.length > 500) return { ok: false, reason: 'status note is too long' };
  return {
    ...bound,
    status,
    ...(rawNote ? { note: rawNote } : {}),
  };
}
