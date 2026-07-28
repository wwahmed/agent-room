import type { Participant } from '@agent-room/shared';
import { describe, expect, it } from 'vitest';

import { buildWatermark, clientBehindMs, CLIENT_BUILD_GRACE_MS, hasBuildStamp } from './clientBuild.js';
import { roomHealth } from './health.js';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function agent(name: string, over: Partial<Participant> = {}): Participant {
  return {
    name,
    role: '',
    color: '#000',
    initials: 'AA',
    client: 'cc',
    joinedAt: NOW - 1000,
    lastSeenAt: NOW - 1000,
    ...over,
  };
}

// T-30 (client-build): the gap this closes is "the fix is deployed" vs "the fix
// is running". Every case below is a way the naive version of this check lies.
describe('Client build watermark', () => {
  it('takes the newest of the server build and the room\'s client builds', () => {
    const old = agent('Old', { clientBuildAt: NOW - 5 * HOUR });
    const fresh = agent('New', { clientBuildAt: NOW - 1 * HOUR });
    expect(buildWatermark([old, fresh], NOW - 3 * HOUR)).toBe(NOW - 1 * HOUR);
    // ...and the server wins when it is the freshest thing around, which is the
    // case that matters: every agent predates the deploy, so no agent can serve
    // as the reference point.
    expect(buildWatermark([old], NOW - 2 * HOUR)).toBe(NOW - 2 * HOUR);
  });

  it('ignores web rows and rows with no stamp instead of treating them as ancient', () => {
    const human = agent('Human', { client: 'web', clientBuildAt: NOW - 99 * HOUR });
    const legacy = agent('Legacy');
    const zeroed = agent('Zeroed', { clientBuildAt: 0 });
    expect(hasBuildStamp(legacy)).toBe(false);
    expect(hasBuildStamp(zeroed)).toBe(false);
    expect(buildWatermark([human, legacy, zeroed], 0)).toBe(0);
    // No watermark and no stamp => no claim in either direction.
    expect(clientBehindMs(legacy, 0)).toBe(0);
  });

  it('reports the gap only past the grace window, and never negative', () => {
    const watermark = NOW;
    expect(clientBehindMs(agent('A', { clientBuildAt: NOW - 2 * HOUR }), watermark)).toBe(2 * HOUR);
    // Same deploy, packages built minutes apart — not a finding. This is the
    // exact shape of the false positive that sized the grace window: a fresh
    // client whose bundle predated the server's by two minutes.
    expect(clientBehindMs(agent('B', { clientBuildAt: NOW - 2 * 60_000 }), watermark)).toBe(0);
    expect(clientBehindMs(agent('C', { clientBuildAt: NOW - CLIENT_BUILD_GRACE_MS }), watermark)).toBe(0);
    // A client NEWER than the watermark is current, not "behind by minus 1h".
    expect(clientBehindMs(agent('D', { clientBuildAt: NOW + HOUR }), watermark)).toBe(0);
  });

  it('a stale build never changes presence — an outdated agent is still alive', () => {
    const rows = [
      agent('Listening', { clientBuildAt: NOW - 6 * HOUR, listenUntil: NOW + 60_000 }),
      agent('Fresh', { clientBuildAt: NOW }),
    ];
    const [behind, current] = roomHealth(rows, NOW, 0);
    expect(behind?.state).toBe('listening');
    expect(behind?.clientBehindMs).toBe(6 * HOUR);
    expect(behind?.clientBuildAt).toBe(NOW - 6 * HOUR);
    // The current row carries its stamp but no gap field at all, so the UI can
    // treat "field present" as "there is something to act on".
    expect(current?.clientBehindMs).toBeUndefined();
    expect(current?.clientBuildAt).toBe(NOW);
  });

  it('carries no credential material into the health payload', () => {
    const rows = [agent('A', {
      clientBuildAt: NOW - HOUR,
      memberKeyHash: 'secret-hash',
      agentIdHash: 'anchor-hash',
    })];
    const [row] = roomHealth(rows, NOW, NOW);
    expect(JSON.stringify(row)).not.toContain('secret-hash');
    expect(JSON.stringify(row)).not.toContain('anchor-hash');
  });
});
