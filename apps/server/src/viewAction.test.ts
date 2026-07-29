import { readFileSync } from 'node:fs';
import type { Message } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import {
  checkViewAction, checkViewActionAck, checkViewActionUpdate, doneRecord, isReceiptFor, parseReservation,
  claimReservation, completeReservation, pendingRecord, reconcileReservation,
  releaseReservation, RESERVATION_DELETE_SCRIPT, RESERVATION_REPLACE_SCRIPT,
  viewActionKey, type ReservationStore,
} from './viewAction.js';

const serverIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const LINEAGE = 'a'.repeat(32);   // well-formed 128-bit hex lineage

function sourceMessage(viewJson: string, over: Partial<Message> = {}): Message {
  return {
    id: 100, type: 'msg', name: 'MailAgent', client: 'cc', role: 'AI Agent',
    initials: 'MA', color: '#000', time: 1, text: 'Here you go:\n\n```wakiview\n' + viewJson + '\n```',
    metadata: { senderLineage: LINEAGE },
    ...over,
  } as Message;
}
const finder = (m: Message | null) => async () => m;

// T-46 rev3. rev2 restricted ids and moved the label out of message text, but a
// verifier pointed out all of it was CLIENT-side: it bound an honest client and
// nothing else. A forged or replayed request could name any action, any label, any
// source. The server has to resolve the claim rather than trust it.
describe('View action server validation', () => {
  const detail = JSON.stringify({
    v: 1, kind: 'detail', title: 'Invoice', fields: [],
    actions: [{ id: 'draft-reply-m1', label: 'Draft a reply' }],
  });

  it('accepts an action the source view actually declared', async () => {
    const r = await checkViewAction({ actionId: 'draft-reply-m1', sourceMessageId: 100 }, finder(sourceMessage(detail)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.actionId).toBe('draft-reply-m1');
      // Lineage of the agent that OFFERED the action, so the request can bind to it
      // rather than to whichever agent answers first.
      expect(r.sourceSender).toBe('MailAgent');
      expect(r.sourceSenderClient).toBe('cc');
      // Bound to the producer SESSION, which is what a request should route to.
      expect(r.sourceLineage).toBe(LINEAGE);
    }
  });

  it('takes the receipt label FROM THE VIEW, never from the request', async () => {
    // The forgery that motivated this: a request claiming a friendly label for an
    // action whose real label is something else entirely.
    const r = await checkViewAction(
      { actionId: 'draft-reply-m1', label: 'Approve payment of £1,240', sourceMessageId: 100 },
      finder(sourceMessage(detail)),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label).toBe('Draft a reply');
  });

  it('refuses an action the view never offered', async () => {
    const r = await checkViewAction({ actionId: 'wire-the-money', sourceMessageId: 100 }, finder(sourceMessage(detail)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not offer an action/);
  });

  it('refuses a missing source, a source with no view, and a corrupt view', async () => {
    const gone = await checkViewAction({ actionId: 'a', sourceMessageId: 100 }, finder(null));
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.reason).toMatch(/no longer exists/);

    const plain = await checkViewAction({ actionId: 'a', sourceMessageId: 100 },
      finder(sourceMessage('', { text: 'just a message', metadata: { senderLineage: LINEAGE } })));
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.reason).toMatch(/no structured view/);

    const corrupt = await checkViewAction({ actionId: 'a', sourceMessageId: 100 },
      finder(sourceMessage('{"v":1,"kind":"nope"}')));
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.reason).toMatch(/not valid/);
  });

  it('T-49: an UNBOUND source fails closed — never attributed by name', async () => {
    // Messages predating lineage carry no session identity. Inferring the producer
    // from name + client is exactly the guesswork lineage replaced: names are
    // mutable, they duplicate, and a rejoined session wears the same one.
    const unbound = await checkViewAction({ actionId: 'draft-reply-m1', sourceMessageId: 100 },
      finder(sourceMessage(detail, { metadata: {} })));
    expect(unbound.ok).toBe(false);
    if (!unbound.ok) expect(unbound.reason).toMatch(/no session lineage/);

    // A client-invented lineage that is not well-formed is refused too.
    for (const bogus of ['short', 'A'.repeat(32), 'z'.repeat(32), 123, null]) {
      const forged = await checkViewAction({ actionId: 'draft-reply-m1', sourceMessageId: 100 },
        finder(sourceMessage(detail, { metadata: { senderLineage: bogus as never } })));
      expect(forged.ok, String(bogus)).toBe(false);
    }
  });

  it('system and web-authored sources are never actionable', async () => {
    // A system line has no session to route to. A web-authored view would need an
    // owner-selected target lineage, which does not exist yet — so fail closed
    // rather than guess a recipient.
    const sys = await checkViewAction({ actionId: 'draft-reply-m1', sourceMessageId: 100 },
      finder(sourceMessage(detail, { type: 'sys' as never })));
    expect(sys.ok).toBe(false);
    if (!sys.ok) expect(sys.reason).toMatch(/system messages are not actionable/);

    const web = await checkViewAction({ actionId: 'draft-reply-m1', sourceMessageId: 100 },
      finder(sourceMessage(detail, { client: 'web' })));
    expect(web.ok).toBe(false);
    if (!web.ok) expect(web.reason).toMatch(/only agent-authored views/);
  });

  it('validates confirm buttons, which are implicit rather than declared', async () => {
    const confirm = JSON.stringify({ v: 1, kind: 'confirm', prompt: 'Send it?', confirmLabel: 'Send now' });
    const ok = await checkViewAction({ actionId: 'confirm', sourceMessageId: 100 }, finder(sourceMessage(confirm)));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.label).toBe('Send now');
    const cancel = await checkViewAction({ actionId: 'cancel', sourceMessageId: 100 }, finder(sourceMessage(confirm)));
    expect(cancel.ok).toBe(true);
    // An invented third button is still refused.
    const bogus = await checkViewAction({ actionId: 'send-anyway', sourceMessageId: 100 }, finder(sourceMessage(confirm)));
    expect(bogus.ok).toBe(false);
  });

  it('rejects a malformed claim before touching the store', async () => {
    let called = false;
    const spy = async () => { called = true; return null; };
    expect((await checkViewAction({ sourceMessageId: 100 }, spy)).ok).toBe(false);
    expect((await checkViewAction({ actionId: 'a', sourceMessageId: 'nope' }, spy)).ok).toBe(false);
    expect(called).toBe(false);
  });

  it('keys idempotency on the INTENT, not on a client nonce', async () => {
    // A nonce identifies a click; this identifies what was asked for, so two tabs
    // pressing the same button collapse into one request.
    expect(viewActionKey('a-b-c', 100, 'draft-reply-m1')).toBe('viewaction:a-b-c:100:draft-reply-m1');
    expect(viewActionKey('a-b-c', 100, 'draft-reply-m1')).toBe(viewActionKey('a-b-c', 100, 'draft-reply-m1'));
    expect(viewActionKey('a-b-c', 101, 'draft-reply-m1')).not.toBe(viewActionKey('a-b-c', 100, 'draft-reply-m1'));
  });

  it('an ABSENT producer session is a retryable 409, not retirement', async () => {
    // The verifier's ruling: continuity follows the exact session credential. If the
    // session that offered the action is not here, the action is unavailable NOW —
    // it must not be permanently retired, and it must never be rerouted to whoever
    // happens to be listening.
    const absent = await checkViewAction(
      { actionId: 'draft-reply-m1', sourceMessageId: 100 }, finder(sourceMessage(detail)),
      () => false,
    );
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.retryable).toBe(true);
      expect(absent.reason).toMatch(/not in the room right now/);
      expect(absent.reason).toMatch(/MailAgent/);          // names who is missing
      expect(absent.reason).toMatch(/work again/);          // says it comes back
    }

    // absent -> the SAME lineage resumes -> works again. A reconnect on the same
    // credential keeps its lineageId, so its old cards revive.
    const resumed = await checkViewAction(
      { actionId: 'draft-reply-m1', sourceMessageId: 100 }, finder(sourceMessage(detail)),
      (l) => l === LINEAGE,
    );
    expect(resumed.ok).toBe(true);

    // absent -> same NAME, new lineage -> still blocked. This is the replacement
    // hijack the whole scheme exists to stop.
    const impostor = await checkViewAction(
      { actionId: 'draft-reply-m1', sourceMessageId: 100 }, finder(sourceMessage(detail)),
      (l) => l === 'b'.repeat(32),
    );
    expect(impostor.ok).toBe(false);
    if (!impostor.ok) expect(impostor.retryable).toBe(true);
  });

  it('only the ADDRESSED session may acknowledge a request', () => {
    // Target binding as an enforcement rather than a record: recording the producer
    // lineage documents an intention, refusing every other session is the guarantee.
    const request = {
      id: 200, type: 'msg', name: 'Waqas', client: 'web', time: 2,
      metadata: { viewAction: { actionId: 'draft-reply-m1', label: 'Draft a reply', sourceMessageId: 100, sourceLineage: LINEAGE, viewVersion: 1, nonce: 'n' } },
    } as unknown as Message;

    const mine = checkViewActionAck(request, LINEAGE);
    expect(mine.ok).toBe(true);
    if (mine.ok) {
      expect(mine.actionId).toBe('draft-reply-m1');
      expect(mine.label).toBe('Draft a reply');
      expect(mine.requestedBy).toBe('Waqas');
    }

    // Another agent in the same room cannot pick up work addressed elsewhere, even
    // with the right room, the right request id and a valid lineage of its own.
    const other = checkViewActionAck(request, 'b'.repeat(32));
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.forbidden).toBe(true);
      expect(other.reason).toMatch(/addressed to a different session/);
    }
    // Unbound sessions and forged values are refused as well.
    for (const bogus of [null, '', 'nope', 'A'.repeat(32)]) {
      expect(checkViewActionAck(request, bogus as never).ok, String(bogus)).toBe(false);
    }
    // Acking something that is not a request, or is gone, fails as a bad request
    // rather than as a permission problem.
    const notRequest = checkViewActionAck({ id: 1, metadata: {} } as unknown as Message, LINEAGE);
    expect(notRequest.ok).toBe(false);
    if (!notRequest.ok) expect(notRequest.forbidden).toBeUndefined();
    expect(checkViewActionAck(null, LINEAGE).ok).toBe(false);
  });

  it('only the addressed session may publish a bounded lifecycle outcome', () => {
    const request = {
      id: 200, type: 'msg', name: 'Waqas', client: 'web', time: 2,
      metadata: { viewAction: {
        actionId: 'draft-reply-m1', label: 'Draft a reply',
        sourceMessageId: 100, sourceLineage: LINEAGE, viewVersion: 1, nonce: 'n',
      } },
    } as unknown as Message;
    const completed = checkViewActionUpdate(request, LINEAGE, { status: 'completed' });
    expect(completed.ok).toBe(true);
    const failed = checkViewActionUpdate(request, LINEAGE, { status: 'failed', note: 'Mailbox unavailable' });
    expect(failed).toMatchObject({ ok: true, status: 'failed', note: 'Mailbox unavailable' });
    expect(checkViewActionUpdate(request, 'b'.repeat(32), { status: 'failed' })).toMatchObject({
      ok: false, forbidden: true,
    });
    expect(checkViewActionUpdate(request, LINEAGE, { status: 'invented' }).ok).toBe(false);
    expect(checkViewActionUpdate(request, LINEAGE, { status: 'failed', note: 'x'.repeat(501) }).ok).toBe(false);
  });

  it('survives a crash in the reservation -> append window', () => {
    // The verifier was right that releasing on caught exceptions is hygiene, not
    // crash safety: a SIGKILL between SET NX and the append burns the intent forever
    // with no receipt — worse than the duplicate the reservation prevents. So the
    // reservation is a dated record and a later attempt reconciles it.
    const t = 1_000_000;
    const receipt = { id: 5, metadata: { viewAction: { actionId: 'a1', sourceMessageId: 100 } } } as unknown as Message;
    expect(isReceiptFor(receipt, 100, 'a1')).toBe(true);
    expect(isReceiptFor(receipt, 101, 'a1')).toBe(false);
    expect(isReceiptFor(receipt, 100, 'a2')).toBe(false);
    expect(isReceiptFor({ id: 6, metadata: {} } as unknown as Message, 100, 'a1')).toBe(false);

    // Two tabs racing: the loser waits rather than duplicating.
    expect(reconcileReservation(parseReservation(pendingRecord(t)), false, t + 200)).toBe('wait');
    // A receipt exists: refuse the duplicate, whatever the record says.
    expect(reconcileReservation(parseReservation(pendingRecord(t)), true, t + 200)).toBe('duplicate');
    expect(reconcileReservation(parseReservation(doneRecord(t, 5)), false, t + 9_000_000)).toBe('duplicate');
    // The crash case: claim held, no receipt, long past any real request. Take over
    // so the button is not stranded until the TTL expires tomorrow.
    expect(reconcileReservation(parseReservation(pendingRecord(t)), false, t + 11_000)).toBe('takeover');
    // A pre-record reservation (the old literal '1') cannot be dated, so it
    // reconciles immediately instead of blocking the intent for a day.
    expect(parseReservation('1')).toEqual({ s: 'pending', at: 0 });
    expect(reconcileReservation(parseReservation('1'), false, t)).toBe('takeover');
    // A key that vanished under us is not a reason to refuse.
    expect(reconcileReservation(null, false, t)).toBe('takeover');
    expect(parseReservation(undefined)).toBeNull();
    expect(parseReservation(pendingRecord(t, 'owner-a'))).toEqual({
      s: 'pending', at: t, token: 'owner-a',
    });
    expect(RESERVATION_REPLACE_SCRIPT).toMatch(/GET.*ARGV\[1\].*SET/s);
    expect(RESERVATION_DELETE_SCRIPT).toMatch(/GET.*ARGV\[1\].*DEL/s);
  });

  it('allows exactly one stale takeover and protects the successor token', async () => {
    const values = new Map<string, string>();
    const store: ReservationStore = {
      async command<T>(parts: readonly (string | number)[]): Promise<T> {
        const [op, key] = parts.map(String);
        if (op === 'GET') return (values.get(key) ?? null) as T;
        if (op === 'SET') {
          if (parts.map(String).includes('NX') && values.has(key)) return null as T;
          values.set(key, String(parts[2]));
          return 'OK' as T;
        }
        if (op === 'EVAL') {
          const script = String(parts[1]);
          const redisKey = String(parts[3]);
          const expected = String(parts[4]);
          if (values.get(redisKey) !== expected) return 0 as T;
          if (script === RESERVATION_DELETE_SCRIPT) values.delete(redisKey);
          else values.set(redisKey, String(parts[5]));
          return 1 as T;
        }
        throw new Error(`unsupported ${op}`);
      },
    };
    const key = 'intent';
    values.set(key, pendingRecord(1, 'dead-owner'));
    const [a, b] = await Promise.all([
      claimReservation(store, key, 20_000, 'owner-a', async () => false),
      claimReservation(store, key, 20_000, 'owner-b', async () => false),
    ]);
    expect([a, b].filter(x => x.ok)).toHaveLength(1);
    const winner = a.ok ? a : b as Extract<typeof b, { ok: true }>;
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    expect(await releaseReservation(store, key, pendingRecord(1, 'dead-owner'))).toBe(false);
    expect(values.get(key)).toBe(winner.ownedValue);
    expect(await completeReservation(store, key, winner.ownedValue, doneRecord(21_000, 7))).toBe(true);
    expect(parseReservation(values.get(key))?.s).toBe('done');
  });

  it('the send path gates on validation and enforces the key server-side', async () => {
    // Client-side protections bind an honest client only; these two lines are what
    // make the guarantee hold against a forged or replayed request.
    expect(serverIndex).toContain('const verdict = await checkViewAction(');
    expect(serverIndex).toContain("err.name = 'BadRequestError'");
    expect(serverIndex).toContain('const reservationClaim = await claimReservation(');
    // Liveness is checked against the CURRENT rows, and a missing producer maps to a
    // 409 the client can retry rather than a 400 that reads like a bad card.
    expect(serverIndex).toContain("err.name = verdict.retryable ? 'ViewActionUnavailableError'");
    expect(serverIndex).toContain('(lineage) => liveLineages.has(lineage)');
    // A confirmed receipt promotes the record, so reconciliation is cheap.
    expect(serverIndex).toContain('doneRecord(Date.now()');
    expect(serverIndex).toContain('const reservation = viewActionKey(code, verdict.sourceMessageId, verdict.actionId);');
    // The stored metadata is rebuilt from validated facts, so neither the receipt
    // label nor the named producer can be dictated by the requester.
    expect(serverIndex).toContain('label: verdict.label,');
    expect(serverIndex).toContain('sourceSender: verdict.sourceSender,');
  });

  it('a failed or no-op append RELEASES the reservation', () => {
    // Otherwise a crash in the reservation->append window burns the intent forever:
    // no receipt, and no way to retry. A duplicate would have been the better bug.
    expect(serverIndex).toContain('releaseReservation(');
    expect(serverIndex).toContain('if (viewActionReservation && !appendResult.appended)');
    expect(serverIndex).not.toContain('redis.del(viewActionReservation)');
  });
});
