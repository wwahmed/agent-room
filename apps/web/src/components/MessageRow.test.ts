import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps prose normal-weight and incoming identity tint quiet', () => {
    expect(source).toContain("const bodyText = 'text-[15px] font-normal leading-[1.65]'");
    expect(source).toContain('backgroundColor: `${message.color}08`');
    expect(source).toContain('sm:max-w-[min(36rem,82%)]');
  });
});
