// T-49: an immutable, server-derived identity for the SESSION that sent a message.
//
// A verifier refused to call view actions safe while they bound to a display name.
// Names are mutable, they duplicate, and an agent that leaves and rejoins is a
// different session wearing the same name — so "route this request back to the
// producer" had no dependable anchor.
//
// The rows already hold durable anchors (agentIdHash for agents, authIdHash for
// authenticated humans, memberKeyHash otherwise), but those must NOT go onto
// messages: they are hashes of live credentials, and T-66's whole redaction pass
// exists because they were being handed out in payloads. Publishing them per
// message would be a much worse leak than the problem being solved.
//
// So lineage is a NEW value derived from them, room-scoped and one-way:
//
//   sha256(`${roomCode}:${anchor}:${joinedAt}`) truncated
//
// It cannot be replayed as a credential, it is stable across renames (the anchor
// and joinedAt do not move when a display name changes), it distinguishes two
// participants sharing a name (different anchors), and it distinguishes a rejoined
// session from the one it replaced (different joinedAt) — which is exactly the
// distinction the gate asks for.
//
// Messages predating this carry no lineage and are 'unbound'. Their actions are
// disabled rather than guessed from name+client, because guessing is the failure
// mode this exists to remove.

import type { Participant } from '@agent-room/shared';

/** Length of the hex lineage id. 128 bits of a SHA-256 is far beyond collision
 *  concern for participants in one room, and short enough to read in a log line. */
export const LINEAGE_HEX_LENGTH = 32;

/** The durable anchor for a row, most-stable first. Returns null when a row has
 *  none — a credential-unaware legacy row — which must stay unbound rather than
 *  fall back to something forgeable. */
export function lineageAnchor(row: Participant): string | null {
  return row.agentIdHash || row.authIdHash || row.memberKeyHash || null;
}

/**
 * Derive the lineage id for a row. `hash` is injected so this stays pure and
 * testable; callers pass the server's sha256Hex.
 *
 * Returns null when the row cannot be bound. Callers must treat that as "no
 * lineage" and never substitute name+client.
 */
export async function deriveLineage(
  roomCode: string,
  row: Participant,
  hash: (input: string) => Promise<string>,
): Promise<string | null> {
  const anchor = lineageAnchor(row);
  if (!anchor) return null;
  const joined = Number(row.joinedAt) || 0;
  const digest = await hash(`${roomCode}:${anchor}:${joined}`);
  return digest.slice(0, LINEAGE_HEX_LENGTH);
}

/** Is this lineage value one we could have produced? Guards against a client
 *  inventing a plausible-looking id, since messages arrive from clients. */
export function isWellFormedLineage(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${LINEAGE_HEX_LENGTH}}$`).test(value);
}
