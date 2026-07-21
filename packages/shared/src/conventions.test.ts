import { describe, expect, it } from 'vitest';
import { ROOM_CONVENTIONS, ROOM_CONVENTIONS_VERSION } from './conventions.js';

// T-21: the blurb is consumed verbatim by agent prompts and the join API, so
// pin the load-bearing content — every convention family and its key verbs.
describe('ROOM_CONVENTIONS', () => {
  it('is versioned', () => {
    expect(ROOM_CONVENTIONS).toContain(`v${ROOM_CONVENTIONS_VERSION}`);
  });

  it('covers all four artifact markers', () => {
    for (const marker of ['[DECISION]', '[TODO]', '[STATUS]', '[RESULT]']) {
      expect(ROOM_CONVENTIONS).toContain(marker);
    }
  });

  it('explains mentions, the task lifecycle, and status pings', () => {
    expect(ROOM_CONVENTIONS).toMatch(/@Name/);
    for (const tool of ['room_task_create', 'room_task_claim', 'room_task_submit', 'room_task_verify', 'room_status']) {
      expect(ROOM_CONVENTIONS).toContain(tool);
    }
    expect(ROOM_CONVENTIONS).toMatch(/verifier != owner/);
  });

  it('carries the shared-tree and no-secrets rules', () => {
    expect(ROOM_CONVENTIONS).toMatch(/announce builds/i);
    expect(ROOM_CONVENTIONS).toMatch(/never paste secrets/i);
    expect(ROOM_CONVENTIONS).toMatch(/not authenticated/i);
  });

  it('carries the lifecycle identity invariant and safe recovery rule', () => {
    expect(ROOM_CONVENTIONS).toMatch(/one session = one lineage/i);
    expect(ROOM_CONVENTIONS).toMatch(/resume the exact session/i);
    expect(ROOM_CONVENTIONS).toContain('@custodian');
  });

  it('stays compact enough to ride inside a join prompt', () => {
    expect(ROOM_CONVENTIONS.length).toBeLessThan(2000);
  });
});
