import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../tailwind.config.ts', import.meta.url), 'utf8');

function channels(block: string, token: string): [number, number, number] {
  const value = block.match(new RegExp(`--${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!value) throw new Error(`Missing --${token}`);
  return [Number(value[1]), Number(value[2]), Number(value[3])];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const linear = [red, green, blue].map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: [number, number, number], background: [number, number, number]): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('premium design tokens', () => {
  const dark = css.match(/:root \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  const light = css.match(/:root\[data-theme='light'\] \{([\s\S]*?)\n  \}/)?.[1] ?? '';

  it('keeps editorial and semantic text at WCAG AA contrast', () => {
    for (const block of [dark, light]) {
      const surface = channels(block, 'surface-1');
      for (const token of ['ink', 'ink-muted', 'ink-soft', 'ink-faint', 'accent', 'success', 'warning', 'danger']) {
        expect(contrast(channels(block, token), surface), `${token} on surface-1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('defines the charter type, radius, motion, and icon scales', () => {
    for (const token of ['caption', 'meta', 'body', 'title', 'heading', 'display']) expect(config).toContain(`${token}:`);
    for (const value of ['12px', '13px', '15px', '17px', '20px', '24px']) expect(config).toContain(value);
    expect(config).toContain("control: '8px'");
    expect(config).toContain("card: '12px'");
    expect(config).toContain("sheet: '16px'");
    expect(config).toContain("micro: '150ms'");
    expect(config).toContain("panel: '250ms'");
    expect(config).toContain("'icon-sm': '16px'");
    expect(config).toContain("icon: '20px'");
  });

  it('provides a global reduced-motion safety net', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition-duration: 0.01ms !important');
  });
});
