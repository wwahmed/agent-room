import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps prose normal-weight in restrained peer cards', () => {
    expect(source).toContain("const bodyText = 'text-[15px] font-normal leading-[1.65] tracking-normal text-ink-muted [&_strong]:font-semibold [&_strong]:text-ink'");
    expect(source).toContain('sm:max-w-[80ch]');
    expect(source).toContain('rounded-xl border border-border-faint bg-surface-softer');
  });
});
