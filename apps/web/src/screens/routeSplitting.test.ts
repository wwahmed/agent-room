import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Launch-cost guard.
//
// The app shipped as one 650 kB chunk, so opening it downloaded and executed
// the room screen before Home could paint. Splitting the routes fixed that —
// but a single static `import { Room } from './screens/Room.js'` anywhere in
// the launch graph silently welds it back into the entry chunk, and nothing
// would fail except the host's phone.
//
// This guard ENUMERATES the screens directory rather than naming a hand-picked
// few, so a screen added later is covered the day it lands. Home is the one
// deliberate exception: it is the launch screen and the back destination.

const SCREENS_DIR = resolve(__dirname);
const ROUTER = resolve(__dirname, '../router.tsx');
const EAGER_BY_DESIGN = new Set(['Home']);

function screenModules(): string[] {
  return readdirSync(SCREENS_DIR)
    .filter(f => f.endsWith('.tsx'))
    .filter(f => !f.includes('.test.'))
    .map(f => f.replace(/\.tsx$/, ''))
    .sort();
}

describe('route-level code splitting', () => {
  const router = readFileSync(ROUTER, 'utf8');

  it('enumerates every screen — the guard must not be a hand-picked sample', () => {
    const screens = screenModules();
    // If this ever reads as a couple of files, the directory scan broke and
    // the guard below is passing vacuously.
    expect(screens.length).toBeGreaterThanOrEqual(6);
    expect(screens).toContain('Room');
    expect(screens).toContain('Home');
  });

  it.each(screenModules().filter(name => !EAGER_BY_DESIGN.has(name)))(
    '%s is lazy-loaded, never statically imported into the launch chunk',
    name => {
      const staticImport = new RegExp(`^\\s*import\\s+[^;]*from\\s+'\\./screens/${name}\\.js'`, 'm');
      expect(router).not.toMatch(staticImport);
      expect(router).toMatch(new RegExp(`lazy\\(\\(\\)\\s*=>\\s*import\\('\\./screens/${name}\\.js'\\)`));
    },
  );

  it('keeps Home static so the launch screen has no lazy boundary of its own', () => {
    expect(router).toMatch(/^\s*import\s+\{\s*Home\s*\}\s+from\s+'\.\/screens\/Home\.js'/m);
    expect(router).not.toMatch(/lazy\(\(\)\s*=>\s*import\('\.\/screens\/Home\.js'\)/);
  });

  it('wraps the lazy routes in a Suspense boundary — without one they throw', () => {
    expect(router).toMatch(/<Suspense fallback=/);
  });
});
