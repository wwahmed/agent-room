// Home's cold-start cache.
//
// The host's report: "going BACK from a room shows a blank screen, and
// launching the app takes a long time — this should be near instant."
//
// Both share one cause. `Home` is remounted on every navigation to `/`, and it
// began each mount with no identity and no rooms, then awaited /api/me and
// /api/rooms in series. Every render block on that screen is gated behind one
// of those two, so until the FIRST round trip resolved the page painted its
// header and nothing else. Back-navigation paid that price again in full even
// though the same rooms had just been on screen a second earlier.
//
// So Home renders from the last known-good snapshot immediately and revalidates
// behind it. The cache is a paint accelerant, never a source of truth: the live
// fetch always overwrites it, and a miss simply returns null so the caller
// falls back to the loading path it always had.
//
// Storage law: this is per-account and never survives a different sign-in. The
// snapshot records the identity it was captured under and is discarded on any
// mismatch, so one account can never flash another account's room titles.

import type { RoomSummary, WhoAmI } from './identity.js';

const KEY = 'wakichat:home:v1';

/** Snapshots older than this are ignored — a week-stale list is not a paint
 *  worth accelerating, and re-fetching from cold is the honest behavior. */
export const HOME_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface HomeSnapshot {
  identity: WhoAmI;
  rooms: RoomSummary[];
  /** Paging cursor at capture time, so "Load more" survives a warm start. */
  nextCursor: string | null;
  savedAt: number;
}

interface StoredSnapshot {
  identity?: unknown;
  rooms?: unknown;
  nextCursor?: unknown;
  savedAt?: unknown;
}

function isIdentity(value: unknown): value is WhoAmI {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.email === 'string' && typeof v.name === 'string';
}

/** Rooms are rendered straight from this, so a row without a usable code or
 *  createdAt is dropped rather than handed to the list to crash on. */
function isRoom(value: unknown): value is RoomSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.code === 'string' && v.code.length > 0 && Number.isFinite(Number(v.createdAt));
}

/**
 * Read the cached snapshot. Synchronous by design — Home calls this during its
 * initial `useState` so the first paint already has content; an async read
 * would reintroduce the blank frame this exists to remove.
 *
 * Returns null on: no snapshot, unparseable snapshot, expired snapshot, or a
 * snapshot belonging to a different account.
 */
export function readHomeCache(now = Date.now()): HomeSnapshot | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return null; } // private mode
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSnapshot;
    if (!isIdentity(parsed.identity)) return null;
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt)) return null;
    // A clock that moved backwards must not resurrect an expired snapshot, and
    // a future-dated one is corrupt — both fail closed to the loading path.
    if (savedAt > now || now - savedAt > HOME_CACHE_MAX_AGE_MS) return null;
    const rooms = Array.isArray(parsed.rooms) ? parsed.rooms.filter(isRoom) : [];
    return {
      identity: parsed.identity,
      rooms,
      nextCursor: typeof parsed.nextCursor === 'string' ? parsed.nextCursor : null,
      savedAt,
    };
  } catch {
    return null;
  }
}

/** Persist the freshly-fetched page. Failures are silent: a browser that
 *  refuses storage (private mode, quota) must still get a working Home. */
export function writeHomeCache(
  identity: WhoAmI,
  rooms: RoomSummary[],
  nextCursor: string | null,
  now = Date.now(),
): void {
  try {
    const snapshot: HomeSnapshot = { identity, rooms, nextCursor, savedAt: now };
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch { /* storage unavailable or full — the live fetch still renders */ }
}

/** Drop the snapshot. Called when the account check comes back anonymous or
 *  as a different user, so a signed-out device holds no room titles. */
export function clearHomeCache(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** True when the snapshot was captured under the account that is now signed
 *  in. Identity is keyed on email — the stable field across name changes. */
export function matchesIdentity(snapshot: HomeSnapshot | null, identity: WhoAmI | null): boolean {
  if (!snapshot || !identity) return false;
  return snapshot.identity.email === identity.email;
}
