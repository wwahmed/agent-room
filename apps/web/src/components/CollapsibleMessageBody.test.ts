import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CollapsibleMessageBody.tsx', import.meta.url), 'utf8');

describe('message prose measure', () => {
  it('caps the markdown container rather than relying on parsed child blocks', () => {
    expect(source).toContain('data-message-prose-measure="80ch"');
    expect(source).toContain('className="w-full max-w-[80ch]"');
  });

  // T-65 (verifier spec, supersedes the boxed-button guard): the disclosure
  // is an INLINE text link at body size directly under the last visible
  // line — tight single margin, 44px tap target via invisible hit-slop, no
  // box, no min-h bulk.
  it('renders the disclosure as an inline body-size link with hit-slop, not a box', () => {
    expect(source).toContain('ui-focus-ring msg-prose relative mt-0.5 block leading-tight font-semibold text-accent');
    expect(source).toContain("after:-inset-x-3 after:-inset-y-3.5 after:content-['']");
    expect(source).not.toContain('min-h-11 rounded-control border');
    expect(source).not.toContain('ml-auto');
  });

  it('keeps the fade to a single reading line', () => {
    expect(source).toContain("calc(100% - 24px)");
  });
});
