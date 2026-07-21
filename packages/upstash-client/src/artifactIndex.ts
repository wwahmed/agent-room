import type { RoomArtifact } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS, extractArtifacts } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { getMessageTotalCount, listMessages } from './messages.js';
import { artifactsKey, artifactBackfillKey, artifactAppendCommands } from './artifactStore.js';

// T-71 durable produced-work index — read/rebuild orchestration. Low-level
// append helpers live in artifactStore.ts (imported by messages.ts); this
// module imports message READS one-way, so there is no import cycle.

export { artifactsKey } from './artifactStore.js';

// Schema version. v2 = per-message ordinal ids + multiline continuation
// bodies. Rooms whose version key is missing or older get REBUILT once:
// retained source messages are re-extracted fresh (upgrading truncated
// legacy rows in place), and legacy rows whose sources are already trimmed
// from Redis are kept as-is — unimprovable but never lost.
export const ARTIFACT_INDEX_VERSION = '2';
function versionKey(code: string): string { return `room-artifacts-version:${code}`; }
function lockKey(code: string): string { return `room-artifacts-backfill-lock:${code}`; }
const LOCK_SECONDS = 30;

function parseRows(raw: (string | null)[] | null): RoomArtifact[] {
  const out: RoomArtifact[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    if (!entry) continue;
    try {
      const a = JSON.parse(entry) as RoomArtifact;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    } catch { /* skip torn entry */ }
  }
  return out;
}

export async function listRoomArtifacts(client: UpstashClient, code: string): Promise<RoomArtifact[]> {
  return parseRows(await client.command<string[] | null>(['LRANGE', artifactsKey(code), 0, -1]));
}

export interface EnsureIndexResult {
  /** true = another caller is rebuilding right now; the caller must present
   *  Loading, never an empty list (review: lock contention served a false
   *  zero to the second reader). */
  pending: boolean;
}

/** Bring the room's index to the current schema exactly once, safely under
 *  concurrency. The version key is written only AFTER a successful rebuild;
 *  the short-lived lock carries a unique token and is released by
 *  compare-and-delete, so a caller that outlives the lock TTL can never
 *  delete a successor's lock (rev16 review items 2-4). */
export async function ensureArtifactIndex(client: UpstashClient, code: string): Promise<EnsureIndexResult> {
  const version = await client.command<string | null>(['GET', versionKey(code)]);
  if (version === ARTIFACT_INDEX_VERSION) return { pending: false };

  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const locked = await client.command<string | null>(['SET', lockKey(code), token, 'NX', 'EX', LOCK_SECONDS]);
  if (locked === null) return { pending: true }; // someone else is rebuilding

  try {
    const legacy = await listRoomArtifacts(client, code);
    const total = (await getMessageTotalCount(client, code)) ?? 0;
    const from = Math.max(0, total - MAX_MESSAGES_PER_ROOM);
    const retained = await listMessages(client, code, from);
    const retainedIds = new Set(retained.map(m => m.id));
    // Fresh v2 extraction for every retained source; legacy rows survive
    // only for sources Redis has already trimmed (keyed by source, so old
    // global-ordinal ids cannot duplicate the upgraded rows).
    const fresh = extractArtifacts(retained);
    const kept = legacy.filter(a => !retainedIds.has(a.sourceMessageId));
    const final = [...kept, ...fresh].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    await client.pipeline([
      ['DEL', artifactsKey(code)],
      ...artifactAppendCommands(code, final),
      ['SET', versionKey(code), ARTIFACT_INDEX_VERSION, 'EX', ROOM_TTL_SECONDS],
      ['SET', artifactBackfillKey(code), '1', 'EX', ROOM_TTL_SECONDS],
    ]);
    return { pending: false };
  } finally {
    // Ownership-safe release: only delete the lock we still own.
    const holder = await client.command<string | null>(['GET', lockKey(code)]);
    if (holder === token) await client.command(['DEL', lockKey(code)]);
  }
}

/** Back-compat wrapper for existing callers/tests. */
export async function backfillRoomArtifacts(client: UpstashClient, code: string): Promise<void> {
  await ensureArtifactIndex(client, code);
}
