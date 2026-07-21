import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MessageRow.tsx', import.meta.url), 'utf8');

describe('calm chat row anatomy', () => {
  it('keeps prose normal-weight and incoming identity tint quiet', () => {
    expect(source).toContain("const bodyText = 'text-[15px] font-normal leading-[1.6] [&_strong]:font-semibold'");
    expect(source).toContain("backgroundColor: 'transparent'");
    expect(source).toContain('sm:max-w-[68ch]');
    expect(source).not.toContain("bubbleShape = 'relative z-10 inline-block max-w-full break-words rounded");
    expect(source).not.toContain("bubbleShape = 'relative z-10 inline-block max-w-full break-words border");
  });
});
