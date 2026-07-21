import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CollapsibleMessageBody.tsx', import.meta.url), 'utf8');

describe('message prose measure', () => {
  it('caps the markdown container rather than relying on parsed child blocks', () => {
    expect(source).toContain('data-message-prose-measure="80ch"');
    expect(source).toContain('className="w-full max-w-[80ch]"');
  });
});
