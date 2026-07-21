import { describe, expect, it } from 'vitest';
import { artifactParts } from '../screens/Room.js';

describe('artifactParts (T-71 work-object titles)', () => {
  it('first line becomes the title, rest the summary', () => {
    const r = artifactParts('Ship the switcher\nDetails follow here.');
    expect(r.title).toBe('Ship the switcher');
    expect(r.summary).toBe('Details follow here.');
  });
  it('first sentence becomes the title', () => {
    const r = artifactParts('Ship the two-row note as the status object. It replaces the ribbon.');
    expect(r.title).toBe('Ship the two-row note as the status object.');
    expect(r.summary).toBe('It replaces the ribbon.');
  });
  it('long unpunctuated text cuts at a word with NO duplication and no leading ellipsis', () => {
    const long = 'word '.repeat(40).trim();
    const r = artifactParts(long);
    expect(r.title.length).toBeLessThanOrEqual(90);
    expect(r.title.endsWith('…')).toBe(true);
    expect(r.summary.startsWith('…')).toBe(false);
    expect((r.title.replace('…', '') + ' ' + r.summary).trim()).toBe(long);
  });
  it('short single sentence is title-only; empty input stays empty', () => {
    expect(artifactParts('Done.')).toEqual({ title: 'Done.', summary: '' });
    expect(artifactParts('   ')).toEqual({ title: '', summary: '' });
  });
});

describe('artifactParts locked cascade (design lead)', () => {
  it('a comma is NOT a boundary: the long Action sentence word-cuts instead of list-splitting', () => {
    const r = artifactParts('Verify the populated Outputs hierarchy shows Decision, Action, and Result cards with derived titles.');
    expect(r.title.endsWith(',')).toBe(false);
    expect(r.title.endsWith('…')).toBe(true);
    expect(r.title.length).toBeLessThanOrEqual(73);
    expect((r.title.replace('…', '') + ' ' + r.summary).replace(/\s+/g, ' ')).toBe(
      'Verify the populated Outputs hierarchy shows Decision, Action, and Result cards with derived titles.',
    );
  });
  it('a colon clause boundary keeps the colon and continues cleanly', () => {
    const r = artifactParts('Adopt one disclosure grammar across every bounded surface in the product: the reading endpoint form shipped by the status object work');
    expect(r.title.endsWith(':')).toBe(true);
    expect(r.summary.startsWith('the reading endpoint')).toBe(true);
  });
});
