import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldNudge, recoveryPromptFor, presenceOf, NUDGE_COOLDOWN_MS } from './nudge.mjs';

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

test('the injected prompt matches the manual copy-button wording', () => {
  assert.equal(
    recoveryPromptFor('mint-mop-cope', 'CodexArchitect', 'Orchestrator'),
    'Rejoin Agent Room mint-mop-cope as "CodexArchitect" (role: Orchestrator) and stay in the room_listen loop until the host says stop.',
  );
  assert.equal(
    recoveryPromptFor('a-b-c', 'X'),
    'Rejoin Agent Room a-b-c as "X" and stay in the room_listen loop until the host says stop.',
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
