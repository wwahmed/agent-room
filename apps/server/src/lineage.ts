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
 * The lineage of an authenticated row.
 *
 * An earlier version DERIVED this as sha256(room:anchor:joinedAt). A verifier
 * pointed out two problems and both were right: it coupled a public identifier to
 * secret material for no benefit, and keying on joinedAt meant an ordinary
 * reconnect minted a new identity, silently retiring every card that session had
 * posted. The value is now random and stored on the row at first join, preserved
 * by a reclaiming join, so continuity follows the session credential.
 *
 * Returns null for a row with no lineage — a row that predates this. Callers must
 * treat that as unbound and never substitute name+client.
 */
export function rowLineage(row: Participant): string | null {
  const id = row.lineageId;
  return isWellFormedLineage(id) ? id : null;
}

/** Is this a value we could have minted? Guards against a client inventing a
 *  plausible-looking id, since messages arrive from clients. */
export function isWellFormedLineage(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${LINEAGE_HEX_LENGTH}}$`).test(value);
}
