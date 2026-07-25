// T-126: READ-STATE IS USER-STATE (owner ruling, msg 1784738471478).
//
// Read markers belong to the ACCOUNT, not the device: if Waqas reads a room
// on his phone, his desktop must know. Markers are denominated in the
// server's absolute message counter (the same currency the web's local
// markers already use), stored per account in one redis hash:
//
//   readmarkers:<email>  { <room-code>: <count-read> }
//
// Writes are monotonic — a stale device syncing an old count can never walk
// an account's marker backwards. Reads return the whole map so Home can
// badge every room in one call. No TTL: the hash is tiny (one integer per
// room the account ever opened) and read state should outlive room history.
//
// Identity comes from the resolved caller (Access JWT email). Loopback
// callers (agents' MCP processes, QA probes) do not traverse Access, so
// they may name the account explicitly — loopback is already the trusted
// tier that can reach /kv directly. Anonymous callers get nothing.

export interface MarkerRedis {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
}

const markersKey = (email: string) => `readmarkers:${email.trim().toLowerCase()}`;
// Companion hash: when each room's marker last moved (epoch ms). Powers the
// push channel's suppress-when-reading check — a marker COUNT alone cannot
// distinguish "caught up an hour ago" from "reading right now".
const markerTimesKey = (email: string) => `readmarkers:ts:${email.trim().toLowerCase()}`;

export function resolveMarkerAccount(
  caller: { kind: 'local' } | { kind: 'user'; email: string } | { kind: 'anonymous' },
  explicitAccount: unknown,
): string {
  if (caller.kind === 'user') return caller.email;
  if (caller.kind === 'local') {
    const account = typeof explicitAccount === 'string' ? explicitAccount.trim().toLowerCase() : '';
    if (!account || !account.includes('@')) {
      const err = new Error('Loopback callers must name the account: pass account=<email>.');
      err.name = 'BadRequestError';
      throw err;
    }
    return account;
  }
  const err = new Error('Read markers require an authenticated session.');
  err.name = 'AccessDeniedError';
  throw err;
}

/** Monotonically advance one room's marker. Returns the stored (possibly
 *  unchanged) count. */
export async function setReadMarker(
  redis: MarkerRedis,
  email: string,
  code: string,
  count: number,
): Promise<number> {
  if (!code || !Number.isFinite(count) || count < 0) {
    const err = new Error('readMarkerSet requires code and a non-negative count.');
    err.name = 'BadRequestError';
    throw err;
  }
  const key = markersKey(email);
  const prevRaw = await redis.hget(key, code);
  const prev = prevRaw === null ? -1 : Number(prevRaw);
  const next = Math.max(Number.isFinite(prev) ? prev : -1, Math.floor(count));
  if (next !== prev) await redis.hset(key, code, String(next));
  return next;
}

/**
 * Record that the account's marker for this room moved (or was re-confirmed)
 * at `now`. Every readMarkerSet call stamps — even a no-op write is proof the
 * user has the room open — so the push channel can tell active reading from
 * a stale caught-up marker.
 */
export async function stampReadMarkerTime(
  redis: MarkerRedis,
  email: string,
  code: string,
  now: number,
): Promise<void> {
  if (!code || !Number.isFinite(now)) return;
  await redis.hset(markerTimesKey(email), code, String(Math.floor(now)));
}

/** One room's marker state: { count, movedAt } — null fields when unknown. */
export async function getReadMarkerState(
  redis: MarkerRedis,
  email: string,
  code: string,
): Promise<{ count: number | null; movedAt: number | null }> {
  const [countRaw, movedRaw] = await Promise.all([
    redis.hget(markersKey(email), code),
    redis.hget(markerTimesKey(email), code),
  ]);
  const count = countRaw === null ? null : Number(countRaw);
  const movedAt = movedRaw === null ? null : Number(movedRaw);
  return {
    count: count !== null && Number.isFinite(count) && count >= 0 ? count : null,
    movedAt: movedAt !== null && Number.isFinite(movedAt) && movedAt > 0 ? movedAt : null,
  };
}

/** The account's full marker map, { code: count }. */
export async function listReadMarkers(redis: MarkerRedis, email: string): Promise<Record<string, number>> {
  const raw = await redis.hgetall(markersKey(email));
  const out: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw ?? {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) out[code] = n;
  }
  return out;
}
