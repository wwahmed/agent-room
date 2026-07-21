import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps prose normal-weight and incoming identity tint quiet', () => {
    expect(source).toContain("const bodyText = 'text-[14px] font-[350] leading-[1.7] [&_strong]:font-medium'");
    expect(source).toContain("backgroundColor: 'transparent'");
    expect(source).toContain('sm:max-w-[min(36rem,82%)]');
  });
});
