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
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'fs';
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
    ready: async p => {
      await p.waitForSelector('textarea', { timeout: 15000 });
      await p.waitForTimeout(2000);
      // Desktop field and the mobile icon share the accessible name, so the
      // palette state exists at EVERY width (review finding).
      const trigger = p.locator('header').getByRole('button', { name: /Search rooms/ }).first();
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

// T-63 rev2: a deterministic dense transcript. The gate owns a fixture room
// (auto-test named so Home collapses it) seeded ONCE with fixed content —
// a >15-line report, rapid short messages from two senders, a status ping,
// and a mention — so 'fixture' frames are stable pixels AND a dense state.
const FIXTURE_FILE = join(WORK, 'fixture-room.txt');
async function ensureFixtureRoom() {
  const post = async payload => {
    const r = await fetch(`${BASE}/api/room`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const b = await r.json();
    if (!r.ok) throw new Error(`${payload.action}: ${JSON.stringify(b).slice(0, 120)}`);
    return b;
  };
  if (existsSync(FIXTURE_FILE)) {
    const code = readFileSync(FIXTURE_FILE, 'utf8').trim();
    try { await post({ action: 'get', code }); return code; } catch { /* expired: reseed */ }
  }
  const created = await post({ action: 'create', topic: 'Visual gate fixture (auto test room, safe to ignore)', createdBy: 'GateHost' });
  const code = created.room.code;
  const joiner = name => ({ name, role: 'fixture', color: name === 'GateA' ? '#5B6AFF' : '#8B5CF6', initials: name.slice(4, 6).toUpperCase() || 'GX', client: 'cc', harness: name === 'GateA' ? 'claude-code' : 'codex', joinedAt: 1, lastSeenAt: 1 });
  const keys = {};
  for (const n of ['GateA', 'GateB']) {
    const joined = await post({ action: 'join', code, participant: joiner(n), wantMemberKey: true });
    keys[n] = joined.memberKey;
  }
  const msg = (name, text, id, kind) => post({ action: 'send', code, kind, memberKey: keys[name], message: { id, type: 'msg', name, initials: name.slice(4, 6).toUpperCase(), color: name === 'GateA' ? '#5B6AFF' : '#8B5CF6', role: 'fixture', text, client: 'cc', time: id } });
  let id = 1_700_000_000_000;
  const longReport = ['Long fixture report for the dense state.']
    .concat(Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: deterministic content that never changes between gate runs.`))
    .join('\n');
  await msg('GateA', longReport, id++);
  for (let i = 0; i < 6; i++) await msg(i % 2 ? 'GateA' : 'GateB', `Rapid fixture message ${i + 1}.`, id++);
  await msg('GateB', '@GateA a deterministic mention for the highlight state.', id++);
  await msg('GateA', 'status ping fixture', id++, 'status');
  writeFileSync(FIXTURE_FILE, code);
  return code;
}
const FIXTURE_ROOM = await ensureFixtureRoom().catch(e => { console.error('fixture room failed:', e.message); return null; });
if (FIXTURE_ROOM) {
  STATES.push({
    name: 'fixture',
    path: `/r/${FIXTURE_ROOM}`,
    ready: async p => { await p.waitForSelector('textarea', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2000); },
  });
}
let expectedFrames = 0;
let capturedFrames = 0;

// Stale CURRENT frames from a prior run must never masquerade as this run's
// evidence (review finding): clear before capturing.
rmSync(CURRENT, { recursive: true, force: true });
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
      const name = `${state.name}-${vp.tag}-${theme}.png`;
      expectedFrames += 1;
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
          // Semantic hooks (review finding): real composer/feed rectangles and
          // floating controls come from data-gate attributes, not class guesses.
          const composerEl = document.querySelector('[data-gate="composer"]') ?? document.querySelector('textarea');
          const feedEl = document.querySelector('[data-gate="feed"]');
          const floating = [...document.querySelectorAll('[data-gate="floating"] button')]
            .filter(vis)
            .map(b => ({ label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), ...box(b) }));
          const scrollContainers = [...document.querySelectorAll('*')]
            .filter(el => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1; })
            .slice(0, 8)
            .map(el => ({ label: (el.getAttribute('aria-label') || el.className || '').toString().slice(0, 30), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
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
            bubbles: [...document.querySelectorAll('[data-gate="msg-content"]')].slice(-10).map(b => b.getBoundingClientRect().width),
            composer: composerEl ? box(composerEl) : null,
            feed: feedEl ? box(feedEl) : null,
            floating,
            scrollContainers,
          };
        });
        if (state.triggerCenter) measurement.overlayTriggerCenter = state.triggerCenter;
        for (const failure of evaluateAssertions(measurement)) {
          geometryFailures.push({ frame: name, failure });
        }
        await page.screenshot({ path: join(CURRENT, name) });
        capturedFrames += 1;
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

const summary = gateSummary(verdicts, geometryFailures, { expected: expectedFrames, captured: capturedFrames });
console.log(summary.text);
if (summary.exitCode === 2) console.log('review .visual-gate/diff, then promote deliberately: npm run visual-gate:baseline');
if (summary.exitCode === 3) console.log('no baseline for the NEW frames — create it deliberately: npm run visual-gate:baseline');
if (summary.exitCode === 5) console.log('capture incomplete — do NOT trust this run; fix the failing states first');
writeFileSync(join(WORK, 'last-report.txt'), summary.text);

if (updateBaseline) {
  for (const name of readdirSync(CURRENT).filter(f => f.endsWith('.png'))) {
    copyFileSync(join(CURRENT, name), join(BASELINE, name));
  }
  console.log('baseline updated');
  process.exit(0);
}
process.exit(summary.exitCode);
