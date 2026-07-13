// T-30 negative tests for the send/presence authentication policy (F2/F3/F6/
// F7/F8 from the T-26 review). Each "attack" case must be denied.
import { describe, expect, it } from 'vitest';
import { decideSenderAuth } from './roomauth.js';

const KEYED = { memberKeyHash: 'aaa' };
const KEYED2 = { memberKeyHash: 'bbb' };
const KEYLESS = {};

describe('decideSenderAuth — credentialed row (F2/F3)', () => {
  it('denies a send with NO presented key', () => {
    expect(decideSenderAuth([KEYED], undefined, false)).toEqual({ ok: false, reason: 'need-key' });
    // flag state is irrelevant once the row is keyed — name never authenticates
    expect(decideSenderAuth([KEYED], undefined, true)).toEqual({ ok: false, reason: 'need-key' });
  });
  it('denies a send with the WRONG key', () => {
    expect(decideSenderAuth([KEYED], 'zzz', true)).toEqual({ ok: false, reason: 'bad-key' });
  });
  it('allows a send with the matching key', () => {
    expect(decideSenderAuth([KEYED], 'aaa', false)).toEqual({ ok: true, via: 'member-key' });
  });
  it('matches against any keyed row sharing the tuple', () => {
    expect(decideSenderAuth([KEYED, KEYED2], 'bbb', false)).toEqual({ ok: true, via: 'member-key' });
  });
});

describe('decideSenderAuth — keyless row, flag OFF (fully closed)', () => {
  it('denies even an unambiguous keyless row', () => {
    expect(decideSenderAuth([KEYLESS], undefined, false)).toEqual({ ok: false, reason: 'no-flag' });
  });
  it('a bogus key does not help a keyless row', () => {
    expect(decideSenderAuth([KEYLESS], 'anything', false)).toEqual({ ok: false, reason: 'no-flag' });
  });
});

describe('decideSenderAuth — keyless row, flag ON (migration bridge)', () => {
  it('allows a single unambiguous keyless row (logged upstream)', () => {
    expect(decideSenderAuth([KEYLESS], undefined, true)).toEqual({ ok: true, via: 'legacy-name' });
  });
  it('FAILS CLOSED on two identical keyless rows (F7/F8 ambiguity)', () => {
    expect(decideSenderAuth([KEYLESS, {}], undefined, true)).toEqual({ ok: false, reason: 'ambiguous' });
  });
  it('a keyed row among keyless rows still forces the key (no legacy downgrade)', () => {
    // F6: an attacker must not reach the legacy path when a credential exists.
    expect(decideSenderAuth([KEYED, KEYLESS], undefined, true)).toEqual({ ok: false, reason: 'need-key' });
    expect(decideSenderAuth([KEYED, KEYLESS], 'aaa', true)).toEqual({ ok: true, via: 'member-key' });
  });
});
