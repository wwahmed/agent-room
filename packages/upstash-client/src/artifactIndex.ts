import type { RoomArtifact } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS, extractArtifacts } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { getMessageTotalCount, listMessages } from './messages.js';
import { artifactsKey, legacyArtifactsKey, artifactBackfillKey, artifactAppendCommands } from './artifactStore.js';

// T-71 durable produced-work index — read/merge orchestration. Low-level
// append helpers live in artifactStore.ts (imported by messages.ts); this
// module imports message READS one-way, so there is no import cycle.
//
// Safety model (rev17 review):
// - The v2 list is NEVER deleted. Store-time appends and the migration
//   merge both only add rows; readers dedupe by stable per-message id, so a
//   concurrent append during migration can never be erased (old design
//   DEL'd the live write target between snapshot and write).
// - The schema lives in the v2 KEY NAME, so schema identity cannot expire
//   separately from the data; losing the merged-marker merely repeats the
//   idempotent merge.
// - The merge lock is token-owned and released via one atomic EVAL
//   compare-and-delete — a holder that outlives the lock TTL cannot delete
//   a successor's lock, with no GET/DEL window.

export { artifactsKey } from './artifactStore.js';
export const ARTIFACT_INDEX_VERSION = '2';

function lockKey(code: string): string { return `room-artifacts-merge-lock:${code}`; }
const LOCK_SECONDS = 30;
const RELEASE_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

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
  const rows = parseRows(await client.command<string[] | null>(['LRANGE', artifactsKey(code), 0, -1]));
  return rows.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export interface EnsureIndexResult {
  /** true = another caller is merging right now AND the merge marker is not
   *  set yet; the caller must present Loading, never an empty list. */
  pending: boolean;
}

export async function ensureArtifactIndex(client: UpstashClient, code: string): Promise<EnsureIndexResult> {
  const merged = await client.command<string | null>(['GET', artifactBackfillKey(code)]);
  if (merged) return { pending: false };

  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const locked = await client.command<string | null>(['SET', lockKey(code), token, 'NX', 'EX', LOCK_SECONDS]);
  if (locked === null) return { pending: true }; // someone else is merging

  try {
    const existing = new Set((await listRoomArtifacts(client, code)).map(a => a.id));
    const legacy = parseRows(await client.command<string[] | null>(['LRANGE', legacyArtifactsKey(code), 0, -1]));
    const total = (await getMessageTotalCount(client, code)) ?? 0;
    const from = Math.max(0, total - MAX_MESSAGES_PER_ROOM);
    const retained = await listMessages(client, code, from);
    const retainedIds = new Set(retained.map(m => m.id));
    // Fresh v2 extraction upgrades every retained source (fixing truncated
    // legacy bodies and global-ordinal ids); legacy rows survive only for
    // sources Redis already trimmed. APPEND-ONLY: rows already in v2 —
    // including anything a concurrent send stored mid-merge — are skipped,
    // never rewritten, never deleted.
    const fresh = extractArtifacts(retained).filter(a => !existing.has(a.id));
    const kept = legacy.filter(a => !retainedIds.has(a.sourceMessageId) && !existing.has(a.id));
    const additions = [...kept, ...fresh];
    // Additions FIRST, marker SECOND, in separate steps: a failed addition
    // throws (the client surfaces per-command pipeline errors), the marker
    // stays absent, and the next ensure repairs the merge. The marker can
    // never record a completion the additions didn't earn.
    if (additions.length) await client.pipeline(artifactAppendCommands(code, additions));
    await client.command(['SET', artifactBackfillKey(code), ARTIFACT_INDEX_VERSION, 'EX', ROOM_TTL_SECONDS]);
    return { pending: false };
  } finally {
    // Atomic compare-and-delete: one EVAL, no GET/DEL window.
    await client.command(['EVAL', RELEASE_SCRIPT, 1, lockKey(code), token]);
  }
}

/** Back-compat wrapper for existing callers/tests. */
export async function backfillRoomArtifacts(client: UpstashClient, code: string): Promise<void> {
  await ensureArtifactIndex(client, code);
}
