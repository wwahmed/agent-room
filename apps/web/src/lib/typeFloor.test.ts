import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T-30/T-31 systemic guard (UX ruling: "strike three on sub-12px arbitrary
// type"). Arbitrary Tailwind sizes below 12px are banned across the web
// source — at every breakpoint, not just lg. If a design genuinely needs an
// exception, add it to ALLOW with a reason; the default is: raise the size.
const FLOOR_PX = 12;
// The ONE sanctioned escape hatch, inherited from the T-61 legibility floor:
// a line carrying the `text-fixed` marker declares its size is geometry-bound
// (avatar initials sized to a circle), not prose. Everything else raises.
const OPT_OUT_MARKER = 'text-fixed';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe(`type floor — no arbitrary text size below ${FLOOR_PX}px`, () => {
  it('finds no sub-floor text-[Npx] utilities in apps/web/src', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      for (const match of source.matchAll(/(?:[a-z-]+:)?text-\[(\d+(?:\.\d+)?)px\]/g)) {
        const px = Number(match[1]);
        const token = match[0];
        const lineNo = source.slice(0, match.index).split('\n').length;
        const lineText = lines[lineNo - 1] ?? '';
        if (px < FLOOR_PX && !lineText.includes(OPT_OUT_MARKER)) {
          offenders.push(`${file.replace(root, 'src')}:${lineNo} ${token}`);
        }
      }
    }
    expect(offenders, `sub-${FLOOR_PX}px type found:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('T-74 mobile reading contract', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const room = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');

  it('pins the readable phone roles and the real typed composer path', () => {
    // T-73 calibration (design lead + host): Comfortable prose is 19px —
    // the 20px emergency floor overshot by one step. Floors file matches.
    expect(css).toContain('.msg-prose { font-size: 19px; line-height: 1.55; }');
    expect(css).toContain('.msg-author { font-size: 18px; font-weight: 700; }');
    expect(css).toContain('.msg-meta { font-size: 15px; }');
    expect(css).toContain('.msg-composer { font-size: 20px; }');
    // Workspace tabs went icon-over-label stacked on phones (five tabs,
    // ~375px): the label sits under a 16px glyph at the 12px floor instead
    // of the 17px label-only floor.
    expect(css).toContain('.room-tab-label { font-size: 12px; }');
    expect(room).toContain('className="msg-composer w-full');
    expect(room).toContain('placeholder="Message…"');
  });
});
