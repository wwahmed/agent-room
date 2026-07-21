import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// T-63 rev4: failure-path INTEGRATION tests — the real script, real process
// exits, no mocked rule functions. A dead server means every capture fails,
// which must surface as CAPTURE-INCOMPLETE (exit 5), and --update-baseline
// must refuse to promote that run.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'visual-gate.mjs');

function runGate(args, env) {
  try {
    execFileSync('node', [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      stdio: 'pipe',
      timeout: 240_000,
    });
    return 0;
  } catch (e) {
    if (e.status == null) throw e;
    return e.status;
  }
}

describe('visual-gate failure paths (integration, real process)', () => {
  it('a dead server yields CAPTURE-INCOMPLETE exit 5, never a clean pass', () => {
    const work = mkdtempSync(join(tmpdir(), 'vgate-'));
    const exit = runGate([], {
      VISUAL_GATE_BASE: 'http://127.0.0.1:59999', // nothing listens here
      VISUAL_GATE_WORK: work,
    });
    expect(exit).toBe(5);
  }, 300_000);

  it('--update-baseline REFUSES to promote an incomplete run (exit 5)', () => {
    const work = mkdtempSync(join(tmpdir(), 'vgate-'));
    const exit = runGate(['--update-baseline'], {
      VISUAL_GATE_BASE: 'http://127.0.0.1:59999',
      VISUAL_GATE_WORK: work,
    });
    expect(exit).toBe(5);
  }, 300_000);
});
