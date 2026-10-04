import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldNudge, recoveryPromptFor, presenceOf, NUDGE_COOLDOWN_MS, PANE_ACTIVITY_VETO_CAP_MS } from './nudge.mjs';

// T-12: the sampler's judgement about WHEN to type into an agent's terminal
// is the safety-critical part — pin every branch.

const NOW = 1_000_000_000;

test('nudges ONLY disconnected — stale is a healthy agent mid-model-turn (T-26)', () => {
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneBlocked: false, now: NOW }), true);
  // T-26: 'stale' (60s+ silent) is what a normal multi-minute model turn looks
  // like between listen windows — nudging there interrupted healthy agents
  // every cool-down (witnessed on OpusCoder all night). Never nudge stale.
  for (const s of ['stale', 'listening', 'online', 'working', undefined]) {
    assert.equal(shouldNudge({ presenceState: s, paneBlocked: false, now: NOW }), false, `state=${s}`);
  }
});

test('a blocked pane is a HUMAN incident — never typed into', () => {
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneBlocked: true, now: NOW }), false);
});

test('cool-down: no re-nudge inside the window, re-armed after it', () => {
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneBlocked: false, lastNudgeAt: NOW - NUDGE_COOLDOWN_MS + 1000, now: NOW }), false);
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneBlocked: false, lastNudgeAt: NOW - NUDGE_COOLDOWN_MS - 1, now: NOW }), true);
});

// T-31: presence infers life from room traffic; the terminal SHOWS it. Witnessed
// live — OpusCoder was streaming a build into its pane when the summoner typed a
// recovery prompt on top of it, because 5 minutes of heads-down silence reads as
// disconnected. An in-flight marker in the terminal outranks that inference.
test('a terminal showing a turn in flight vetoes the nudge', () => {
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneActive: true, paneBlocked: false, now: NOW }), false);
  // No in-flight marker, or a harness whose furniture we don't recognise:
  // nothing to veto with, so presence still rules and behaviour is unchanged.
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneActive: false, paneBlocked: false, now: NOW }), true);
  assert.equal(shouldNudge({ presenceState: 'disconnected', paneBlocked: false, now: NOW }), true);
});

test('the pane veto is CAPPED — a frozen in-flight marker cannot disable auto-nudge', () => {
  // Inside the cap, the terminal keeps winning.
  assert.equal(shouldNudge({
    presenceState: 'disconnected', paneActive: true, paneBlocked: false,
    vetoSinceAt: NOW - PANE_ACTIVITY_VETO_CAP_MS + 1000, now: NOW,
  }), false);
  // Past it, presence wins and the agent gets its prompt — one redundant nudge
  // is a far cheaper failure than a mechanism that silently never fires.
  assert.equal(shouldNudge({
    presenceState: 'disconnected', paneActive: true, paneBlocked: false,
    vetoSinceAt: NOW - PANE_ACTIVITY_VETO_CAP_MS, now: NOW,
  }), true);
});

test('a blocked pane still outranks pane activity — typing over a dialog helps nobody', () => {
  assert.equal(shouldNudge({
    presenceState: 'disconnected', paneActive: false, paneBlocked: true,
    vetoSinceAt: NOW - PANE_ACTIVITY_VETO_CAP_MS * 2, now: NOW,
  }), false);
});

test('the cool-down survives the veto path — an expired veto does not re-nudge instantly', () => {
  assert.equal(shouldNudge({
    presenceState: 'disconnected', paneActive: true, paneBlocked: false,
    vetoSinceAt: NOW - PANE_ACTIVITY_VETO_CAP_MS, lastNudgeAt: NOW - 1000, now: NOW,
  }), false);
});

test('the injected prompt matches the manual copy-button wording', () => {
  assert.equal(
    recoveryPromptFor('mint-mop-cope', 'CodexArchitect', 'Orchestrator'),
    'Rejoin Agent Room mint-mop-cope as "CodexArchitect" (role: Orchestrator) and stay in the room_listen loop until the host says stop. During long work, send a room_status ping every few minutes so the room can tell you are busy instead of dead.',
  );
  assert.equal(
    recoveryPromptFor('a-b-c', 'X'),
    'Rejoin Agent Room a-b-c as "X" and stay in the room_listen loop until the host says stop. During long work, send a room_status ping every few minutes so the room can tell you are busy instead of dead.',
  );
});

test('presenceOf finds the cc row by exact name and tolerates junk', () => {
  const health = [
    { name: 'Waqas', client: 'web', state: 'online' },
    { name: 'Builder', client: 'cc', state: 'disconnected' },
  ];
  assert.equal(presenceOf(health, 'Builder'), 'disconnected');
  assert.equal(presenceOf(health, 'Waqas'), undefined); // web row never matches
  assert.equal(presenceOf(undefined, 'Builder'), undefined);
});

test('an armed model-free watcher suppresses the fallback model nudge', () => {
  const health = [{
    name: 'Claude', client: 'cc', state: 'disconnected', wakeRemainingMs: 30_000,
  }];
  const state = presenceOf(health, 'Claude');
  assert.equal(state, 'wake-ready');
  assert.equal(shouldNudge({ presenceState: state, paneBlocked: false, now: NOW }), false);
});
