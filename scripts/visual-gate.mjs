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
// T-95 slice 2 (fixture tenancy): the gate no longer touches ANY backing
// state. Every state renders from the frozen dataset in gate-fixtures.json,
// served through fail-closed route stubs (gate-stubs.mjs) - a fixture that
// attempts a mutating or unstubbed request records a tenancy violation and
// the run refuses with CAPTURE-INCOMPLETE. No fixture room is created, no
// member key is used, no live room is photographed.

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { frameVerdict, gateSummary, enumerateFrames } from './visual-gate-report.mjs';
import { evaluateAssertions } from './visual-gate-assertions.mjs';
import { DATASET, installGateStubs } from './gate-stubs.mjs';

const TYPE_FLOORS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'type-floors.json'), 'utf8'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env.VISUAL_GATE_WORK ?? join(ROOT, '.visual-gate');
const BASELINE = join(WORK, 'baseline');
const CURRENT = join(WORK, 'current');
const DIFF = join(WORK, 'diff');
const BASE = process.env.VISUAL_GATE_BASE ?? 'http://127.0.0.1:8210';
// Every state renders the deterministic dataset room - including the ones
// that used to photograph the live work room (they varied run to run, and
// reading real state was itself the tenancy hole this slice closes).
const ROOM = DATASET.roomCode;
const EXE = process.env.VISUAL_GATE_CHROME
  ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const updateBaseline = process.argv.includes('--update-baseline');

const VIEWPORTS = [
  { w: 390, h: 844, tag: '390' },
  // T-72 acceptance: 430 is the review's second required phone width — large
  // Android/iPhone-Pro class. Every geometry rule runs here too.
  { w: 430, h: 932, tag: '430' },
  { w: 768, h: 1024, tag: '768' },
  { w: 1440, h: 900, tag: '1440' },
  { w: 2100, h: 1100, tag: '2100' },
];
const THEMES = ['dark', 'light'];
const STATES = [
  { name: 'home', path: '/', ready: async p => p.waitForTimeout(2400) },
  { name: 'chat', path: `/r/${ROOM}`, ready: async p => { await p.waitForSelector('textarea', { timeout: 15000 }); await p.waitForTimeout(2400); } },
  { name: 'people', path: `/r/${ROOM}?panel=people`, ready: async p => p.waitForTimeout(2400) },
  // T-71: the Project board is a first-class gated state.
  { name: 'project', path: `/r/${ROOM}?panel=project`, ready: async p => p.waitForTimeout(2400) },
  { name: 'outputs', path: `/r/${ROOM}?panel=outputs`, ready: async p => p.waitForTimeout(2400) },
  {
    // T-63 acceptance: the state nobody photographed — the composer WITH
    // typed content and focus, where the fourth regression lived.
    name: 'composer-typed',
    path: `/r/${ROOM}`,
    ready: async p => {
      await p.waitForSelector('textarea', { timeout: 15000 });
      const ta = p.locator('textarea').first();
      await ta.click();
      await ta.type('Deterministic typed fixture text');
      await p.waitForTimeout(600);
    },
  },
  {
    name: 'palette',
    path: `/r/${ROOM}`,
    ready: async p => {
      await p.waitForSelector('textarea', { timeout: 15000 });
      await p.waitForTimeout(2000);
      // Desktop field and the mobile icon share the accessible name, so the
      // palette state exists at EVERY width (review finding).
      const trigger = p.locator('header').getByRole('button', { name: /Search rooms/ }).first();
      const tb = await trigger.boundingBox();
      STATES.find(s => s.name === 'palette').triggerCenter = tb ? tb.x + tb.width / 2 : null;
      await trigger.click();
      // Readiness is REQUIRED (review finding): no dialog, no frame.
      await p.locator('[role="dialog"]').first().waitFor({ timeout: 5000 });
      await p.waitForTimeout(400);
    },
  },
];

// T-63: geometry findings accumulate across every frame.
const geometryFailures = [];

// T-63 rev2 -> T-95 slice 2: the dense deterministic transcript now lives in
// gate-fixtures.json (captured once, read-only, from the original seeded
// room with authoritative server shapes). ensureFixtureRoom and its live
// API writes are gone; the fixture room code never needs to exist
// server-side because no request ever reaches a server.
const FIXTURE_ROOM = DATASET.roomCode;
// Fail-closed tenancy: every escaped or mutating request lands here and
// forces exit 5 at the end of the run.
const gateViolations = [];
STATES.push({
  name: 'fixture',
  path: `/r/${FIXTURE_ROOM}`,
  // Readiness is REQUIRED: the seeded dense content must actually be there.
  ready: async p => {
    await p.waitForSelector('textarea', { timeout: 15000 });
    await p.getByText('Rapid fixture message 6').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(1200);
    // T-72: photograph the caught-up REST state. The viewer identity has
    // unread fixture pings, so the app deliberately lands at first-unread
    // with the jump pill floating mid-feed — a legitimate reading state, but
    // the rest-state invariant the gate enforces is: at bottom, the pill
    // must be gone and can never cover an Activity Note.
    await p.evaluate(() => {
      const el = document.querySelector('[data-gate="feed"]');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await p.waitForTimeout(600);
  },
});
// T-72 ruling: the scrolled-up reading state — the jump-to-latest lane VISIBLE
// — is a required capture. The lane is layout, not overlay, so every geometry
// rule (notably floating-vs-status-note and floating-vs-composer) must hold
// here too. Review finding: asserting only the rest state where the pill is
// gone was a false negative.
STATES.push({
  name: 'fixture-up',
  path: `/r/${FIXTURE_ROOM}`,
  ready: async p => {
    await p.waitForSelector('textarea', { timeout: 15000 });
    await p.getByText('Rapid fixture message 6').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(1200);
    await p.evaluate(() => {
      const el = document.querySelector('[data-gate="feed"]');
      if (el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 400);
    });
    await p.waitForTimeout(600);
  },
});

// T-86: the interactive states the host actually broke in — permanent
// fixtures, not one-off checks. composer-attach stacks a real pending chip
// through the real input; voice-draft drives the dictation-editing state via
// the inert ?gateFixture hook (headless has no microphone).
STATES.push({
  name: 'composer-attach',
  path: `/r/${FIXTURE_ROOM}`,
  ready: async p => {
    await p.waitForSelector('textarea', { timeout: 15000 });
    await p.waitForTimeout(1200);
    await p.locator('input[type="file"]').first().setInputFiles({
      name: 'gate-fixture.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000d49444154789c626001000000ffff03000006000557bfabd4' +
        '0000000049454e44ae426082',
        'hex',
      ),
    });
    // Readiness: the pending-attachment chip (or its upload row) is REQUIRED.
    await p.getByText('gate-fixture.png').first().waitFor({ timeout: 10000 });
    await p.waitForTimeout(600);
  },
});
STATES.push({
  name: 'voice-draft',
  path: `/r/${FIXTURE_ROOM}?gateFixture=voice-draft`,
  ready: async p => {
    await p.waitForSelector('textarea', { timeout: 15000 });
    // Readiness: the voice-draft banner is REQUIRED — this is the state
    // where send controls historically left the screen.
    await p.getByText('Voice draft').first().waitFor({ timeout: 8000 });
    await p.waitForTimeout(800);
  },
});

const EXPECTED = enumerateFrames(STATES.map(s => s.name), VIEWPORTS.map(v => v.tag), THEMES);
let capturedFrames = 0;

// Stale CURRENT frames from a prior run must never masquerade as this run's
// evidence (review finding): clear before capturing.
rmSync(CURRENT, { recursive: true, force: true });
rmSync(DIFF, { recursive: true, force: true });
for (const dir of [WORK, BASELINE, CURRENT, DIFF]) mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, colorScheme: theme });
    const page = await ctx.newPage();
    await installGateStubs(page, { violations: gateViolations });
    await page.addInitScript(room => {
      sessionStorage.setItem(`room:${room}:self`, JSON.stringify({ name: 'ClaudeUI', role: '' }));
    }, ROOM);
    for (const state of STATES) {
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
          const INTERACTIVE = 'button, [role="tab"], [role="button"], a[href], a[aria-label], input, textarea, select, summary';
          const buttons = [...document.querySelectorAll(INTERACTIVE)].filter(vis).map(b => ({
            label: (b.getAttribute('aria-label') || b.getAttribute('placeholder') || b.textContent || '').trim().slice(0, 30),
            inScrollX: inScrollX(b),
            // WCAG 2.5.8 inline exception: anchors flowing inline within
            // message prose are height-bound by line-height, not a control box.
            inlineProse: b.tagName === 'A'
              && !!b.closest('[data-gate="msg-content"]')
              && getComputedStyle(b).display === 'inline',
            ...box(b),
          }));
          const lum = el => {
            if (!el) return null;
            const c = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
            if (!c || c.length < 3) return null;
            if (c.length > 3 && parseFloat(c[3]) === 0) return null;
            return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
          };
          // T-86 semantic anatomy: the field, the visible bottom stack, the
          // final message, and the feed's at-bottom flag feed the width /
          // tail-clearance / in-viewport rules.
          // The 68% contract is against the COMPOSER'S inner width, not the
          // raw viewport (review finding 4).
          const composerBoxEl = document.querySelector('[data-gate="composer"]');
          const taEl = document.querySelector('[data-gate="composer"] textarea');
          const composerField = taEl && vis(taEl)
            ? { ...box(taEl), empty: !taEl.value, containerW: composerBoxEl ? composerBoxEl.clientWidth : innerWidth }
            : null;
          // Keyboard/browser chrome shrink the VISUAL viewport while
          // innerHeight lies (review finding 1): containment checks use it.
          const vv = window.visualViewport
            ? { w: window.visualViewport.width, h: window.visualViewport.height, top: window.visualViewport.offsetTop, left: window.visualViewport.offsetLeft }
            : { w: innerWidth, h: innerHeight, top: 0, left: 0 };
          const stackEl = document.querySelector('.room-bottom-chrome') ?? document.querySelector('[data-gate="composer"]');
          const bottomStack = stackEl && vis(stackEl) ? box(stackEl) : null;
          const bottomStackControls = stackEl
            ? [...stackEl.querySelectorAll(INTERACTIVE)].filter(vis).map(b => ({
                label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30),
                ...box(b),
              }))
            : [];
          const feedForStack = document.querySelector('[data-gate="feed"]');
          // The COMPLETE terminal message block — row container including
          // actions/reply/attachment tail (review finding 5), falling back
          // to prose content where rows carry no id.
          const rowEls = [...document.querySelectorAll('[id^="msg-"]')];
          const msgEls = [...document.querySelectorAll('[data-gate="msg-content"]')];
          const lastEl = rowEls[rowEls.length - 1] ?? msgEls[msgEls.length - 1] ?? null;
          const lastMessage = lastEl ? box(lastEl) : null;
          const atBottom = feedForStack
            ? feedForStack.scrollHeight - feedForStack.scrollTop - feedForStack.clientHeight < 80
            : false;
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
            .map(el => {
              const cr = el.getBoundingClientRect();
              let hiddenControls = 0;
              let partiallyHiddenControls = 0;
              for (const c of el.querySelectorAll(INTERACTIVE)) {
                const r = c.getBoundingClientRect();
                if (r.width <= 1) continue;
                if (r.left >= cr.right - 1 || r.right <= cr.left + 1) hiddenControls += 1;
                else {
                  const visible = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
                  if (visible < r.width * 0.75) partiallyHiddenControls += 1;
                }
              }
              return { label: (el.getAttribute('aria-label') || el.className || '').toString().slice(0, 30), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, hiddenControls, partiallyHiddenControls };
            });
          return {
            viewportW: innerWidth,
            viewportH: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            buttons,
            composerField,
            bottomStack,
            bottomStackControls,
            lastMessage,
            atBottom,
            vv,
            surfaces: {
              header: lum(document.querySelector('header')),
              aside: lum(document.querySelector('aside')),
              body: lum(document.body),
            },
            overlay: dialog ? (r => ({ left: r.left, width: r.width }))(dialog.getBoundingClientRect()) : null,
            bubbles: [...document.querySelectorAll('[data-gate="msg-content"]')].slice(-10).map(b => {
              const r = b.getBoundingClientRect();
              const lh = parseFloat(getComputedStyle(b).lineHeight) || 24;
              // Only WRAPPED content can be 'collapsed' — a short one-liner is
              // intrinsically narrow and that is fine. The snippet names the
              // culprit in the finding instead of leaving a bare pixel count.
              return { w: r.width, wrapped: r.height > lh * 1.8, snippet: (b.textContent || '').trim().slice(0, 40) };
            }),
            // T-71: work-object titles are mechanically bounded to two lines.
            artifactTitles: [...document.querySelectorAll('[data-gate="artifact-title"]')].slice(-8).map(el => {
              const r = el.getBoundingClientRect();
              const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
              return { h: r.height, lh, snippet: (el.textContent || '').trim().slice(0, 40) };
            }),
            // T-72: Activity Note bodies must hold their full-width column.
            statusNotes: [...document.querySelectorAll('[data-gate="status-note"]')].slice(-6).map(el => {
              const body = el.querySelector('[data-gate="status-body"]');
              const note = el.getBoundingClientRect();
              const rect = x => x ? (r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))(x.getBoundingClientRect()) : null;
              return {
                w: note.width, top: note.top, bottom: note.bottom, left: note.left, right: note.right,
                bodyW: body ? body.getBoundingClientRect().width : null,
                snippet: (body?.textContent || '').trim().slice(0, 40),
                // T-72 rev4: auditable pointer boxes for the disclosure rule.
                showMore: rect(el.querySelector('[data-gate="disclosure-more"]')),
                updates: rect(el.querySelector('[data-gate="disclosure-updates"]')),
              };
            }),
            composer: composerEl ? box(composerEl) : null,
            feed: feedEl ? box(feedEl) : null,
            floating,
            scrollContainers,
            // T-63 acceptance: computed type per semantic role, from the LIVE
            // elements. composerTyped reads the focused textarea only when it
            // actually holds a value (the state that kept regressing).
            typeRoles: (() => {
              const roles = {};
              const grab = (sel, name) => {
                const el = document.querySelector(sel);
                if (!el) return;
                const c = getComputedStyle(el);
                roles[name] = { fontSize: parseFloat(c.fontSize), fontWeight: parseInt(c.fontWeight, 10) || 400 };
              };
              grab('.msg-prose', 'prose');
              grab('.msg-author', 'author');
              // Workspace nav uses honest <nav>/aria-current semantics
              // (T-71); the tab ROLE floor still reads whichever exists.
              grab('[role="tab"], .room-tab-label', 'tab');
              grab('.msg-meta', 'meta');
              grab('.msg-disclosure', 'disclosure');
              const ta = document.querySelector('textarea');
              if (ta && ta.value) {
                const c = getComputedStyle(ta);
                roles.composerTyped = { fontSize: parseFloat(c.fontSize), fontWeight: parseInt(c.fontWeight, 10) || 400 };
              }
              return roles;
            })(),
          };
        });
        if (state.triggerCenter) measurement.overlayTriggerCenter = state.triggerCenter;
        measurement.typeFloors = TYPE_FLOORS;
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

const summary = gateSummary(verdicts, geometryFailures, { expected: EXPECTED.length, captured: capturedFrames });
if (gateViolations.length) {
  summary.incomplete = true;
  summary.exitCode = 5;
  const lines = [...new Set(gateViolations)].map(v => `  TENANCY VIOLATION: ${v}`);
  summary.text += `\nfixture tenancy BROKEN (${gateViolations.length} escaped request${gateViolations.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}
console.log(summary.text);
if (summary.exitCode === 2) console.log('review .visual-gate/diff, then promote deliberately: npm run visual-gate:baseline');
if (summary.exitCode === 3) console.log('no baseline for the NEW frames — create it deliberately: npm run visual-gate:baseline');
if (summary.exitCode === 5) console.log('capture incomplete — do NOT trust this run; fix the failing states first');
writeFileSync(join(WORK, 'last-report.txt'), summary.text);

if (updateBaseline) {
  // rev4 (review finding): promotion must never green a broken run. An
  // incomplete capture refuses to promote at all; geometry failures allow the
  // pixel baseline to advance but the exit code still carries the defect.
  if (summary.incomplete) {
    console.error('REFUSED: capture incomplete — will not promote a partial baseline');
    process.exit(5);
  }
  for (const name of readdirSync(CURRENT).filter(f => f.endsWith('.png'))) {
    copyFileSync(join(CURRENT, name), join(BASELINE, name));
  }
  console.log('baseline updated');
  process.exit(summary.geometryFailures.length > 0 ? 4 : 0);
}
process.exit(summary.exitCode);
