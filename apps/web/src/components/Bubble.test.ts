import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Bubble.tsx', import.meta.url), 'utf8');

describe('compact image previews', () => {
  it('makes the thumbnail the full-size action and keeps metadata quiet', () => {
    expect(source).toContain('data-image-preview="compact"');
    expect(source).toContain('w-[min(520px,78vw)]');
    expect(source).toContain('aria-label={`Open ${attachment.name} full size`}');
    expect(source).toContain('text-[11px] font-normal leading-none tracking-normal text-ink-faint');
    expect(source).toContain('aria-label={`Download ${attachment.name}`}');
    expect(source).not.toContain('>View</button>');
  });
});
