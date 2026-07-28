// T-30: this server process's own bundle stamp, read once at boot for the same
// reason the MCP's is (apps/mcp/src/buildStamp.ts): a rebuild that lands while
// we are running must not move our stamp forward, because we are still
// executing the bytes we loaded.
//
// It seeds the client-staleness watermark, which is what makes the all-clients-
// are-stale case detectable — with no client running current code, no client
// can serve as the reference point. 0 means unknown; callers drop it from the
// watermark rather than treating it as an ancient build.

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

export const SERVER_BUILD_AT: number = readBuildStamp();
