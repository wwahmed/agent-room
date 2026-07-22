import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Message } from '@agent-room/shared';
import { hasRenderableContent } from './MessageRow.js';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

// T-111: rows with no text/attachments/artifact metadata are storage
// artifacts of malformed agent sends; they must not render as blank bubbles.
describe('blank-message suppression (T-111)', () => {
  const msg = (over: Partial<Message>): Message => ({ id: 1, type: 'msg', name: 'Codex Researcher', client: 'cc', time: 1, text: '', ...over }) as Message;

  it('hides the zero-content rows that blanked leap-lip-mule', () => {
    expect(hasRenderableContent(msg({ text: '' }))).toBe(false);
    expect(hasRenderableContent(msg({ text: '  \n ' }))).toBe(false);
    expect(hasRenderableContent(msg({ text: undefined as never }))).toBe(false);
  });

  // T-113: type-less rows are participant speech from a raw-send client —
  // classified as msg rows (content check applies), never as system rows.
  it('treats envelope-less rows as messages: text renders, empty hides', () => {
    expect(hasRenderableContent(msg({ type: undefined as never, text: 'raw-send text survives' }))).toBe(true);
    expect(hasRenderableContent(msg({ type: undefined as never, text: '' }))).toBe(false);
  });

  it('keeps text, attachment-only, system, and artifact rows', () => {
    expect(hasRenderableContent(msg({ text: 'hello' }))).toBe(true);
    expect(hasRenderableContent(msg({ attachments: [{ id: 'a', type: 'image', url: '/blobs/x/a.png', name: 'a.png', mime: 'image/png', size: 1, uploadedAt: 1 }] as Message['attachments'] }))).toBe(true);
    expect(hasRenderableContent(msg({ type: 'sys', text: '' }))).toBe(true);
    expect(hasRenderableContent(msg({ metadata: { eventType: 'question_created', questionId: 'q1' } as Message['metadata'] }))).toBe(true);
  });
});

describe('calm chat row anatomy', () => {
  it('keeps reading roles on the semantic T-74 classes', () => {
    expect(source).toContain("const bodyText = 'msg-prose'");
    // T-110: the name is single-line (truncate, capped at 60%) and can never
    // be crushed into a vertical letter stack by a long role.
    expect(source).toContain('className="msg-author max-w-[60%] shrink-0 truncate"');
    expect(source).toContain('className="msg-meta shrink-0 whitespace-nowrap"');
    expect(source).toContain('sm:max-w-[80ch]');
    expect(source).toContain('rounded-xl border border-border-faint bg-surface-softer');
  });
});
