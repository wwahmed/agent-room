// P0 End truthfulness — EXECUTED.
//
// The defect these lock down: every failure path used to set ended=true, so a
// nonhost's rejected End rendered an active room as finished.

import { describe, it, expect } from 'vitest';
import { endOutcome, endFailureMessage, canOfferEnd, idlePromptCopy } from './endRoomOutcome.js';

describe('only an authoritative success ends the room', () => {
  it('transitions on a confirmed success', () => {
    expect(endOutcome({ ok: true })).toEqual({ ended: true });
  });

  const failures: Array<[string, unknown]> = [
    ['a server rejection (nonhost)', new Error('Only the host can end this room.')],
    ['a network drop', new Error('Failed to fetch')],
    ['a non-JSON / parse failure', new SyntaxError('Unexpected token < in JSON at position 0')],
    ['a thrown non-Error value', 'boom'],
    ['a thrown undefined', undefined],
  ];

  for (const [label, thrown] of failures) {
    it(`does NOT end the room on ${label}`, () => {
      const out = endOutcome({ thrown });
      expect(out.ended).toBe(false);
      expect((out as { error: string }).error).toBeTruthy();
    });
  }

  it('every failure states the room is still active', () => {
    for (const [, thrown] of failures) {
      const out = endOutcome({ thrown });
      expect((out as { error: string }).error).toMatch(/still active/i);
    }
  });

  it('maps an authorization refusal to actionable copy naming who can act', () => {
    const out = endOutcome({ thrown: new Error('Only the host can end this room.') });
    expect((out as { error: string }).error).toMatch(/ask the host/i);
  });

  it('never renders raw exception text — no URLs, hosts, or stack fragments', () => {
    const leaky = new Error('FetchError: request to https://internal.host:8210/api/room failed, reason: ECONNREFUSED at Object.<anonymous> (/Users/someone/secret/path.js:1:1)');
    const msg = endFailureMessage(leaky);
    expect(msg).not.toContain('https://');
    expect(msg).not.toContain('/Users/');
    expect(msg).not.toContain('ECONNREFUSED');
    expect(msg).toMatch(/still active/i);
  });

  it('does not leak an oversized payload into the UI', () => {
    expect(endFailureMessage(new Error('x'.repeat(5000)))).not.toContain('xxxx');
  });

  it('every failure message tells the reader what to do next', () => {
    for (const thrown of [new Error('Only the host can end this room.'), new Error('Failed to fetch'), new SyntaxError('Unexpected token <'), 'boom']) {
      expect(endFailureMessage(thrown)).toMatch(/try again|reload|ask the host/i);
    }
  });
});

describe('the idle prompt does not offer authority a viewer lacks', () => {
  it('offers End to the host only', () => {
    expect(canOfferEnd(true)).toBe(true);
    expect(canOfferEnd(false)).toBe(false);
  });

  it('never tells a nonhost that they end the room', () => {
    expect(idlePromptCopy(false)).toContain('the host ends it');
    expect(idlePromptCopy(false)).not.toMatch(/until you end it/);
    expect(idlePromptCopy(true)).toContain('until you end it');
  });

  it('promises no attachment cleanup in either variant', () => {
    for (const copy of [idlePromptCopy(true), idlePromptCopy(false)]) {
      expect(copy).not.toMatch(/delete|purge|clean/i);
    }
  });
});
