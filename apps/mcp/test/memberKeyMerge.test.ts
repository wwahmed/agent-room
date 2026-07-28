import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// T-27: the credential reader must find a key that lives in a SIBLING state
// file. STATE_FILE is keyed by process.ppid, so a harness that respawned the
// MCP leaves rooms whose credential was written under the previous file — the
// old single-file read returned undefined and every credentialed call silently
// degraded (room_leave stranding ghost rows was the visible symptom).

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

const state = (rooms: Record<string, unknown>) =>
  JSON.stringify({ version: 1, blockStreak: 0, rooms });

describe('T-27 member credential lookup spans every state file', () => {
  it('readMergedState surfaces a credential written under a different ppid file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-key-merge-'));
    vi.stubEnv('AGENT_ROOM_STATE_DIR', dir);
    // The sibling (older session) holds the credential…
    await writeFile(join(dir, 'state-424242.json'), state({
      'brew-tan-clap': { name: 'ClaudeAdmin', cursor: 4, joinedAt: 100, memberKey: 'siblingkey' },
    }));
    // …and this process's own file knows the room but NOT the key.
    await writeFile(join(dir, `state-${process.ppid}.json`), state({
      'brew-tan-clap': { name: 'ClaudeAdmin', cursor: 9, joinedAt: 50 },
    }));

    const { readState, readMergedState } = await import('../src/state.js');
    // The old behavior — own file only — is exactly the miss we are fixing.
    expect((await readState()).rooms['brew-tan-clap']?.memberKey).toBeUndefined();
    // The merged view carries it forward, so the fallback finds it.
    expect((await readMergedState()).rooms['brew-tan-clap']?.memberKey).toBe('siblingkey');
    expect((await readdir(dir)).length).toBe(2);
  });

  it('a newer own-file entry still wins for cursor while the key survives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-room-key-merge2-'));
    vi.stubEnv('AGENT_ROOM_STATE_DIR', dir);
    await writeFile(join(dir, 'state-999999.json'), state({
      'hail-cow-dart': { name: 'ClaudeAdmin', cursor: 1, joinedAt: 10, memberKey: 'oldkey' },
    }));
    await writeFile(join(dir, `state-${process.ppid}.json`), state({
      'hail-cow-dart': { name: 'ClaudeAdmin', cursor: 390, joinedAt: 999 },
    }));

    const { readMergedState } = await import('../src/state.js');
    const row = (await readMergedState()).rooms['hail-cow-dart'];
    expect(row?.cursor).toBe(390);        // newest progress kept
    expect(row?.memberKey).toBe('oldkey'); // credential never lost
  });
});
