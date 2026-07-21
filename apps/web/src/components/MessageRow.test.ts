import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps prose normal-weight in restrained peer cards', () => {
    expect(source).toContain("const bodyText = 'text-[13px] font-normal leading-[1.6] tracking-normal text-ink-muted [&_strong]:font-medium [&_strong]:text-ink'");
    expect(source).toContain('className="text-[12px] font-medium"');
    expect(source).toContain('sm:max-w-[80ch]');
    expect(source).toContain('rounded-xl border border-border-faint bg-surface-softer');
  });
});
