// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StructuredViewCard, StructuredViewFallback, ViewAwareBody } from './StructuredView.js';

// Read via a cwd-relative path: under jsdom, import.meta.url is an http:// URL and
// readFileSync rejects the scheme.
const source = readFileSync(resolve(process.cwd(), 'apps/web/src/components/StructuredView.tsx'), 'utf8');

afterEach(() => cleanup());

// T-46: the whole safety argument is that model output is DATA. These tests assert
// it against a real DOM, not against source strings — a `<script>` in a subject
// line has to end up as visible text with no element created.
describe('Structured view rendering', () => {
  it('renders hostile model text as inert TEXT, creating no script or handler', () => {
    const { container } = render(
      <StructuredViewCard view={{
        v: 1, kind: 'detail', title: '<script>alert(1)</script>',
        fields: [{ label: 'From', value: '<img src=x onerror=alert(2)>' }],
        body: 'javascript:alert(3)',
      }} />,
    );
    // The dangerous shapes exist as characters...
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror=alert(2)>');
    // ...and as nothing else. No element was created, no handler attribute exists.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    // The markup is present only in ESCAPED form. Asserting innerHTML lacks the
    // substring 'onerror=' would be wrong — escaped text legitimately contains
    // those characters. What matters is that it is escaped, not absent.
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(2)&gt;');
    // Nor did anything become a navigable link.
    expect(container.querySelector('a')).toBeNull();
  });

  it('never uses dangerouslySetInnerHTML anywhere in the renderer', () => {
    // The one line that would undo the entire design, pinned so it cannot be
    // added later "just for rich text". Matched as a JSX assignment rather than a
    // bare substring, because the file's own comment names the API it forbids —
    // and a test that fails on its own documentation teaches people to delete the
    // documentation.
    expect(source).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    expect(source).toContain('no dangerouslySetInnerHTML anywhere in this file');
  });

  it('renders each view kind with usable semantics', () => {
    const { container: list } = render(
      <StructuredViewCard view={{ v: 1, kind: 'list', title: 'Today', items: [
        { id: '1', title: 'Invoice overdue', subtitle: 'accounts@x.com', meta: '9:12', badges: ['unread'] },
      ] }} />,
    );
    expect(list.querySelector('[data-gate="view-list"]')).not.toBeNull();
    expect(list.querySelectorAll('li[role="listitem"]').length).toBe(1);
    expect(list.textContent).toContain('Invoice overdue');

    const { container: detail } = render(
      <StructuredViewCard view={{ v: 1, kind: 'detail', title: 'Re: Invoice', fields: [{ label: 'From', value: 'a@b.c' }] }} />,
    );
    // Label/value pairs announce usefully as a definition list.
    expect(detail.querySelectorAll('dt').length).toBe(1);
    expect(detail.querySelectorAll('dd').length).toBe(1);

    const { container: empty } = render(
      <StructuredViewCard view={{ v: 1, kind: 'list', items: [], empty: 'No mail today.' }} />,
    );
    // Empty is a state with words, not a blank card.
    expect(empty.textContent).toContain('No mail today.');

    const { container: confirm } = render(
      <StructuredViewCard view={{ v: 1, kind: 'confirm', prompt: 'Send this reply?', confirmLabel: 'Send' }} />,
    );
    expect(confirm.querySelectorAll('button').length).toBe(2);
    expect(confirm.textContent).toContain('Cancel');
  });

  it('an action reports the id the agent declared, and nothing more', () => {
    const onAction = vi.fn();
    render(
      <StructuredViewCard
        view={{ v: 1, kind: 'draft', body: 'Hi', actions: [{ id: 'send-42', label: 'Send it' }] }}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByText('Send it'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ id: 'send-42', label: 'Send it' });
  });

  it('read-only contexts DISABLE actions rather than hiding them', () => {
    const { container } = render(
      <StructuredViewCard view={{ v: 1, kind: 'draft', body: 'Hi', actions: [{ id: 'a', label: 'Do it' }] }} />,
    );
    const btn = container.querySelector('button');
    // A button that silently does nothing is worse than a visibly unavailable one.
    expect(btn?.hasAttribute('disabled')).toBe(true);
  });

  it('a malformed view falls back WITHOUT losing the message', () => {
    const text = 'Here you go:\n\n```wakiview\n{"v":1,"kind":"nope"}\n```\n\nlet me know';
    const { container } = render(<ViewAwareBody text={text} />);
    expect(container.querySelector('[data-gate="view-fallback"]')).not.toBeNull();
    // Prose either side survives, and so does the raw payload — an unrenderable
    // view must never become an invisible message.
    expect(container.textContent).toContain('Here you go:');
    expect(container.textContent).toContain('let me know');
    expect(container.textContent).toContain('"kind":"nope"');
  });

  it('an unsupported version says so, and points at the real fix', () => {
    const { container } = render(<StructuredViewFallback reason="x" unsupportedVersion={7} />);
    expect(container.textContent).toContain('version 7');
    // Same lesson as T-30: the cure is a newer client, not a resend.
    expect(container.textContent).toMatch(/Reload/);
  });

  it('an ordinary message takes the ordinary path', () => {
    const { container } = render(<ViewAwareBody text="just a normal message" />);
    expect(container.querySelector('[data-gate="view-list"]')).toBeNull();
    expect(container.querySelector('[data-gate="view-fallback"]')).toBeNull();
    expect(container.textContent).toContain('just a normal message');
  });
});
