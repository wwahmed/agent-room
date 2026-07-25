// T-126: READ-STATE IS USER-STATE. The synchronous localStorage markers in
// unread.ts stay the fast path every call site already uses; this module is
// the account sync around them:
//
//   - pull: fetch the account's server-side marker map and fold any HIGHER
//     server counts into localStorage (your phone read further → desktop
//     catches up). Called when Home or a Room mounts.
//   - push: when markRoomRead advances a local marker it dispatches a
//     'wakichat:read-marker' event; we debounce and POST the new count.
//     Writes are monotonic server-side, so racing devices converge on max.
//
// The web caller is identified by its Access JWT at the edge — no account
// parameter is sent (the server refuses spoofing anyway: edge callers' JWT
// email always wins). Failures are silent: read sync is a convergence layer,
// never a gate on reading.

import { mergeServerReadMarker, getReadCount } from './unread.js';

// A session that cannot be attributed to an account (no Access JWT — e.g. a
// direct loopback open) gets a 400/403 on its first marker call and would get
// one on every call after. Stand down for the rest of the session instead of
// spamming the console with known-failing requests; markers stay device-local
// exactly as before T-126.
let unavailable = false;

async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (unavailable) return null;
  try {
    const resp = await fetch('/api/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.status === 400 || resp.status === 403) {
      unavailable = true;
      return null;
    }
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Pull the account's markers and fold higher server counts into local
 *  storage. Returns the codes whose local marker advanced (callers can
 *  re-render badges). Also pushes up any rooms where LOCAL is ahead, so
 *  the account converges from both directions. */
export async function syncReadMarkers(): Promise<string[]> {
  const out = await call({ action: 'readMarkerList' });
  const markers = (out as { result?: { markers?: Record<string, number> } } | null)?.result?.markers;
  if (!markers) return [];
  const advanced: string[] = [];
  for (const [code, serverCount] of Object.entries(markers)) {
    if (mergeServerReadMarker(code, serverCount)) advanced.push(code);
    else {
      const local = getReadCount(code);
      if (local !== null && local > serverCount) void pushReadMarker(code, local);
    }
  }
  return advanced;
}

export async function pushReadMarker(code: string, count: number): Promise<void> {
  await call({ action: 'readMarkerSet', code, count });
}

// Debounced push per room: reading a room fires markRoomRead on every poll,
// and each send advances it again — one POST per quiet second is plenty.
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function installReadMarkerSync(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('wakichat:read-marker', (e: Event) => {
    const { code, total } = (e as CustomEvent<{ code: string; total: number }>).detail ?? {};
    if (!code || !Number.isFinite(total)) return;
    const prior = pending.get(code);
    if (prior) clearTimeout(prior);
    pending.set(code, setTimeout(() => {
      pending.delete(code);
      void pushReadMarker(code, total);
    }, 1000));
  });
}

// T-118 all-messages mode: the server suppresses 'all'-level pushes only while
// the account's marker stamp is fresh (~90s). The stamp normally moves when a
// marker advances — but a QUIET room advances nothing, so without a heartbeat
// the first message after a lull would push even mid-stare. Re-confirming the
// unchanged marker is enough: the server stamps time on every sync.
export const READING_HEARTBEAT_MS = 45_000;

/**
 * While a room screen is mounted, re-confirm its read marker on a throttled
 * interval. Ticks only while the tab is visible — a hidden tab must not count
 * as reading. Returns a stop function for the caller's unmount cleanup.
 */
export function startReadingHeartbeat(code: string): () => void {
  if (typeof window === 'undefined' || !code) return () => {};
  const tick = () => {
    if (document.visibilityState !== 'visible') return;
    const count = getReadCount(code);
    if (count !== null) void pushReadMarker(code, count);
  };
  const timer = setInterval(tick, READING_HEARTBEAT_MS);
  tick(); // opening the room confirms presence immediately
  return () => clearInterval(timer);
}
