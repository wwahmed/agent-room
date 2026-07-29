import { readFileSync } from 'node:fs';
import type { Message } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { checkViewAction, viewActionKey } from './viewAction.js';

const serverIndex = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function sourceMessage(viewJson: string, over: Partial<Message> = {}): Message {
  return {
    id: 100, type: 'msg', name: 'MailAgent', client: 'cc', role: 'AI Agent',
    initials: 'MA', color: '#000', time: 1, text: 'Here you go:\n\n```wakiview\n' + viewJson + '\n```',
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
      finder(sourceMessage('', { text: 'just a message' })));
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.reason).toMatch(/no structured view/);

    const corrupt = await checkViewAction({ actionId: 'a', sourceMessageId: 100 },
      finder(sourceMessage('{"v":1,"kind":"nope"}')));
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok) expect(corrupt.reason).toMatch(/not valid/);
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

  it('the send path gates on validation and enforces the key server-side', async () => {
    // Client-side protections bind an honest client only; these two lines are what
    // make the guarantee hold against a forged or replayed request.
    expect(serverIndex).toContain('const verdict = await checkViewAction(claim,');
    expect(serverIndex).toContain("err.name = 'BadRequestError'");
    expect(serverIndex).toContain("redis.set(reservation, '1', 'EX', 86_400, 'NX')");
    expect(serverIndex).toContain('const reservation = viewActionKey(code, verdict.sourceMessageId, verdict.actionId);');
    // The stored metadata is rebuilt from validated facts, so neither the receipt
    // label nor the named producer can be dictated by the requester.
    expect(serverIndex).toContain('label: verdict.label,');
    expect(serverIndex).toContain('sourceSender: verdict.sourceSender,');
  });

  it('a failed or no-op append RELEASES the reservation', () => {
    // Otherwise a crash in the reservation->append window burns the intent forever:
    // no receipt, and no way to retry. A duplicate would have been the better bug.
    expect(serverIndex).toContain('if (viewActionReservation) await redis.del(viewActionReservation)');
    expect(serverIndex).toContain('if (viewActionReservation && !appendResult.appended)');
  });
});
