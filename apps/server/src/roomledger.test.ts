import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// v2 room-data root: every room persists its board to an app-owned per-room
// directory, no registry required. Env must land before the module reads it.
process.env.ROOMS_DATA_ROOT = mkdtempSync(join(tmpdir(), 'wakichat-room-data-'));
const { syncRoomLedger, loadRoomLedger, roomDataDir } = await import('./projects.js');

const board = {
  tasks: [
    { id: 'T-01', title: 'Ticket: printer export fails', state: 'in_progress', owner: 'DeskAgent', verifier: 'Waqas', dod: 'customer has a working export' },
  ],
};

describe('room-data ledger (v2 root)', () => {
  it('creates the room directory on demand and round-trips the board', () => {
    const res = syncRoomLedger('hail-cow-dart', board as never);
    expect(res.changed).toBe(true);
    expect(existsSync(join(roomDataDir('hail-cow-dart'), 'TASKS.md'))).toBe(true);
    const back = loadRoomLedger('hail-cow-dart');
    expect(back?.roomCode).toBe('hail-cow-dart');
    expect(back?.board.tasks.map(t => t.id)).toEqual(['T-01']);
  });

  it('is idempotent: an unchanged board does not rewrite the ledger', () => {
    const res = syncRoomLedger('hail-cow-dart', board as never);
    expect(res.changed).toBe(false);
  });

  it('an empty baseline (room creation) writes, and later boards supersede it', () => {
    expect(syncRoomLedger('cafe-ham-clog', { tasks: [] } as never).changed).toBe(true);
    expect(loadRoomLedger('cafe-ham-clog')?.board.tasks).toEqual([]);
    syncRoomLedger('cafe-ham-clog', board as never);
    expect(loadRoomLedger('cafe-ham-clog')?.board.tasks).toHaveLength(1);
  });

  it('refuses path-hostile room codes', () => {
    expect(() => roomDataDir('../evil')).toThrow();
    expect(() => roomDataDir('a/b')).toThrow();
    expect(() => roomDataDir('')).toThrow();
  });

  it('returns null for a room that never synced', () => {
    expect(loadRoomLedger('lane-keg-dime')).toBe(null);
  });
});
