// T-18 round 6: crash-recovery + torn-ledger fault injection for the
// write-ahead-journalled ledger. Proves Codex's guardrails: recovery is
// automatic/idempotent, preserves exact pre-write user bytes, and any
// torn/unverifiable state fails closed — never a silent append or a
// partially-written ledger exposed as success.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const WORK = mkdtempSync(join(tmpdir(), 'wakichat-t18r6-'));
process.env.PROJECTS_FILE = join(WORK, 'projects.json');
process.env.LEDGER_STATE_DIR = join(WORK, 'state');

const { syncTaskLedger, loadLedgerBoard } = await import('./projects.js');

const REPO = join(WORK, 'repo');
const LEDGER = join(REPO, 'docs', 'TASKS.md');
const B1 = { tasks: [{ id: 'T-01', title: 'one', state: 'done', createdBy: 'C' }] };
const B2 = { tasks: [{ id: 'T-01', title: 'one', state: 'done', createdBy: 'C' }, { id: 'T-02', title: 'two', state: 'todo', createdBy: 'D' }] };

function setRegistry() {
  writeFileSync(process.env.PROJECTS_FILE!, JSON.stringify({ proj: { name: 'P', root: REPO, docs: { tasks: 'docs/TASKS.md' } } }));
}

beforeEach(() => {
  rmSync(REPO, { recursive: true, force: true });
  rmSync(process.env.LEDGER_STATE_DIR!, { recursive: true, force: true });
  mkdirSync(join(REPO, 'docs'), { recursive: true });
  setRegistry();
});
afterEach(() => { delete process.env.WAKICHAT_TEST_CRASH_AT; });

const beginCount = (s: string) => (s.match(/wakichat:tasks:begin/g) || []).length;
const endCount = (s: string) => (s.match(/wakichat:tasks:end/g) || []).length;

describe('crash recovery at every write boundary', () => {
  for (const stage of ['after-journal-fsync', 'after-ledger-truncate', 'after-ledger-fsync', 'after-journal-cleanup'] as const) {
    it(`crash "${stage}" recovers to a single valid ledger with the intended board`, () => {
      syncTaskLedger('proj', 'AAA-BBB-CCC', B1);        // clean starting point (B1)
      process.env.WAKICHAT_TEST_CRASH_AT = stage;
      expect(() => syncTaskLedger('proj', 'AAA-BBB-CCC', B2)).toThrow(); // "crash" mid-write of B2
      delete process.env.WAKICHAT_TEST_CRASH_AT;

      // Recovery runs on the next read; the ledger must be exactly one valid
      // section and never a torn/double-marker file.
      const loaded = loadLedgerBoard('proj');
      const content = readFileSync(LEDGER, 'utf8');
      expect(beginCount(content)).toBe(1);
      expect(endCount(content)).toBe(1);
      // For every stage the durable outcome is a COMPLETE board — either the
      // crashed B2 write was completed by recovery, or (crash before the
      // ledger was touched at all) B1 survived. Never a partial.
      const ids = loaded?.board.tasks.map(t => t.id).sort();
      expect(ids === undefined || JSON.stringify(ids) === JSON.stringify(['T-01']) || JSON.stringify(ids) === JSON.stringify(['T-01', 'T-02'])).toBe(true);
      // A subsequent normal sync must succeed cleanly (idempotent recovery
      // left no stuck journal/lock).
      const res = syncTaskLedger('proj', 'AAA-BBB-CCC', B2);
      expect(res.conflict).toBeUndefined();
      expect(loadLedgerBoard('proj')?.board.tasks.map(t => t.id)).toEqual(['T-01', 'T-02']);
    });
  }

  it('after-journal-fsync + after-ledger-truncate specifically COMPLETE the crashed write (journal re-applied)', () => {
    for (const stage of ['after-journal-fsync', 'after-ledger-truncate'] as const) {
      rmSync(REPO, { recursive: true, force: true });
      rmSync(process.env.LEDGER_STATE_DIR!, { recursive: true, force: true });
      mkdirSync(join(REPO, 'docs'), { recursive: true });
      setRegistry();
      syncTaskLedger('proj', 'AAA-BBB-CCC', B1);
      process.env.WAKICHAT_TEST_CRASH_AT = stage;
      expect(() => syncTaskLedger('proj', 'AAA-BBB-CCC', B2)).toThrow();
      delete process.env.WAKICHAT_TEST_CRASH_AT;
      // The journal held the full B2 content and was fsync'd before the
      // ledger mutation, so recovery COMPLETES B2 (not a rollback to B1).
      expect(loadLedgerBoard('proj')?.board.tasks.map(t => t.id)).toEqual(['T-01', 'T-02']);
    }
  });
});

describe('user-authored bytes survive a torn write', () => {
  it('preserves exact prefix/suffix across a mid-write crash', () => {
    // Seed a ledger with user content around the managed section.
    writeFileSync(LEDGER, '# MY NOTES\nkeep-this-prefix\n');
    syncTaskLedger('proj', 'AAA-BBB-CCC', B1);
    let content = readFileSync(LEDGER, 'utf8');
    content = content + 'keep-this-suffix\n';
    writeFileSync(LEDGER, content);
    // Crash mid-write of B2 (ledger truncated), then recover.
    process.env.WAKICHAT_TEST_CRASH_AT = 'after-ledger-truncate';
    expect(() => syncTaskLedger('proj', 'AAA-BBB-CCC', B2)).toThrow();
    delete process.env.WAKICHAT_TEST_CRASH_AT;
    loadLedgerBoard('proj'); // triggers recovery
    const out = readFileSync(LEDGER, 'utf8');
    expect(out).toContain('# MY NOTES\nkeep-this-prefix');
    expect(out).toContain('keep-this-suffix');
    expect(beginCount(out)).toBe(1);
  });
});

describe('torn ledger with no journal fails CLOSED (the round-5 double-marker bug)', () => {
  it('a BEGIN-without-END section is a conflict, never a second appended section', () => {
    syncTaskLedger('proj', 'AAA-BBB-CCC', B1);
    // Simulate a torn ledger: keep everything up to (not including) the END
    // marker, and make sure no journal exists.
    const full = readFileSync(LEDGER, 'utf8');
    const torn = full.slice(0, full.indexOf('wakichat:tasks:end')); // BEGIN present, END gone
    writeFileSync(LEDGER, torn);
    rmSync(process.env.LEDGER_STATE_DIR!, { recursive: true, force: true }); // no journal
    const res = syncTaskLedger('proj', 'AAA-BBB-CCC', B2);
    expect(res.conflict).toMatch(/torn|incomplete/i);
    const after = readFileSync(LEDGER, 'utf8');
    expect(beginCount(after)).toBe(1); // NOT two begin markers
    // force rebuilds to a single valid section.
    const forced = syncTaskLedger('proj', 'AAA-BBB-CCC', B2, true);
    expect(forced.changed).toBe(true);
    const rebuilt = readFileSync(LEDGER, 'utf8');
    expect(beginCount(rebuilt)).toBe(1);
    expect(endCount(rebuilt)).toBe(1);
    expect(loadLedgerBoard('proj')?.board.tasks.map(t => t.id)).toEqual(['T-01', 'T-02']);
  });
});

describe('parent/lock swap leaves zero outside artifacts (lock+journal are server-owned)', () => {
  it('an outside sentinel is never created/modified/deleted; write fails closed on swap', () => {
    const OUTSIDE = join(WORK, 'outside');
    rmSync(OUTSIDE, { recursive: true, force: true });
    mkdirSync(OUTSIDE, { recursive: true });
    // Pre-existing sentinels an attacker would hope we clobber.
    writeFileSync(join(OUTSIDE, 'TASKS.md'), 'SENTINEL');
    writeFileSync(join(OUTSIDE, 'TASKS.md.lock'), 'SENTINEL-LOCK');
    const before = readdirSync(OUTSIDE).sort();
    const sentinelMtime = statSync(join(OUTSIDE, 'TASKS.md')).mtimeMs;

    syncTaskLedger('proj', 'AAA-BBB-CCC', B1); // establish the ledger
    // Swap docs/ for a symlink to OUTSIDE.
    rmSync(join(REPO, 'docs'), { recursive: true, force: true });
    symlinkSync(OUTSIDE, join(REPO, 'docs'));
    // The write must fail closed (no-follow open refuses the swapped parent).
    expect(() => syncTaskLedger('proj', 'AAA-BBB-CCC', B2)).toThrow();

    // OUTSIDE is byte-for-byte untouched: same entries, same sentinel content/mtime.
    expect(readdirSync(OUTSIDE).sort()).toEqual(before);
    expect(readFileSync(join(OUTSIDE, 'TASKS.md'), 'utf8')).toBe('SENTINEL');
    expect(readFileSync(join(OUTSIDE, 'TASKS.md.lock'), 'utf8')).toBe('SENTINEL-LOCK');
    expect(statSync(join(OUTSIDE, 'TASKS.md')).mtimeMs).toBe(sentinelMtime);
    // The lock/journal live in the server-owned state dir, not the repo.
    expect(readdirSync(process.env.LEDGER_STATE_DIR!).every(f => !f.startsWith('.'))).toBe(true);
  });
});
