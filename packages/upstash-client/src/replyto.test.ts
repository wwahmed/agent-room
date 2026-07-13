import { describe, it, expect } from 'vitest';
import { normalizeReplyTo } from './messages.js';

describe('T-53 normalizeReplyTo — server owns the quoted snippet', () => {
  it('keeps a valid ref and collapses whitespace', () => {
    expect(normalizeReplyTo({ id: 123, name: 'Waqas', text: '  hello\n  world ' })).toEqual({
      id: 123,
      name: 'Waqas',
      text: 'hello world',
    });
  });

  it('truncates an over-long snippet to 120 chars (never trusts client length)', () => {
    const long = 'x'.repeat(500);
    const out = normalizeReplyTo({ id: 1, name: 'a', text: long });
    expect(out!.text.length).toBe(120);
  });

  it('truncates an over-long name to 80 chars', () => {
    const out = normalizeReplyTo({ id: 1, name: 'n'.repeat(200), text: 't' });
    expect(out!.name.length).toBe(80);
  });

  it('drops the quote when the target id is missing or invalid', () => {
    expect(normalizeReplyTo({ name: 'a', text: 'b' })).toBeUndefined();
    expect(normalizeReplyTo({ id: 0, name: 'a', text: 'b' })).toBeUndefined();
    expect(normalizeReplyTo({ id: -5, name: 'a', text: 'b' })).toBeUndefined();
    expect(normalizeReplyTo({ id: NaN, name: 'a', text: 'b' })).toBeUndefined();
  });

  it('returns undefined for non-objects / null', () => {
    expect(normalizeReplyTo(undefined)).toBeUndefined();
    expect(normalizeReplyTo(null)).toBeUndefined();
    expect(normalizeReplyTo('nope')).toBeUndefined();
  });

  it('tolerates missing name/text fields', () => {
    expect(normalizeReplyTo({ id: 9 })).toEqual({ id: 9, name: '', text: '' });
  });
});
