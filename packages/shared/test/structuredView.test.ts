import { describe, expect, it } from 'vitest';

import {
  STRUCTURED_VIEW_VERSION,
  VIEW_LIMITS,
  extractViewBlock,
  parseStructuredView,
} from '../src/structuredView.js';

const list = (over: Record<string, unknown> = {}) =>
  ({ v: 1, kind: 'list', items: [{ id: 'a', title: 'Alpha' }], ...over });

// T-46: this parser is a TRUST BOUNDARY. Its input is model output — sometimes
// malformed by accident, occasionally hostile on purpose — and the host's original
// sketch had the agent emitting raw HTML into a session holding a live mailbox
// token. Everything here is about making that impossible by construction.
describe('Structured view contract', () => {
  it('accepts the four view kinds and rejects anything else', () => {
    for (const view of [
      list(),
      { v: 1, kind: 'detail', title: 'T', fields: [{ label: 'From', value: 'a@b.c' }] },
      { v: 1, kind: 'draft', body: 'Hello' },
      { v: 1, kind: 'confirm', prompt: 'Send it?', confirmLabel: 'Send' },
    ]) {
      expect(parseStructuredView(view).ok, JSON.stringify(view).slice(0, 40)).toBe(true);
    }
    for (const kind of ['script', 'iframe', 'html', '', null, 42]) {
      const r = parseStructuredView({ v: 1, kind, items: [] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/unknown view kind/);
    }
  });

  it('reports an UNSUPPORTED VERSION distinctly from corruption', () => {
    // Different words are owed to the user: a newer view from a newer agent is a
    // stale-client problem (T-30), not a broken message, and the app should fall
    // back to showing the text rather than a broken panel.
    const r = parseStructuredView({ v: 99, kind: 'list', items: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unsupportedVersion).toBe(99);
      expect(r.reason).toMatch(/not supported/);
    }
    const bad = parseStructuredView({ kind: 'list', items: [] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.unsupportedVersion).toBeUndefined();
    expect(STRUCTURED_VIEW_VERSION).toBe(1);
  });

  it('carries model text through as DATA — no markup, urls or handlers are special', () => {
    // The point of the design: a script tag in a title is just an ugly title,
    // because it will be rendered as text by a first-party component. Nothing here
    // needs to sanitise HTML, because nothing will ever interpret it as HTML.
    const hostile = list({
      items: [{
        id: '<img src=x onerror=alert(1)>',
        title: '<script>alert("xss")</script>',
        subtitle: 'javascript:alert(1)',
        meta: 'data:text/html;base64,PHNjcmlwdD4=',
      }],
    });
    const r = parseStructuredView(hostile);
    expect(r.ok).toBe(true);
    if (r.ok && r.view.kind === 'list') {
      // Preserved verbatim as text — not stripped, not executed, not "cleaned"
      // into something that might round-trip back into markup.
      expect(r.view.items[0]?.title).toBe('<script>alert("xss")</script>');
      expect(r.view.items[0]?.subtitle).toBe('javascript:alert(1)');
    }
  });

  it('strips control characters but keeps newlines and tabs', () => {
    // A NUL in a rendered view carries no meaning and is the same hazard T-41
    // guards in source; newlines are the whole point of a draft body.
    const r = parseStructuredView({ v: 1, kind: 'draft', body: 'a\u0000b\u0007\nsecond\tline' });
    expect(r.ok).toBe(true);
    if (r.ok && r.view.kind === 'draft') expect(r.view.body).toBe('ab\nsecond\tline');
  });

  it('enforces every size cap instead of trusting the emitter', () => {
    const many = { v: 1, kind: 'list', items: Array.from({ length: VIEW_LIMITS.items + 1 }, (_, i) => ({ id: String(i), title: 't' })) };
    expect(parseStructuredView(many).ok).toBe(false);
    const longTitle = list({ items: [{ id: 'a', title: 'x'.repeat(VIEW_LIMITS.shortText + 1) }] });
    expect(parseStructuredView(longTitle).ok).toBe(false);
    const hugeBody = { v: 1, kind: 'draft', body: 'x'.repeat(VIEW_LIMITS.bodyText + 1) };
    expect(parseStructuredView(hugeBody).ok).toBe(false);
    // A payload too large to even parse is refused before JSON.parse runs.
    const huge = '{"v":1,"kind":"draft","body":"' + 'x'.repeat(VIEW_LIMITS.totalJson) + '"}';
    const r = parseStructuredView(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/);
  });

  it('rejects malformed shapes with a reason naming the field', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['not json at all', /not valid JSON/],
      [42, /must be a JSON object/],
      [{ v: 1, kind: 'list' }, /items must be an array/],
      [{ v: 1, kind: 'list', items: ['nope'] }, /items\[0\] must be an object/],
      [{ v: 1, kind: 'detail', title: 'T' }, /fields must be an array/],
      [{ v: 1, kind: 'draft' }, /body must be a string/],
      [{ v: 1, kind: 'confirm', prompt: 'p' }, /confirmLabel must be a string/],
      [{ v: 1, kind: 'detail', title: 'T', fields: [], actions: [{ id: '', label: 'x' }] }, /non-empty id and label/],
    ];
    for (const [input, re] of cases) {
      const r = parseStructuredView(input);
      expect(r.ok, JSON.stringify(input).slice(0, 40)).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(re);
    }
  });

  it('extracts a fenced view without disturbing ordinary messages', () => {
    const msg = 'Here are today\'s emails:\n\n```wakiview\n{"v":1,"kind":"list","items":[]}\n```\n\nAsk me to open one.';
    const found = extractViewBlock(msg);
    expect(found).not.toBeNull();
    expect(found?.before).toBe("Here are today's emails:");
    expect(found?.after).toBe('Ask me to open one.');
    expect(parseStructuredView(found!.json).ok).toBe(true);
    // No fence, no new code path — an ordinary message is untouched.
    expect(extractViewBlock('just a normal message with ```js\ncode\n``` in it')).toBeNull();
  });
});
