import type { RoomArtifact } from '@agent-room/shared';
import { ROOM_TTL_SECONDS } from '@agent-room/shared';

// Dependency-free low-level helpers for the durable produced-work index
// (T-71). Orchestration (backfill/reads) lives in artifactIndex.ts, which
// imports message reads ONE-WAY; messages.ts imports only this module.

// The SCHEMA lives in the key name (v2 = per-message ordinal ids +
// multiline bodies), so schema identity can never expire independently of
// the data and a lost done-marker only costs a harmless re-merge — the v2
// list is never deleted by anyone.
export function artifactsKey(code: string): string { return `room-artifacts-v2:${code}`; }
export function legacyArtifactsKey(code: string): string { return `room-artifacts:${code}`; }
export function artifactBackfillKey(code: string): string { return `room-artifacts-v2-merged:${code}`; }

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
