import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_CATEGORIES, REQUIRED_JOURNEYS, validateWalkthrough } from './validate-ux-walkthrough.mjs';

const digest = 'a'.repeat(64);
const frameDigest = 'b'.repeat(64);

function validReceipt() {
  const surfaces = [];
  for (const platform of ['phone', 'desktop']) {
    const widths = platform === 'phone' ? [390, 430] : [1440, 2032];
    for (const width of widths) for (const theme of ['light', 'dark']) {
      surfaces.push({
        platform, width, theme,
        framePath: `frames/${platform}-${width}-${theme}.png`,
        frameSha256: frameDigest,
        metrics: platform === 'phone'
          ? { restingComposerHeightPx: 56, emptyFieldInnerRatio: 0.72, finalInteractionClearancePx: 18, controlsInsideVisualViewport: true }
          : { restingComposerHeightPx: 60, railResizable: true, scrollbarPresentation: 'theme-aware', documentReloads: 0 },
      });
    }
  }
  return {
    schemaVersion: 1,
    release: { fullSha: 'c'.repeat(40), artifactSha256: digest, fixtureManifestSha256: digest, gateResultSha256: digest },
    people: { builder: 'Builder', walkthroughReviewer: 'UX Lead', independentVerifier: 'Verifier' },
    dataProfile: { realRoomUsed: true, roomCount: 120, syntheticOnly: false, fixtureRoomsVisibleInPrimary: 0 },
    surfaces,
    journeysCompleted: [...REQUIRED_JOURNEYS],
    friction: { first60Seconds: ['No unrecorded friction observed'], fiveMinutes: ['No unrecorded friction observed'] },
    wholeFrame: REQUIRED_CATEGORIES.map(category => ({ category, outcome: 'pass' })),
    reviewedAt: '2026-07-21T15:00:00Z',
    independentReview: { status: 'approved', reviewedAt: '2026-07-21T15:10:00Z' },
    decision: 'approve',
  };
}

test('complete independent receipt passes', () => {
  assert.deepEqual(validateWalkthrough(validReceipt()), []);
});

test('catches the host-reported desktop primary-frame failures', () => {
  const receipt = validReceipt();
  receipt.dataProfile.fixtureRoomsVisibleInPrimary = 18;
  for (const row of receipt.surfaces.filter(row => row.platform === 'desktop')) {
    row.metrics.restingComposerHeightPx = 170;
    row.metrics.railResizable = false;
    row.metrics.scrollbarPresentation = 'native-dominant';
    row.metrics.documentReloads = 1;
  }
  const findings = validateWalkthrough(receipt).join('\n');
  assert.match(findings, /fixture\/test rooms contaminate/);
  assert.match(findings, /resting composer must be 56-64px/);
  assert.match(findings, /room rail is not resizable/);
  assert.match(findings, /native-dominant/);
  assert.match(findings, /document reload/);
});

test('catches the host-reported phone composer and voice failures', () => {
  const receipt = validReceipt();
  for (const row of receipt.surfaces.filter(row => row.platform === 'phone')) {
    row.metrics.restingComposerHeightPx = 210;
    row.metrics.emptyFieldInnerRatio = 0.52;
    row.metrics.finalInteractionClearancePx = -40;
    row.metrics.controlsInsideVisualViewport = false;
  }
  const findings = validateWalkthrough(receipt).join('\n');
  assert.match(findings, /resting composer must be 52-60px/);
  assert.match(findings, /at least 68%/);
  assert.match(findings, /at least 16px/);
  assert.match(findings, /outside visualViewport/);
});

test('rejects self-review, incomplete journeys, and paper approval over a block', () => {
  const receipt = validReceipt();
  receipt.people.walkthroughReviewer = 'Builder';
  receipt.journeysCompleted = receipt.journeysCompleted.filter(journey => journey !== 'compose-voice');
  receipt.wholeFrame[0] = { category: REQUIRED_CATEGORIES[0], outcome: 'block', issueRef: 'T-1', severity: 'P0', owner: 'Builder', rationale: 'broken' };
  const findings = validateWalkthrough(receipt).join('\n');
  assert.match(findings, /builder cannot perform/);
  assert.match(findings, /missing journey: compose-voice/);
  assert.match(findings, /approval is forbidden/);
});
