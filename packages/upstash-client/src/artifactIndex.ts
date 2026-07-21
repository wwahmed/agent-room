import type { RoomArtifact } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS, extractArtifacts } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { getMessageTotalCount, listMessages } from './messages.js';
import { artifactsKey, artifactBackfillKey, artifactAppendCommands } from './artifactStore.js';

// T-71 durable produced-work index — read/backfill orchestration. Low-level
// append helpers live in artifactStore.ts (imported by messages.ts); this
// module imports message READS one-way, so there is no import cycle.

export { artifactsKey } from './artifactStore.js';

export async function listRoomArtifacts(client: UpstashClient, code: string): Promise<RoomArtifact[]> {
  const raw = await client.command<string[] | null>(['LRANGE', artifactsKey(code), 0, -1]);
  const out: RoomArtifact[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    try {
      const a = JSON.parse(entry) as RoomArtifact;
      // Dedupe by stable id on READ, so a lost race between concurrent
      // backfills can never surface duplicates to a page.
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    } catch { /* skip torn entry */ }
  }
  return out;
}

/** MERGE retained transcript history into the index by stable artifact id.
 *  Runs at most once per room (SETNX lock) but is harmless when repeated:
 *  only artifacts whose ids are absent from the index are appended, so a
 *  post-deploy artifact arriving before first read can never hide older
 *  Decisions, and concurrent first reads cannot double-seed. */
export async function backfillRoomArtifacts(client: UpstashClient, code: string): Promise<void> {
  const locked = await client.command<string | null>(['SET', artifactBackfillKey(code), '1', 'NX', 'EX', ROOM_TTL_SECONDS]);
  if (locked === null) return; // another caller holds/completed the backfill
  const existing = new Set((await listRoomArtifacts(client, code)).map(a => a.id));
  const total = (await getMessageTotalCount(client, code)) ?? 0;
  const from = Math.max(0, total - MAX_MESSAGES_PER_ROOM);
  const messages = await listMessages(client, code, from);
  const missing = extractArtifacts(messages).filter(a => !existing.has(a.id));
  if (missing.length) await client.pipeline(artifactAppendCommands(code, missing));
}
