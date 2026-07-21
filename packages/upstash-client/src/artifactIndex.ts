import type { RoomArtifact } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS, extractArtifacts } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { getMessageTotalCount, listMessages } from './messages.js';

// T-71 durable produced-work index (review-found regression: Outputs
// extracted from the client's paged transcript window, so legitimate
// Decisions silently vanished as pagination advanced — and Redis LTRIMs the
// message list to the newest MAX_MESSAGES_PER_ROOM, so even a server-side
// full scan cannot see older history). Artifacts are therefore extracted at
// STORE time into their own never-trimmed list, and reads never depend on
// the transcript window.

export function artifactsKey(code: string): string { return `room-artifacts:${code}`; }
function backfillKey(code: string): string { return `room-artifacts-backfilled:${code}`; }

/** Pipeline commands that persist a stored message's artifacts. Returned as
 *  commands (not executed) so rpushMessage can include them in the SAME
 *  pipeline as the message write — the index can never drift from the list. */
export function artifactAppendCommands(code: string, artifacts: RoomArtifact[]): (readonly (string | number)[])[] {
  if (!artifacts.length) return [];
  return [
    ...artifacts.map(a => ['RPUSH', artifactsKey(code), JSON.stringify(a)] as const),
    ['EXPIRE', artifactsKey(code), ROOM_TTL_SECONDS] as const,
  ];
}

export async function listRoomArtifacts(client: UpstashClient, code: string): Promise<RoomArtifact[]> {
  const raw = await client.command<string[] | null>(['LRANGE', artifactsKey(code), 0, -1]);
  const out: RoomArtifact[] = [];
  for (const entry of raw ?? []) {
    try { out.push(JSON.parse(entry) as RoomArtifact); } catch { /* skip torn entry */ }
  }
  return out;
}

/** One-time recovery for rooms whose produced work predates the index: seed
 *  from whatever transcript history Redis still retains, then mark done so
 *  the scan never repeats. Idempotent and safe to call on every read. */
export async function backfillRoomArtifacts(client: UpstashClient, code: string): Promise<void> {
  const done = await client.command<string | null>(['GET', backfillKey(code)]);
  if (done) return;
  const existing = await client.command<number | null>(['LLEN', artifactsKey(code)]);
  if (!existing) {
    const total = (await getMessageTotalCount(client, code)) ?? 0;
    const from = Math.max(0, total - MAX_MESSAGES_PER_ROOM);
    const messages = await listMessages(client, code, from);
    const found = extractArtifacts(messages);
    const cmds = artifactAppendCommands(code, found);
    if (cmds.length) await client.pipeline(cmds);
  }
  await client.pipeline([
    ['SET', backfillKey(code), '1'],
    ['EXPIRE', backfillKey(code), ROOM_TTL_SECONDS],
  ]);
}
