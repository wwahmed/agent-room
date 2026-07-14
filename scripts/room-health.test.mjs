import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPresence, parseArgs, summarizeParticipants } from './room-health.mjs';

const NOW = 1_000_000;

test('active listen window wins over an old heartbeat', () => {
  assert.equal(classifyPresence({ listenUntil: NOW + 1, lastSeenAt: 0 }, NOW), 'listening');
});

test('presence degrades through online, stale, and disconnected', () => {
  assert.equal(classifyPresence({ lastSeenAt: NOW - 60_000 }, NOW), 'online');
  assert.equal(classifyPresence({ lastSeenAt: NOW - 60_001 }, NOW), 'stale');
  assert.equal(classifyPresence({ lastSeenAt: NOW - 300_001 }, NOW), 'disconnected');
});

test('summary is redacted and contains only room-visible health fields', () => {
  const [row] = summarizeParticipants([{
    name: 'TechLead-Claude',
    client: 'cc',
    role: 'Lead',
    lastSeenAt: NOW,
    listenUntil: NOW + 15_000,
    memberKeyHash: 'must-not-leak',
    authIdHash: 'must-not-leak',
  }], NOW);

  assert.deepEqual(row, {
    name: 'TechLead-Claude',
    client: 'cc',
    role: 'Lead',
    state: 'listening',
    lastSeenAgo: 'now',
    listenRemainingMs: 15_000,
  });
  assert.equal(JSON.stringify(row).includes('must-not-leak'), false);
});

test('argument parser requires explicit values without accepting positional secrets', () => {
  assert.deepEqual(parseArgs(['--code', 'ABC-DEF-GHJ', '--name', 'Robin', '--json']), {
    baseUrl: 'http://127.0.0.1:8210',
    code: 'ABC-DEF-GHJ',
    name: 'Robin',
    json: true,
  });
  assert.throws(() => parseArgs(['unexpected']), /Unknown option/);
});
