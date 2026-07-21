import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps prose on the semantic msg-prose class (T-70: 15px desktop / 17px phones, full ink)', () => {
    expect(source).toContain("const bodyText = 'msg-prose'");
    expect(source).toContain('className="text-[12px] font-medium"');
    expect(source).toContain('sm:max-w-[80ch]');
    expect(source).toContain('rounded-xl border border-border-faint bg-surface-softer');
  });
});
