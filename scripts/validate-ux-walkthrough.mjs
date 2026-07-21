import { readFile } from 'node:fs/promises';

export const REQUIRED_JOURNEYS = [
  'home-entry',
  'find-switch-real-room',
  'read-newest',
  'read-older',
  'scroll-contextual-chrome',
  'compose-empty',
  'compose-typed',
  'compose-multiline',
  'compose-attachment',
  'compose-voice',
  'tabs-chat-project-people-outputs-chat',
  'resize-pointer',
  'resize-keyboard',
  'zoom-150',
  'rapid-room-switch-back-forward',
  'loading-empty-error-retry',
  'return-home',
];

export const REQUIRED_CATEGORIES = [
  'space-progressive-disclosure',
  'hierarchy-type-contrast-noise',
  'navigation-continuity',
  'resize-responsive-zoom',
  'scrolling-scrollbars',
  'composer-bottom-stack',
  'overlay-occlusion-tail',
  'loading-empty-error-recovery',
  'fixture-pollution',
  'keyboard-focus-targets-semantics',
];

const REQUIRED_SURFACES = [
  ['phone', 390, 'light'], ['phone', 390, 'dark'],
  ['phone', 430, 'light'], ['phone', 430, 'dark'],
  ['desktop', 1440, 'light'], ['desktop', 1440, 'dark'],
  ['desktop', 2032, 'light'], ['desktop', 2032, 'dark'],
];

const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const fullSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const surfaceKey = (platform, width, theme) => `${platform}:${width}:${theme}`;

export function validateWalkthrough(receipt) {
  const findings = [];
  const fail = message => findings.push(message);

  if (!receipt || typeof receipt !== 'object') return ['receipt must be an object'];
  if (receipt.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!fullSha(receipt.release?.fullSha)) fail('release.fullSha must be a full 40-character SHA');
  for (const field of ['artifactSha256', 'fixtureManifestSha256', 'gateResultSha256']) {
    if (!sha256(receipt.release?.[field])) fail(`release.${field} must be a SHA-256`);
  }

  const builder = receipt.people?.builder?.trim();
  const reviewer = receipt.people?.walkthroughReviewer?.trim();
  const verifier = receipt.people?.independentVerifier?.trim();
  if (!builder || !reviewer || !verifier) fail('builder, walkthroughReviewer, and independentVerifier are required');
  if (builder && reviewer && builder === reviewer) fail('builder cannot perform the release walkthrough');
  if (reviewer && verifier && reviewer === verifier) fail('walkthrough reviewer cannot independently verify their own receipt');

  if (receipt.dataProfile?.realRoomUsed !== true) fail('walkthrough must use a real active room');
  if ((receipt.dataProfile?.roomCount ?? 0) < 100) fail('desktop walkthrough requires at least 100 mixed rooms');
  if (receipt.dataProfile?.syntheticOnly === true) fail('synthetic fixtures cannot be the only walkthrough evidence');
  if ((receipt.dataProfile?.fixtureRoomsVisibleInPrimary ?? 0) !== 0) fail('fixture/test rooms contaminate the primary work list');

  const surfaces = new Map((receipt.surfaces ?? []).map(row => [surfaceKey(row.platform, row.width, row.theme), row]));
  for (const [platform, width, theme] of REQUIRED_SURFACES) {
    const key = surfaceKey(platform, width, theme);
    const row = surfaces.get(key);
    if (!row) { fail(`missing required surface ${key}`); continue; }
    if (!row.framePath || !sha256(row.frameSha256)) fail(`${key} requires a durable framePath and frameSha256`);
    const m = row.metrics ?? {};
    if (platform === 'phone') {
      if (!(m.restingComposerHeightPx >= 52 && m.restingComposerHeightPx <= 60)) fail(`${key} resting composer must be 52-60px`);
      if (!(m.emptyFieldInnerRatio >= 0.68)) fail(`${key} empty field must own at least 68% of composer inner width`);
      if (!(m.finalInteractionClearancePx >= 16)) fail(`${key} final interaction block needs at least 16px bottom-stack clearance`);
      if (m.controlsInsideVisualViewport !== true) fail(`${key} has a bottom-stack control outside visualViewport`);
    } else {
      if (!(m.restingComposerHeightPx >= 56 && m.restingComposerHeightPx <= 64)) fail(`${key} resting composer must be 56-64px`);
      if (m.railResizable !== true) fail(`${key} room rail is not resizable`);
      if (m.scrollbarPresentation === 'native-dominant' || !m.scrollbarPresentation) fail(`${key} scrollbar presentation is missing or native-dominant`);
      if (m.documentReloads !== 0) fail(`${key} room switching caused a document reload`);
    }
  }

  const completed = new Set(receipt.journeysCompleted ?? []);
  for (const journey of REQUIRED_JOURNEYS) if (!completed.has(journey)) fail(`missing journey: ${journey}`);
  if (!Array.isArray(receipt.friction?.first60Seconds) || receipt.friction.first60Seconds.length === 0) fail('first-60-seconds friction log is required');
  if (!Array.isArray(receipt.friction?.fiveMinutes) || receipt.friction.fiveMinutes.length === 0) fail('five-minute friction log is required');

  const categories = new Map((receipt.wholeFrame ?? []).map(row => [row.category, row]));
  let blocking = false;
  for (const category of REQUIRED_CATEGORIES) {
    const row = categories.get(category);
    if (!row) { fail(`missing whole-frame judgment: ${category}`); continue; }
    if (!['pass', 'block', 'triaged'].includes(row.outcome)) fail(`${category} has invalid outcome`);
    if (row.outcome === 'block') blocking = true;
    if (row.outcome !== 'pass' && (!row.issueRef || !row.severity || !row.owner || !row.rationale)) {
      fail(`${category} ${row.outcome} finding requires issueRef, severity, owner, and rationale`);
    }
  }

  if (receipt.decision === 'approve' && blocking) fail('approval is forbidden while a whole-frame category is blocked');
  if (!['approve', 'reject'].includes(receipt.decision)) fail('decision must be approve or reject');
  if (receipt.independentReview?.status !== 'approved' && receipt.decision === 'approve') fail('approval requires an approved independent review');
  if (!receipt.independentReview?.reviewedAt || !receipt.reviewedAt) fail('walkthrough and independent-review timestamps are required');

  return findings;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/validate-ux-walkthrough.mjs <receipt.json>');
    process.exit(2);
  }
  const receipt = JSON.parse(await readFile(file, 'utf8'));
  const findings = validateWalkthrough(receipt);
  if (findings.length) {
    for (const finding of findings) console.error(`FAIL: ${finding}`);
    process.exit(1);
  }
  console.log('walkthrough receipt OK');
}

if (process.argv[1]?.endsWith('validate-ux-walkthrough.mjs')) await main();
