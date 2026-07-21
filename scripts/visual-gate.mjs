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
  { w: 1440, h: 900, tag: '1440' },
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
        await trigger.click();
        await p.waitForTimeout(600);
      }
    },
  },
];

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
      if (state.only1440 && vp.tag !== '1440') continue;
      const name = `${state.name}-${vp.tag}-${theme}.png`;
      try {
        await page.goto(`${BASE}${state.path}`, { waitUntil: 'domcontentloaded' });
        await state.ready(page);
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
    verdicts.push({ ...frameVerdict(name, 0, currentPng.width * currentPng.height), baselineMissing: true });
    copyFileSync(join(CURRENT, name), basePath);
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

const summary = gateSummary(verdicts);
console.log(summary.text);
writeFileSync(join(WORK, 'last-report.txt'), summary.text);

if (updateBaseline) {
  for (const name of readdirSync(CURRENT).filter(f => f.endsWith('.png'))) {
    copyFileSync(join(CURRENT, name), join(BASELINE, name));
  }
  console.log('baseline updated');
  process.exit(0);
}
process.exit(summary.exitCode);
