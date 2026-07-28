// T-30: the build stamp of the bundle THIS PROCESS actually loaded.
//
// An MCP fix only reaches an agent when that agent's MCP process restarts.
// Nothing used to say which sessions were running pre-fix code, so the fleet
// could sit on a stale client for days while the repo, the tests and the board
// all agreed the bug was fixed — the same invisible-staleness class as T-28's
// "verified but not deployed", one layer down.
//
// Two properties make the stamp honest:
//  1. It is read ONCE, at module load. A rebuild that lands after we booted must
//     NOT move our stamp forward: this process is still executing the bytes it
//     loaded, so claiming the newer build would be a lie in the one direction
//     that matters (old code reading as current).
//  2. It describes the loaded FILE, not the package version. Version numbers
//     lag local builds, and the runtime here is a symlink to the repo's own
//     dist — mtime is the only thing that tracks reality.
//
// 0 means "unknown" (stat failed, or an exotic loader with no file URL).
// Callers must treat 0 as no-evidence, never as epoch-0.

import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readBuildStamp(): number {
  try {
    const self = fileURLToPath(import.meta.url);
    const stamp = statSync(self).mtimeMs;
    return Number.isFinite(stamp) && stamp > 0 ? Math.floor(stamp) : 0;
  } catch {
    return 0;
  }
}

export const CLIENT_BUILD_AT: number = readBuildStamp();
