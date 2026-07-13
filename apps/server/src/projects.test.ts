// T-18 acceptance tests: registry fail-closed, path/symlink safety,
// ledger integrity (tamper + legacy fail-closed + force migration),
// idempotence, lock discipline, and writer serialization.
//
// PROJECTS_FILE is fixed to a temp path BEFORE the module import below
// (module reads it at load time); each test rewrites that file's content.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, unlinkSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const WORK = mkdtempSync(join(tmpdir(), 'wakichat-t18-'));
const REGISTRY = join(WORK, 'projects.json');
process.env.PROJECTS_FILE = REGISTRY;
process.env.PROJECT_SCAN_ROOTS = join(WORK, 'scan');
// Server-owned lock/journal dir — isolate from ~/.wakichat during tests.
process.env.LEDGER_STATE_DIR = join(WORK, 'state');

const {
  loadRegistry,
  resolveDocPath,
  readDoc,
  syncTaskLedger,
  loadLedgerBoard,
  sectionIntegrity,
  listProjectCandidates,
  createProjectFromCandidate,
  stateKeyFor,
  lockPathFor,
} = await import('./projects.js');

const REPO = join(WORK, 'repo');
const OUTSIDE = join(WORK, 'outside');

function setRegistry(obj: unknown): void {
  writeFileSync(REGISTRY, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
}

function goodRegistry(docs: Record<string, string> = { tasks: 'docs/TASKS.md', brief: 'README.md' }) {
  setRegistry({ proj: { name: 'Proj', root: REPO, docs } });
}

const BOARD = { tasks: [{ id: 'T-01', title: 'First', state: 'done', createdBy: 'Claude', owner: 'Claude', verifier: 'Codex', createdAt: 1783900000000 }] };
const BOARD2 = { tasks: [...BOARD.tasks, { id: 'T-02', title: 'Second', state: 'todo', createdBy: 'Codex' }] };

beforeEach(() => {
  rmSync(REPO, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
  rmSync(join(WORK, 'scan'), { recursive: true, force: true });
  mkdirSync(join(REPO, 'docs'), { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  writeFileSync(join(REPO, 'README.md'), '# readme\n');
  goodRegistry();
});

describe('registry fail-closed', () => {
  it('missing file is a valid empty registry', () => {
    unlinkSync(REGISTRY);
    expect(loadRegistry()).toEqual({});
  });

  it('malformed JSON throws ProjectRegistryError', () => {
    setRegistry('{ not json');
    expect(() => loadRegistry()).toThrowError(/not valid JSON/);
  });

  it('invalid entry throws with the entry named (no silent skip)', () => {
    setRegistry({ 'Bad Id!': { name: 'x', root: REPO, docs: {} } });
    expect(() => loadRegistry()).toThrowError(/Bad Id!/);
    setRegistry({ p: { name: '', root: REPO, docs: {} } });
    expect(() => loadRegistry()).toThrowError(/"name"/);
    setRegistry({ p: { name: 'x', root: 'relative/root', docs: {} } });
    expect(() => loadRegistry()).toThrowError(/absolute path/);
    setRegistry({ p: { name: 'x', root: REPO, docs: { tasks: '../escape.md' } } });
    expect(() => loadRegistry()).toThrowError(/safe relative path/);
  });

  it('underscore-prefixed keys are documentation, not entries', () => {
    setRegistry({ _comment: 'hi', proj: { name: 'Proj', root: REPO, docs: { tasks: 'docs/TASKS.md' } } });
    expect(Object.keys(loadRegistry())).toEqual(['proj']);
  });
});

describe('path and symlink safety', () => {
  it('denies traversal and absolute doc paths at load time', () => {
    setRegistry({ p: { name: 'x', root: REPO, docs: { tasks: '/etc/hosts' } } });
    expect(() => resolveDocPath('p', 'tasks')).toThrowError();
  });

  it('denies a symlinked subdirectory escaping the root', () => {
    symlinkSync(OUTSIDE, join(REPO, 'docs', 'link'));
    setRegistry({ proj: { name: 'Proj', root: REPO, docs: { tasks: 'docs/link/TASKS.md' } } });
    expect(() => resolveDocPath('proj', 'tasks')).toThrowError(/symlink/);
  });

  it('denies a symlink swap of the parent between syncs', () => {
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    // swap docs/ for a symlink pointing outside the repo
    rmSync(join(REPO, 'docs'), { recursive: true, force: true });
    symlinkSync(OUTSIDE, join(REPO, 'docs'));
    expect(() => syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2)).toThrowError(/symlink|outside the project root/);
    expect(existsSync(join(OUTSIDE, 'TASKS.md'))).toBe(false);
  });

  it('unknown project and role are 404-shaped errors', () => {
    expect(() => readDoc('nope', 'tasks')).toThrowError(/Unknown project/);
    expect(() => readDoc('proj', 'nope')).toThrowError(/no doc role/);
  });
});

describe('ledger integrity', () => {
  it('writes, round-trips, and is idempotent', () => {
    const first = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    expect(first.changed).toBe(true);
    const again = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    expect(again.changed).toBe(false); // identical board: no churn
    const loaded = loadLedgerBoard('proj');
    expect(loaded?.board.tasks.map(t => t.id)).toEqual(['T-01']);
    expect(loaded?.roomCode).toBe('AAA-BBB-CCC');
  });

  it('detects tampering inside the markers and refuses without force', () => {
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    const p = join(REPO, 'docs', 'TASKS.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('_Last sync:', '_EDITED Last sync:'));
    const res = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2);
    expect(res.conflict).toMatch(/modified outside WakiChat/);
    expect(readFileSync(p, 'utf8')).toContain('_EDITED');
    const forced = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2, true);
    expect(forced.changed).toBe(true);
    expect(readFileSync(p, 'utf8')).not.toContain('_EDITED');
  });

  it('fails closed on a legacy hashless section; force migrates it', () => {
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    const p = join(REPO, 'docs', 'TASKS.md');
    // strip the hash line to simulate a pre-hash ledger
    writeFileSync(p, readFileSync(p, 'utf8').replace(/<!-- wakichat:hash:[0-9a-f]{16} -->\n/, ''));
    const res = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2);
    expect(res.conflict).toMatch(/no integrity hash/);
    const forced = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2, true);
    expect(forced.changed).toBe(true);
    expect(readFileSync(p, 'utf8')).toMatch(/wakichat:hash:[0-9a-f]{16}/);
  });

  it('preserves every byte outside the markers', () => {
    const p = join(REPO, 'docs', 'TASKS.md');
    writeFileSync(p, '# my own notes\nkeep me\n');
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    writeFileSync(p, readFileSync(p, 'utf8') + 'trailing manual line\n');
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2);
    const out = readFileSync(p, 'utf8');
    expect(out).toContain('# my own notes\nkeep me');
    expect(out).toContain('trailing manual line');
    expect(out).toContain('T-02');
  });

  it('sectionIntegrity classifies clean/tampered/legacy', () => {
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD);
    const p = join(REPO, 'docs', 'TASKS.md');
    const content = readFileSync(p, 'utf8');
    const section = content.slice(content.indexOf('<!-- wakichat:tasks:begin'), content.indexOf('<!-- wakichat:tasks:end -->') + '<!-- wakichat:tasks:end -->'.length);
    expect(sectionIntegrity(section)).toBe('clean');
    expect(sectionIntegrity(section.replace('T-01', 'T-XX'))).toBe('tampered');
    expect(sectionIntegrity(section.replace(/<!-- wakichat:hash:[0-9a-f]{16} -->\n/, ''))).toBe('legacy');
  });
});

describe('lock discipline (server-owned STATE_DIR)', () => {
  it('refuses while a fresh lock is held, then takes over a stale one', () => {
    // The lock lives in the server-owned STATE_DIR now, keyed by the
    // canonical ledger path — NOT in the repo (that was the round-5 race).
    syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD); // create the ledger so realpath resolves
    const canonical = realpathSync(join(REPO, 'docs', 'TASKS.md'));
    const lock = lockPathFor(stateKeyFor(canonical));
    writeFileSync(lock, JSON.stringify({ pid: 99999, at: Date.now() }));
    expect(() => syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2)).toThrowError(/lock/);
    const past = new Date(Date.now() - 60_000);
    utimesSync(lock, past, past); // age it like a crashed writer's lock
    const res = syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD2);
    expect(res.changed).toBe(true);
    expect(existsSync(lock)).toBe(false); // released
    // A stray lock in the REPO must NOT block writes (it did before r6).
    const strayRepoLock = join(REPO, 'docs', 'TASKS.md.lock');
    writeFileSync(strayRepoLock, 'x');
    expect(syncTaskLedger('proj', 'AAA-BBB-CCC', BOARD).changed).toBeDefined();
  });

  it('serializes many sequential writers without corruption', () => {
    for (let i = 0; i < 25; i++) {
      const res = syncTaskLedger('proj', 'AAA-BBB-CCC', i % 2 ? BOARD2 : BOARD);
      expect(res.conflict).toBeUndefined();
    }
    const loaded = loadLedgerBoard('proj');
    expect(loaded?.board.tasks.length).toBe(1); // last write was BOARD (i=24)
    const canonical = realpathSync(join(REPO, 'docs', 'TASKS.md'));
    expect(existsSync(lockPathFor(stateKeyFor(canonical)))).toBe(false);
  });
});

describe('safe onboarding', () => {
  it('lists only git repos under scan roots and creates from a candidate key', () => {
    const scan = join(WORK, 'scan');
    mkdirSync(join(scan, 'myrepo', '.git'), { recursive: true });
    mkdirSync(join(scan, 'notarepo'), { recursive: true });
    writeFileSync(join(scan, 'myrepo', 'README.md'), '# r\n');
    const candidates = listProjectCandidates();
    expect(candidates.map(c => c.dirName)).toContain('myrepo');
    expect(candidates.map(c => c.dirName)).not.toContain('notarepo');
    const cand = candidates.find(c => c.dirName === 'myrepo')!;
    const created = createProjectFromCandidate(cand.key);
    expect(created.id).toBe('myrepo');
    expect(created.docs).toContain('tasks');
    expect(created.docs).toContain('brief');
    // registered repos disappear from candidates; the used token is
    // single-use, so replaying it fails as unknown
    expect(listProjectCandidates().map(c => c.dirName)).not.toContain('myrepo');
    expect(() => createProjectFromCandidate(cand.key)).toThrowError(/Unknown or expired/);
  });

  it('rejects any key not issued by discovery (tokens are opaque and server-minted)', () => {
    expect(() => createProjectFromCandidate('0:../../etc')).toThrowError(/Unknown or expired/);
    expect(() => createProjectFromCandidate('9:whatever')).toThrowError(/Unknown or expired/);
    expect(() => createProjectFromCandidate('junk')).toThrowError(/Unknown or expired/);
    expect(() => createProjectFromCandidate('a'.repeat(32))).toThrowError(/Unknown or expired/);
  });
});
