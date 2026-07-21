import type { RoomArtifact } from '@agent-room/shared';
import { ROOM_TTL_SECONDS } from '@agent-room/shared';

// Dependency-free low-level helpers for the durable produced-work index
// (T-71). Orchestration (backfill/reads) lives in artifactIndex.ts, which
// imports message reads ONE-WAY; messages.ts imports only this module.

export function artifactsKey(code: string): string { return `room-artifacts:${code}`; }
export function artifactBackfillKey(code: string): string { return `room-artifacts-backfilled:${code}`; }

/** Commands that persist artifacts AND always refresh the index TTL — the
 *  TTL command is returned even with no artifacts, so every stored message
 *  keeps the index alive for as long as the room lives. Note: a Redis
 *  pipeline is batching, not a transaction — the id-stable merge in
 *  backfill is what makes retries safe, not atomicity. */
export function artifactAppendCommands(code: string, artifacts: RoomArtifact[]): (readonly (string | number)[])[] {
  return [
    ...artifacts.map(a => ['RPUSH', artifactsKey(code), JSON.stringify(a)] as const),
    ['EXPIRE', artifactsKey(code), ROOM_TTL_SECONDS] as const,
  ];
}
