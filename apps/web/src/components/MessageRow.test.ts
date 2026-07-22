import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

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
