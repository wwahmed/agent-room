import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { adoptionRejection, dismissPlan, relaunchRejection } from './adoption.mjs';

const service = readFileSync(new URL('./service.mjs', import.meta.url), 'utf8');
const alive = (s) => s === 'live-session';

// T-37: WakiDrive's agents were resumed as bare tmux panes, so the registry held
// ZERO entries for that room and every supervision mechanism was blind to them.
// One hit a usage limit and sat dead 14 hours; the host noticed, not the machinery.
test('adoption requires a room, a name, and a session that is actually running', () => {
  assert.equal(adoptionRejection({ agents: {}, room: 'a-b-c', name: 'Claude', tmuxSession: 'live-session', isSessionAlive: alive }), null);
  for (const missing of [{ room: '' }, { name: '' }, { tmuxSession: '' }]) {
    const req = { agents: {}, room: 'a-b-c', name: 'Claude', tmuxSession: 'live-session', isSessionAlive: alive, ...missing };
    assert.match(adoptionRejection(req), /all required/);
  }
  // Adopting a dead session would mint a permanent ghost the watchdog reports on
  // forever — supervision needs something to supervise.
  assert.match(
    adoptionRejection({ agents: {}, room: 'a-b-c', name: 'Claude', tmuxSession: 'ghost', isSessionAlive: alive }),
    /not running/,
  );
});

test('refuses duplicates by session AND by (room, name)', () => {
  const agents = {
    x: { status: 'active', room: 'a-b-c', name: 'Claude', tmuxSession: 'live-session' },
  };
  assert.match(
    adoptionRejection({ agents, room: 'other-r-m', name: 'Someone', tmuxSession: 'live-session', isSessionAlive: alive }),
    /already supervised/,
  );
  // Two active entries sharing (room, name) is the exact shape that made
  // dismissing one yank the other's participant row out from under it.
  assert.match(
    adoptionRejection({ agents, room: 'a-b-c', name: 'Claude', tmuxSession: 'live-session-2', isSessionAlive: (s) => s.startsWith('live-session') }),
    /already supervised in a-b-c/,
  );
  // A dismissed entry is not a conflict.
  const stale = { x: { status: 'dismissed', room: 'a-b-c', name: 'Claude', tmuxSession: 'live-session' } };
  assert.equal(adoptionRejection({ agents: stale, room: 'a-b-c', name: 'Claude', tmuxSession: 'live-session', isSessionAlive: alive }), null);
});

// The dangerous half. doDismiss kills the tmux session unconditionally, which is
// right for a process the summoner started and catastrophic for one it didn't:
// a host tidying a participant list would have killed a live release build.
test('dismissal kills only what the summoner started, and says what it did', () => {
  const summoned = dismissPlan({ tmuxSession: 's' });
  assert.equal(summoned.killSession, true);

  const adopted = dismissPlan({ tmuxSession: 's', adopted: true });
  assert.equal(adopted.killSession, false);
  // A host who expected "remove" to stop the process must be told it didn't.
  assert.match(adopted.note, /still running/);
});

test('an adopted agent cannot be relaunched — there is no spec to relaunch from', () => {
  assert.equal(relaunchRejection({ provider: 'claude' }), null);
  const why = relaunchRejection({ adopted: true, provider: 'claude' });
  assert.match(why, /adopted, not summoned/);
  assert.match(why, /Restart it yourself/);
});

test('the service wires all three guards, and exposes adopted on the roster', () => {
  // Kill only what we own.
  assert.match(service, /const plan = dismissPlan\(a\);\n  if \(plan\.killSession\) killSession\(a\.tmuxSession\);/);
  // Refuse relaunch before the mode validation, so the clearer error wins.
  assert.ok(service.indexOf('relaunchRejection(a)') < service.indexOf("mode must be chat, edit, or build"));
  assert.match(service, /url\.pathname === '\/adopt'/);
  // The app must be able to hide actions the summoner cannot honour.
  assert.match(service, /adopted: Boolean\(a\.adopted\)/);
});
