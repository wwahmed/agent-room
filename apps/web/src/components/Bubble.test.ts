import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Bubble.tsx', import.meta.url), 'utf8');

describe('compact image previews', () => {
  it('makes the thumbnail the full-size action and keeps metadata quiet', () => {
    expect(source).toContain('data-image-preview="compact"');
    expect(source).toContain('data-image-grid="compact"');
    expect(source).toContain('max-w-[320px]');
    expect(source).toContain('aspect-[4/3]');
    expect(source).toContain('aria-label={`Open ${attachment.name} full size`}');
    expect(source).toContain('text-[12px] font-normal leading-none tracking-normal text-ink-faint');
    expect(source).not.toContain('>View</button>');
  });
});
