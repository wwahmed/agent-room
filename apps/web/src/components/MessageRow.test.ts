import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps reading roles on the semantic T-74 classes', () => {
    expect(source).toContain("const bodyText = 'msg-prose'");
    expect(source).toContain('className="msg-author min-w-0 flex-1 break-words"');
    expect(source).toContain('className="msg-meta shrink-0 whitespace-nowrap"');
    expect(source).toContain('sm:max-w-[80ch]');
    expect(source).toContain('rounded-xl border border-border-faint bg-surface-softer');
  });
});
