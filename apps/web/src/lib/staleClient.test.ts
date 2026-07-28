import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  behindLabel,
  clientBuildUnknown,
  clientNeedsRestart,
  clientOutdated,
  restartForBuildPrompt,
  type ParticipantHealth,
} from './presence.js';

const sheet = readFileSync(new URL('../components/AgentDetailsSheet.tsx', import.meta.url), 'utf8');
const serverIndex = readFileSync(new URL('../../../../apps/server/src/index.ts', import.meta.url), 'utf8');
const mcpTools = readFileSync(new URL('../../../../apps/mcp/src/tools.ts', import.meta.url), 'utf8');
const stamp = readFileSync(new URL('../../../../apps/mcp/src/buildStamp.ts', import.meta.url), 'utf8');
const roomScreen = readFileSync(new URL('../screens/Room.tsx', import.meta.url), 'utf8');

function health(over: Partial<ParticipantHealth> = {}): ParticipantHealth {
  return { name: 'A', client: 'cc', role: '', state: 'listening', lastSeenAgoMs: 0, listenRemainingMs: 1000, ...over };
}

// T-30 (client-build): an agent can be listening, healthy, and running the code
// from before the fix. This is the surface that says so.
describe('Stale-client beacon', () => {
  it('flags only cc rows the server reported a gap for', () => {
    expect(clientOutdated(health({ clientBehindMs: 3_600_000 }))).toBe(true);
    expect(clientOutdated(health())).toBe(false);
    expect(clientOutdated(health({ clientBehindMs: 0 }))).toBe(false);
    // A human's browser is not a client build we ask anyone to restart.
    expect(clientOutdated(health({ client: 'web', clientBehindMs: 3_600_000 }))).toBe(false);
    expect(clientOutdated(null)).toBe(false);
  });

  it('treats a client too old to report a build as a known-unknown, not a fake delta', () => {
    // The day this ships, every already-running session predates the field. Those
    // are precisely the rows worth flagging, and inventing a number for them
    // would repeat the "last heard 1969" mistake.
    const unknown = health({ clientBuildUnknown: true });
    expect(clientBuildUnknown(unknown)).toBe(true);
    expect(clientOutdated(unknown)).toBe(false);
    expect(clientNeedsRestart(unknown)).toBe(true);
    expect(clientNeedsRestart(health({ clientBehindMs: 60_001 }))).toBe(true);
    expect(clientNeedsRestart(health())).toBe(false);
    // The copy for that case must claim unknown, never a measured gap.
    expect(sheet).toContain('Client build unknown — older than build reporting');
    expect(sheet).toContain('Not reported — predates build reporting');
  });

  it('rounds the gap DOWN so the label never overstates what it asks for', () => {
    expect(behindLabel(90_000)).toBe('1m behind');
    expect(behindLabel(59 * 60_000)).toBe('59m behind');
    expect(behindLabel(3 * 3_600_000 + 59 * 60_000)).toBe('3h behind');
    expect(behindLabel(50 * 3_600_000)).toBe('2d behind');
    // Sub-minute still reads as a real gap rather than "0m".
    expect(behindLabel(5_000)).toBe('1m behind');
  });

  it('names the only action that works, and does not pretend deploying again would', () => {
    const text = restartForBuildPrompt('hail-cow-dart', 'OpusCoder');
    expect(text).toContain('start a fresh one');
    expect(text).toContain('hail-cow-dart');
    expect(text).toContain('"OpusCoder"');
    expect(text).toContain('room_listen');
    expect(sheet).toContain('data-gate="stale-client"');
    expect(sheet).toContain("only thing that picks it up; deploying again won't.");
    expect(sheet).toContain('Copy restart prompt');
  });

  it('the banner is a status, not an alarm — presence keeps its own banner', () => {
    // A stale build must not borrow the disconnected treatment: the agent is
    // working fine, and crying wolf here would train the host to ignore it.
    const banner = sheet.slice(sheet.indexOf('data-gate="stale-client"'));
    expect(banner.slice(0, 400)).toContain('role="status"');
    expect(sheet).toContain('data-gate="recovery-banner"');
    expect(sheet.slice(sheet.indexOf('data-gate="recovery-banner"'), sheet.indexOf('data-gate="recovery-banner"') + 400)).toContain('role="alert"');
  });

  it('the People row surfaces it too — agent details alone is a place nobody looks', () => {
    // The whole failure mode is not knowing to check. A flag only reachable by
    // opening a sheet reproduces it.
    expect(roomScreen).toContain('data-gate="row-stale-client"');
    expect(roomScreen).toContain('clientNeedsRestart(h)');
    expect(roomScreen).toContain('restart to update');
    // Its own line, not folded into the presence line: an old build is not a
    // presence failure, and the recovery prompt cannot fix it.
    const row = roomScreen.slice(roomScreen.indexOf('data-gate="row-stale-client"'));
    expect(row.slice(0, 300)).not.toContain('presenceGlyph');
  });

  it('the stamp is captured once at process boot and cannot be talked forward', () => {
    // If the stamp were re-read per call, a rebuild would make a process running
    // OLD bytes report the NEW build — the one direction that must never happen.
    expect(stamp).toContain('export const CLIENT_BUILD_AT');
    expect(stamp).toContain('readBuildStamp()');
    expect(mcpTools).toContain('clientBuildAt: CLIENT_BUILD_AT');
    // Self-reported and feeding a max() watermark, so a future-dated claim is
    // dropped rather than flagging every honest agent in the room.
    expect(serverIndex).toContain('claimedBuild > joinStamp');
    expect(serverIndex).toContain('delete participant.clientBuildAt');
    expect(serverIndex).toContain('roomHealth(room.participants, Date.now(), SERVER_BUILD_AT)');
  });
});
