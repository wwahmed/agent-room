import { describe, expect, it } from 'vitest';
import { detectInstallTargets } from '../src/init.js';

function detector(paths: string[], bins: string[] = []) {
  const pathSet = new Set(paths);
  const binSet = new Set(bins);
  return detectInstallTargets({
    home: '/home/agent',
    platform: 'linux',
    env: {},
    whichCmd: async (cmd) => (binSet.has(cmd) ? `/usr/bin/${cmd}` : null),
    pathExistsFn: async (path) => pathSet.has(path),
  });
}

describe('detectInstallTargets', () => {
  it('detects all installed clients without requiring a manual target choice', async () => {
    await expect(detector([
      '/home/agent/.claude',
      '/home/agent/.codex',
      '/home/agent/.cursor',
      '/home/agent/.gemini',
    ])).resolves.toEqual(['claude', 'codex', 'cursor', 'gemini']);
  });

  it('detects clients from binaries and harness environment signals', async () => {
    await expect(detectInstallTargets({
      home: '/home/agent',
      platform: 'linux',
      env: {
        CODEX_RUN_ID: 'run_123',
        CURSOR_TRACE_ID: 'trace_123',
      },
      whichCmd: async (cmd) => (cmd === 'claude' ? '/usr/bin/claude' : null),
      pathExistsFn: async () => false,
    })).resolves.toEqual(['claude', 'codex', 'cursor']);
  });

  it('returns an empty list when no supported client is detected', async () => {
    await expect(detector([])).resolves.toEqual([]);
  });
});
