#!/usr/bin/env node
// T-61: the visual regression gate. Run after every web deploy:
//
//   node scripts/visual-gate.mjs                 # capture + diff vs baseline
//   node scripts/visual-gate.mjs --update-baseline  # promote current run
//
// Captures a fixed matrix of app states at 390 and 1440 in dark and light
// against the local server, pixel-diffs each frame against the stored
// baseline (.visual-gate/baseline), writes changed frames + diff images to
// .visual-gate/, prints a summary naming every changed frame with its
// changed-pixel percentage, and exits 2 when anything changed — the deployer
// looks BEFORE announcing. Live-feed frames will legitimately change as
// messages arrive; the gate's contract is "someone looked", not "no pixels
// moved".
//
// Identity: the gate reuses the ClaudeUI web identity. Put the member key in
// .visual-gate/memberkey.txt (gitignored) or set VISUAL_GATE_KEY_FILE.

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { frameVerdict, gateSummary } from './visual-gate-report.mjs';
import { evaluateAssertions } from './visual-gate-assertions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, '.visual-gate');
const BASELINE = join(WORK, 'baseline');
const CURRENT = join(WORK, 'current');
const DIFF = join(WORK, 'diff');
const BASE = process.env.VISUAL_GATE_BASE ?? 'http://127.0.0.1:8210';
const ROOM = process.env.VISUAL_GATE_ROOM ?? 'twig-ant-stem';
const KEY_FILE = process.env.VISUAL_GATE_KEY_FILE ?? join(WORK, 'memberkey.txt');
const EXE = process.env.VISUAL_GATE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const updateBaseline = process.argv.includes('--update-baseline');

const VIEWPORTS = [
  { w: 390, h: 844, tag: '390' },
  { w: 768, h: 1024, tag: '768' },
  { w: 1440, h: 900, tag: '1440' },
  { w: 2100, h: 1100, tag: '2100' },
];
const THEMES = ['dark', 'light'];
const STATES = [
  { name: 'home', path: '/', ready: async p => p.waitForTimeout(2400) },
  { name: 'chat', path: `/r/${ROOM}`, ready: async p => { await p.waitForSelector('textarea', { timeout: 15000 }); await p.waitForTimeout(2400); } },
  { name: 'people', path: `/r/${ROOM}?panel=people`, ready: async p => p.waitForTimeout(2400) },
  { name: 'outputs', path: `/r/${ROOM}?panel=outputs`, ready: async p => p.waitForTimeout(2400) },
  {
    name: 'palette',
    path: `/r/${ROOM}`,
    only1440: true,
    ready: async p => {
      await p.waitForSelector('textarea', { timeout: 15000 });
      await p.waitForTimeout(2000);
      const trigger = p.locator('header').getByRole('button', { name: /Search rooms/ });
      if (await trigger.count()) {
        const tb = await trigger.boundingBox();
        STATES.find(s => s.name === 'palette').triggerCenter = tb ? tb.x + tb.width / 2 : null;
        await trigger.click();
        await p.waitForTimeout(600);
      }
    },
  },
];

// T-63: geometry findings accumulate across every frame.
const geometryFailures = [];

for (const dir of [WORK, BASELINE, CURRENT, DIFF]) mkdirSync(dir, { recursive: true });
const memberKey = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, 'utf8').trim() : '';

const browser = await chromium.launch({ executablePath: EXE });
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: theme });
    const page = await ctx.newPage();
    await page.route('**/api/me', r => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ identity: { email: 'gate@local', name: 'Waqas', role: 'host' } }),
    }));
    await page.addInitScript(([room, key]) => {
      sessionStorage.setItem(`room:${room}:self`, JSON.stringify({ name: 'ClaudeUI', role: '' }));
      if (key) sessionStorage.setItem(`room:${room}:memberKey`, key);
    }, [ROOM, memberKey]);
    for (const state of STATES) {
      if (state.only1440 && vp.w < 1440) continue;
      const name = `${state.name}-${vp.tag}-${theme}.png`;
      try {
        await page.goto(`${BASE}${state.path}`, { waitUntil: 'domcontentloaded' });
        await state.ready(page);
        // T-63: semantic geometry snapshot, evaluated by pure rules in Node.
        const measurement = await page.evaluate(() => {
          const vis = el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
          const inScrollX = el => {
            for (let n = el.parentElement; n; n = n.parentElement) {
              const cs = getComputedStyle(n);
              if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
            }
            return false;
          };
          const buttons = [...document.querySelectorAll('button, [role="tab"], a[aria-label]')].filter(vis).map(b => ({
            label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30),
            inScrollX: inScrollX(b),
            ...box(b),
          }));
          const lum = el => {
            if (!el) return null;
            const c = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
            if (!c || c.length < 3) return null;
            if (c.length > 3 && parseFloat(c[3]) === 0) return null;
            return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
          };
          const dialog = document.querySelector('[role="dialog"]');
          const composerEl = document.querySelector('textarea');
          const floating = [...document.querySelectorAll('div[class*="sticky"] button, div[class*="fixed"] button')]
            .filter(vis)
            .map(b => ({ label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), ...box(b) }));
          return {
            viewportW: innerWidth,
            viewportH: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            buttons,
            surfaces: {
              header: lum(document.querySelector('header')),
              aside: lum(document.querySelector('aside')),
              body: lum(document.body),
            },
            overlay: dialog ? (r => ({ left: r.left, width: r.width }))(dialog.getBoundingClientRect()) : null,
            bubbles: [...document.querySelectorAll('[id^="msg-"] div[class*="max-w"]')].slice(-10).map(b => b.getBoundingClientRect().width),
            composer: composerEl ? box(composerEl) : null,
            floating,
          };
        });
        if (state.triggerCenter) measurement.overlayTriggerCenter = state.triggerCenter;
        for (const failure of evaluateAssertions(measurement)) {
          geometryFailures.push({ frame: name, failure });
        }
        await page.screenshot({ path: join(CURRENT, name) });
      } catch (e) {
        console.error(`capture failed: ${name}: ${e.message}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();

const verdicts = [];
for (const name of readdirSync(CURRENT).filter(f => f.endsWith('.png'))) {
  const currentPng = PNG.sync.read(readFileSync(join(CURRENT, name)));
  const basePath = join(BASELINE, name);
  if (!existsSync(basePath)) {
    // No implicit seeding: baseline creation is ONLY --update-baseline.
    verdicts.push({ ...frameVerdict(name, 0, currentPng.width * currentPng.height), baselineMissing: true });
    continue;
  }
  const basePng = PNG.sync.read(readFileSync(basePath));
  if (basePng.width !== currentPng.width || basePng.height !== currentPng.height) {
    verdicts.push({ ...frameVerdict(name, currentPng.width * currentPng.height, currentPng.width * currentPng.height), resized: true });
    continue;
  }
  const diffPng = new PNG({ width: currentPng.width, height: currentPng.height });
  const diffPixels = pixelmatch(basePng.data, currentPng.data, diffPng.data, currentPng.width, currentPng.height, { threshold: 0.12 });
  const verdict = frameVerdict(name, diffPixels, currentPng.width * currentPng.height);
  if (verdict.changed) writeFileSync(join(DIFF, name), PNG.sync.write(diffPng));
  verdicts.push(verdict);
}

const summary = gateSummary(verdicts, geometryFailures);
console.log(summary.text);
if (summary.exitCode === 2) console.log('review .visual-gate/diff, then promote deliberately: npm run visual-gate:baseline');
if (summary.exitCode === 3) console.log('no baseline for the NEW frames — create it deliberately: npm run visual-gate:baseline');
writeFileSync(join(WORK, 'last-report.txt'), summary.text);

if (updateBaseline) {
  for (const name of readdirSync(CURRENT).filter(f => f.endsWith('.png'))) {
    copyFileSync(join(CURRENT, name), join(BASELINE, name));
  }
  console.log('baseline updated');
  process.exit(0);
}
process.exit(summary.exitCode);
