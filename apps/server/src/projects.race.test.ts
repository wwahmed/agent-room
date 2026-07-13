// T-18 REAL contention tests (Codex round-3, item 5): multiple OS
// processes race the same ledger/registry through the actual compiled
// module (dist/projects.js — built by `npm -w apps/server run build`
// which runs before these tests in CI/dev flow). One in-process suite
// can't interleave synchronous fs code, so these spawn `node` children.

import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const WORK = mkdtempSync(join(tmpdir(), 'wakichat-t18-race-'));
const REGISTRY = join(WORK, 'projects.json');
const REPO = join(WORK, 'repo');
const OUTSIDE = join(WORK, 'outside');
const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'projects.js');
const DIST_URL = pathToFileURL(DIST).href;

function childScript(body: string): string {
  return `
    process.env.PROJECTS_FILE = ${JSON.stringify(REGISTRY)};
    const m = await import(${JSON.stringify(DIST_URL)});
    ${body}
  `;
}

async function spawnChild(body: string, env: Record<string, string> = {}): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run(
      process.execPath,
      ['--input-type=module', '-e', childScript(body)],
      { timeout: 20_000, env: { ...process.env, ...env } },
    );
    return { ok: true, out: stdout.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

const BOARD_JS = (n: number) =>
  `{ tasks: [{ id: 'T-01', title: 'writer-${n}', state: 'done', createdBy: 'C' }] }`;

beforeAll(() => {
  rmSync(REPO, { recursive: true, force: true });
  mkdirSync(join(REPO, 'docs'), { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  writeFileSync(REGISTRY, JSON.stringify({ proj: { name: 'P', root: REPO, docs: { tasks: 'docs/TASKS.md' } } }));
});

describe('multi-process contention (real children on dist/projects.js)', () => {
  it('dist bundle exists (build before test)', () => {
    expect(existsSync(DIST)).toBe(true);
  });

  it('8 simultaneous writers: every child succeeds cleanly or reports a lock/CAS conflict; final ledger is valid', async () => {
    const children = Array.from({ length: 8 }, (_, n) =>
      spawnChild(`
        for (let i = 0; i < 10; i++) {
          try {
            const r = m.syncTaskLedger('proj', 'RAC-ERA-CEE', ${BOARD_JS(0)}, true);
            console.log('write:' + r.changed);
          } catch (e) {
            if (e.name !== 'LedgerConflictError') { console.error('UNEXPECTED:' + e.name + ':' + e.message); process.exit(2); }
            console.log('locked');
          }
        }
      `),
    );
    const results = await Promise.all(children);
    for (const r of results) {
      expect(r.out).not.toContain('UNEXPECTED');
    }
    // At least one write landed and the final file is structurally intact.
    const content = readFileSync(join(REPO, 'docs', 'TASKS.md'), 'utf8');
    expect(content.match(/wakichat:tasks:begin/g)?.length).toBe(1);
    expect(content.match(/wakichat:tasks:end/g)?.length).toBe(1);
    expect(content).toMatch(/wakichat:hash:[0-9a-f]{16}/);
    // Round-trippable machine state (no torn writes).
    const child = await spawnChild(`
      const l = m.loadLedgerBoard('proj');
      if (!l || l.board.tasks.length !== 1) process.exit(2);
      console.log('roundtrip-ok');
    `);
    expect(child.out).toContain('roundtrip-ok');
    // No leftover lock or tmp files.
    expect(existsSync(join(REPO, 'docs', 'TASKS.md.lock'))).toBe(false);
  }, 60_000);

  it('writer vs symlink-swapper: ZERO filesystem events land outside the root', async () => {
    // Codex round-4 standard: transient artifacts count. An fs.watch on
    // the outside directory must observe NOTHING for the whole race —
    // not just an empty directory at the end.
    const { watch } = await import('node:fs');
    const outsideEvents: string[] = [];
    const watcher = watch(OUTSIDE, (event, filename) => {
      outsideEvents.push(`${event}:${filename ?? '?'}`);
    });
    try {
      const writer = spawnChild(`
        let wrote = 0, denied = 0;
        for (let i = 0; i < 40; i++) {
          try { m.syncTaskLedger('proj', 'RAC-ERA-CEE', ${BOARD_JS(1)}, true); wrote++; }
          catch (e) { denied++; }
        }
        console.log('wrote:' + wrote + ' denied:' + denied);
      `);
      // Swap docs/ <-> symlink-to-OUTSIDE concurrently, from this process.
      const docs = join(REPO, 'docs');
      const swapper = (async () => {
        for (let i = 0; i < 40; i++) {
          try {
            rmSync(docs, { recursive: true, force: true });
            symlinkSync(OUTSIDE, docs);
            await new Promise(r => setTimeout(r, 2));
            rmSync(docs, { recursive: true, force: true });
            mkdirSync(docs, { recursive: true });
            await new Promise(r => setTimeout(r, 2));
          } catch { /* raced with the writer — fine */ }
        }
      })();
      const [w] = await Promise.all([writer, swapper]);
      expect(w.out).toMatch(/wrote:\d+ denied:\d+/);
      // give the watcher a beat to flush any queued events
      await new Promise(r => setTimeout(r, 200));
      expect(outsideEvents).toEqual([]);
      expect(existsSync(join(OUTSIDE, 'TASKS.md'))).toBe(false);
      expect(existsSync(join(OUTSIDE, 'TASKS.md.lock'))).toBe(false);
    } finally {
      watcher.close();
    }
  }, 60_000);

  it('two simultaneous registrations both survive (registry lock/CAS)', async () => {
    // Issue tokens in each child via its own discovery (tokens are
    // process-local), then race the registry write.
    mkdirSync(join(WORK, 'scan', 'repo-a', '.git'), { recursive: true });
    mkdirSync(join(WORK, 'scan', 'repo-b', '.git'), { recursive: true });
    const reg = (dir: string) => spawnChild(`
      const cands = m.listProjectCandidates();
      const c = cands.find(c => c.dirName === ${JSON.stringify(dir)});
      if (!c) { console.error('candidate missing: ' + JSON.stringify(cands)); process.exit(2); }
      for (let i = 0; i < 5; i++) {
        try { const p = m.createProjectFromCandidate(c.key); console.log('created:' + p.id); break; }
        catch (e) {
          if (e.name === 'LedgerConflictError') { await new Promise(r => setTimeout(r, 10)); continue; }
          console.error('FAIL:' + e.name + ':' + e.message); process.exit(2);
        }
      }
    `, { PROJECT_SCAN_ROOTS: join(WORK, 'scan') });
    const [a, b] = await Promise.all([reg('repo-a'), reg('repo-b')]);
    expect(a.out).toContain('created:repo-a');
    expect(b.out).toContain('created:repo-b');
    const finalReg = JSON.parse(readFileSync(REGISTRY, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(finalReg)).toContain('repo-a');
    expect(Object.keys(finalReg)).toContain('repo-b');
    expect(Object.keys(finalReg)).toContain('proj'); // original preserved
  }, 60_000);
});
