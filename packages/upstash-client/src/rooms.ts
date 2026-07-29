import type {
  Room,
  Participant,
  RemovalRecord,
  ReplyMode,
  ReplyModeConfig,
} from '@agent-room/shared';
import { AVATAR_PALETTE, DEFAULT_TURN_TIMEOUTS_MS, ROOM_TTL_SECONDS } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { RoomNotFoundError, ConcurrencyError } from './errors.js';

function roomKey(code: string): string { return `room:${code}`; }

// 32 hex chars (~128 bits). Stored on the host's sessionStorage; only the
// SHA-256 hash of this key lands on the server (`Room.hostKeyHash`) so a
// passive Redis dump doesn't leak the secret.
function generateHostKey(): string {
  const bytes = new Uint8Array(16);
  // Browsers, Workers, and modern Node all expose globalThis.crypto.
  const cryptoObj: Crypto = (globalThis as unknown as { crypto: Crypto }).crypto;
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const cryptoObj: Crypto = (globalThis as unknown as { crypto: Crypto }).crypto;
  const buf = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

// T-30 (F2): a room-scoped, 128-bit member credential. Same shape/entropy as
// the host key. Handed to the joining client once; only its hash is stored.
export function generateMemberKey(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj: Crypto = (globalThis as unknown as { crypto: Crypto }).crypto;
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export interface CreateRoomInput {
  code: string;
  topic: string;
  createdBy: string;
  /** Server-verified host identity (for example the Access JWT email). */
  hostAuthId?: string;
  ownerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  /** Local workspace path this room is based in; summoned agents inherit it. */
  workspace?: string;
  /** Room-template id (shared registry). Host-editable later via setRoomTemplate. */
  templateId?: string;
}

// createRoom now returns the Room PLUS a one-time `hostKey`. The host stores
// hostKey in sessionStorage and presents it to verifyHostKey on any future
// (name === createdBy) join. Returning a flat shape (Room intersection,
// not a wrapper object) keeps existing callers working — they were already
// reading `room.code`, `room.participants`, etc., and those still work.
// New, host-aware callers destructure `hostKey` off the same value.
export type CreateRoomResult = Room & { hostKey: string };

export async function createRoom(client: UpstashClient, input: CreateRoomInput): Promise<CreateRoomResult> {
  const now = Date.now();
  const hostKey = generateHostKey();
  const room: Room = {
    code: input.code,
    topic: input.topic,
    createdAt: now,
    createdBy: input.createdBy,
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    workspace: input.workspace,
    templateId: input.templateId,
    status: 'active',
    version: 1,
    participants: [],
    hostKeyHash: await sha256Hex(hostKey),
    hostAuthIdHash: input.hostAuthId ? await sha256Hex(input.hostAuthId) : undefined,
    // Default: open mode. Host can switch to 'sequential' / 'moderator' via
    // setReplyMode(). Stored explicitly (rather than relying on the
    // undefined-means-open fallback) so newly created rooms surface the
    // field on the very first room_join response — clients can render the
    // mode chip without waiting for a setReplyMode round-trip.
    replyMode: 'open',
  };
  await client.command(['SET', roomKey(input.code), JSON.stringify(room), 'EX', ROOM_TTL_SECONDS]);
  return { ...room, hostKey };
}

export async function getRoom(client: UpstashClient, code: string): Promise<Room> {
  const raw = await client.command<string | null>(['GET', roomKey(code)]);
  if (raw === null || raw === undefined) throw new RoomNotFoundError(code);
  return JSON.parse(raw) as Room;
}

const CAS_MAX_ATTEMPTS = 3;

export async function casRoom(
  client: UpstashClient,
  code: string,
  mutator: (current: Room) => Room
): Promise<Room> {
  let lastError: unknown;
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const current = await getRoom(client, code);
    let next: Room;
    try {
      next = mutator(current);
    } catch (e) {
      if (e instanceof ConcurrencyError) {
        lastError = e;
        continue;
      }
      throw e;
    }
    // Optimistic write: bump version. Full atomic CAS is deferred — a stale-read-then-overwrite
    // window is acceptable here because the only mutable field is `participants`, and messages
    // (the hot path) use atomic RPUSH. Version bumps make drift visible if it ever matters.
    next.version = current.version + 1;
    await client.command(['SET', roomKey(code), JSON.stringify(next), 'EX', ROOM_TTL_SECONDS]);
    return next;
  }
  throw lastError instanceof ConcurrencyError ? lastError : new ConcurrencyError();
}

// Thrown when a non-host tries to claim the host's display name. The room
// rejects rather than auto-suffixing because impersonation of the host has
// outsized blast radius — agents trust host instructions.
export class HostNameTakenError extends Error {
  constructor(host: string) {
    super(`The name "${host}" is reserved for the room host. Please pick a different display name.`);
    this.name = 'HostNameTakenError';
  }
}

// T-66: refused an attempt to bind an agent's durable anchor to a row the
// caller has not proven it owns (the row carries a different anchor, or is
// protected by a key/auth the caller did not present). Fails the join loudly
// rather than silently suffixing, because a silent suffix is what let identity
// fragmentation go unnoticed in the first place — and because binding an anchor
// to someone else's row would be an irrevocable takeover.
export class AgentAnchorConflictError extends Error {
  constructor(rowName: string) {
    super(`Refusing to bind an agent identity anchor to "${rowName}": that row belongs to a different identity.`);
    this.name = 'AgentAnchorConflictError';
  }
}

// Identity is (name, client). Same name + same client from the same logical
// session is idempotent (browser refresh / agent reconnect just refreshes
// presence). Two important rules layered on top:
//
// 1. Host-name lock: if `participant.name === room.createdBy`, the caller
//    must present the matching `hostKey`. Without it, we throw
//    HostNameTakenError. This is what stops "anyone with the code can
//    impersonate the host".
//
// 2. Non-host name collision: if any other participant already uses the same
//    visible room name and the caller hasn't shown they own the original seat
//    (no shared client identity yet — see Tier B), we auto-suffix "(2)" /
//    "(3)" so two real humans or agents named "Robin" stay distinguishable.
//
// `priorIdentity` is the caller's previous (name, client) tuple if any —
// the web client passes its sessionStorage entry so a refresh on /r/CODE
// still updates the same row instead of getting a "(2)" suffix.
export interface JoinRoomOptions {
  hostKey?: string;
  // Set to the caller's prior identity in the room (from sessionStorage / MCP
  // state). When provided AND it matches an existing participant, that row
  // gets updated in place. Without it, the join is treated as fresh and
  // collisions get suffixed.
  priorIdentity?: { name: string; client: 'web' | 'cc' };
  // T-30 (F2): mint a one-time member credential for this row. The server
  // sets this ONLY for credential-capable callers (web/edge). Credential-
  // unaware MCP joins leave it false so the row stays keyless and takes the
  // flag-gated legacy send path — a re-joining MCP agent is never locked out.
  issueMemberKey?: boolean;
  // T-25 reclaim anchor (a): the plaintext memberKey the caller already holds
  // and is presenting on this (re)join (the same key it sends to authenticate).
  // joinRoom hashes it (async, before the CAS mutator) and, when it matches an
  // existing row's memberKeyHash, reclaims that row in place — the durable
  // anchor for AGENTS, whose MCP client persists the key.
  reclaimMemberKey?: string;
  // T-66 reclaim anchor (0): an agent's durable, room-scoped anchor (plaintext;
  // joinRoom hashes it to `agentIdHash`). The server sets this ONLY for a
  // trusted LOCAL caller on a 'cc' row — a web client can never supply it, so a
  // browser cannot mint an agent identity. Unlike `reclaimMemberKey` this value
  // does not rotate, so it still resolves after the agent's key store is lost.
  // See Participant.agentIdHash for why the rotating key alone is not enough.
  agentId?: string;
  // T-25 reclaim anchor (b): the caller's server-VERIFIED identity (the Access
  // JWT email). The server sets this ONLY for authenticated web callers
  // (caller.kind === 'user'); it is NEVER derived from client-supplied data.
  // joinRoom hashes it to `authIdHash` (the raw value is never stored — rows
  // are room-visible) and uses it both to reclaim the caller's existing row
  // (durable anchor for a human across tabs/sessions) and to stamp the row.
  authId?: string;
}

// Returns the updated Room with an extra `participant` field showing the
// final, possibly-renamed participant tuple ("Robin (2)" if a name collision
// was suffixed). Existing callers reading `result.participants` etc. still
// work; new callers can read `result.participant.name` to learn what name
// was actually assigned.
// T-66: what the durable anchor DID on this join, so the caller can emit an
// audit event. Credential recovery must never be silent — a row changing hands
// is exactly the event an operator needs to see, and "it worked quietly" is how
// a stolen identity would look too.
//
//   anchor_bound    — the anchor was attached to an existing row for the first
//                     time (a pre-T-66 keyed row proving ownership with its key,
//                     or an unprotected row). Nothing was recovered; the row is
//                     now recoverable in future.
//   anchor_recovery — THE ONE THAT MATTERS. A protected row was reclaimed using
//                     ONLY the anchor, because the rotating member key was not
//                     presented (lost store). This is the credential-loss
//                     recovery path, and it is the one that must always be
//                     audited.
//
// Carries no hashes, keys or anchors — only room-visible identity, so it is safe
// to log verbatim.
export type AnchorOutcome = 'anchor_bound' | 'anchor_recovery';
export interface AnchorAudit {
  outcome: AnchorOutcome;
  name: string;
  client: Participant['client'];
  /** true when the reclaimed row carried a memberKeyHash the caller could not present. */
  reclaimedProtectedRow: boolean;
}

// T-32 removal provenance carried by joins.
//   displaced      — live rows this join removed (same-name dedup or anchor
//                    recovery). The server posts a system message for each so
//                    a displacement is never silent.
//   removalNotice  — why THIS identity's previous row was removed, popped
//                    from room.lastRemovals; the MCP surfaces it to the agent
//                    with dispute instructions on rejoin.
export interface DisplacedRow {
  name: string;
  client: Participant['client'];
  mechanism: RemovalRecord['mechanism'];
}

export type JoinRoomResult = Room & {
  participant: Participant;
  memberKey?: string;
  anchorAudit?: AnchorAudit;
  displaced?: DisplacedRow[];
  removalNotice?: RemovalRecord & { name: string };
};

const removalKey = (name: string, client: Participant['client']) => `${name}\n${client}`;

/**
 * T-49 tombstone: a removed row's lineage, keyed by the ANCHOR HASH that proves
 * ownership of it. Leaving or being kicked must not permanently retire the cards a
 * session posted — but restoring them has to require the credential, or the
 * restoration is just the name-guessing this scheme replaced. Kept outside the room
 * record so an anchor hash never rides along in a room payload.
 */
const lineageTombKey = (code: string, anchorHash: string) => `lineagetomb:${code}:${anchorHash}`;
/** T-49: 128 bits of randomness. Opaque and public — it identifies a session
 *  without revealing anything about the credential that proves it. */
function newLineageId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// A row that spoke/listened inside this window is a LIVE session; removing it
// is displacement, not cleanup. Matches ANCHOR_RECLAIM_LIVE_MS semantics.
function rowIsLive(row: Participant, now: number): boolean {
  return Number(row.listenUntil || 0) > now
    || now - Number(row.lastSeenAt || 0) <= ANCHOR_RECLAIM_LIVE_MS;
}

// T-25: locate the caller's existing row to reclaim on (re)join, so a returning
// participant updates their SAME row instead of proliferating "(2)", "(3)" …
// rows. Anchors are tried most-durable first:
//   (a) memberKeyHash — the member credential the caller is presenting. Durable
//       anchor for AGENTS (their MCP client persists the key).
//   (b) authIdHash — the caller's server-VERIFIED Access identity. Durable
//       anchor for a HUMAN across tabs/sessions (the web memberKey is per-tab
//       sessionStorage; the Access cookie is not).
//   (c) priorIdentity — the (name, client) tuple the client remembered. This
//       branch is UNAUTHENTICATED, so it may reclaim ONLY an unprotected row
//       (no memberKeyHash AND no authIdHash). A bare name claim must never
//       displace a key- or auth-protected identity's row.
// Returns the matched row (an actual element of current.participants), or
// undefined for a genuinely new identity. `reclaimMemberKeyHash` and
// `authIdHash` are resolved by joinRoom (hashed outside the CAS mutator).
// T-32: a row that spoke/listened within this window counts as a LIVE sibling
// session; anchor reclaim may not displace it under a different name. Matches
// the server's PRESENCE_STALE_MS so "live" means the People panel would show
// the row as listening/online.
const ANCHOR_RECLAIM_LIVE_MS = 60_000;

interface ReclaimAnchors {
  agentIdHash?: string;
  reclaimMemberKeyHash?: string;
  authIdHash?: string;
  priorIdentity?: JoinRoomOptions['priorIdentity'];
  /** T-32: the joining participant's display name and clock for the live-row guard. */
  joinerName?: string;
  now?: number;
}
function findReclaimRow(current: Room, anchors: ReclaimAnchors): Participant | undefined {
  // T-66 anchor (0): the agent's DURABLE anchor, tried before the member key.
  // It outranks the key precisely because it does not rotate — it is the only
  // anchor that still resolves after the agent's key store is lost, which is
  // the case this whole mechanism exists to recover.
  //
  // T-32 guard: multiple live sessions on one machine can share this anchor
  // (Codex's fixed-file launcher config gives EVERY session the same agentId).
  // Anchor-reclaiming a row that is ACTIVELY PRESENT under a DIFFERENT name is
  // therefore not recovery — it silently renames a living participant out of
  // the room (the glue-vow-soap "the room removed me" kicks). Reclaim by
  // anchor only when the row has the same name (a true re-join) or has gone
  // quiet long enough to plausibly be the lost session this mechanism exists
  // to bring home.
  // T-32: is this row a LIVE session under a different name than the joiner?
  // Shared launcher configs give sibling sessions the same anchor AND the same
  // member-key store (Codex's fixed-file proxy), so BOTH identity branches can
  // otherwise rename a living participant out of the room. Reclaiming a live
  // different-name row is displacement, not recovery, whichever anchor matched.
  const isLiveSibling = (row: Participant): boolean => {
    const sameName = anchors.joinerName !== undefined && row.name === anchors.joinerName;
    if (sameName) return false;
    const now = anchors.now ?? Date.now();
    const listening = Number(row.listenUntil || 0) > now;
    const heardRecently = now - Number(row.lastSeenAt || 0) <= ANCHOR_RECLAIM_LIVE_MS;
    return listening || heardRecently;
  };
  if (anchors.agentIdHash) {
    const byAgent = current.participants.find(p => p.agentIdHash === anchors.agentIdHash);
    if (byAgent && !isLiveSibling(byAgent)) return byAgent;
    // Live row, different name: a sibling session owns it. Fall through so
    // this join lands as its own identity.
  }
  if (anchors.reclaimMemberKeyHash) {
    const byKey = current.participants.find(p => p.memberKeyHash === anchors.reclaimMemberKeyHash);
    if (byKey && !isLiveSibling(byKey)) return byKey;
  }
  if (anchors.authIdHash) {
    const byAuth = current.participants.find(p => p.authIdHash === anchors.authIdHash);
    if (byAuth) return byAuth;
  }
  const prior = anchors.priorIdentity;
  if (prior) {
    const byPrior = current.participants.find(p =>
      p.name === prior.name
      && p.client === prior.client
      && !p.memberKeyHash
      && !p.authIdHash);
    if (byPrior) return byPrior;
  }
  return undefined;
}

function uniqueNameForRoom(
  desiredName: string,
  current: Room,
  selfRow: Participant | undefined,
): string {
  const taken = new Set(
    current.participants
      .filter(p => p !== selfRow)
      .map(p => p.name),
  );
  if (!taken.has(desiredName) || desiredName === current.createdBy) return desiredName;

  let n = 2;
  let candidate = `${desiredName} (${n})`;
  while (taken.has(candidate)) candidate = `${desiredName} (${++n})`;
  return candidate;
}

function uniqueColorForRoom(
  desiredColor: string,
  current: Room,
  selfRow: Participant | undefined,
): string {
  const used = new Set(
    current.participants
      .filter(p => p !== selfRow)
      .map(p => p.color),
  );
  if (!used.has(desiredColor)) return desiredColor;
  return AVATAR_PALETTE.find(color => !used.has(color)) ?? desiredColor;
}

export async function joinRoom(
  client: UpstashClient,
  code: string,
  participant: Participant,
  options: JoinRoomOptions = {}
): Promise<JoinRoomResult> {
  let outParticipant = participant;
  // T-66: set inside the CAS mutator (and reset on each retry) so the caller can
  // audit what the durable anchor did. See AnchorAudit.
  let anchorAudit: AnchorAudit | undefined;
  // T-32: set inside the CAS mutator (reset per retry) — live rows this join
  // displaced, and the popped provenance for this identity's prior removal.
  let displaced: DisplacedRow[] = [];
  let removalNotice: (RemovalRecord & { name: string }) | undefined;
  // T-30 (F2): mint the credential (async crypto) BEFORE the synchronous CAS
  // mutator, exactly like hostKey. The plaintext is returned once; only the
  // hash is stored on the row.
  let memberKey: string | undefined;
  let memberKeyHash: string | undefined;
  if (options.issueMemberKey) {
    memberKey = generateMemberKey();
    memberKeyHash = await sha256Hex(memberKey);
  }
  // T-25: resolve the reclaim anchors (async crypto) BEFORE the synchronous CAS
  // mutator. The presented key is hashed for a hash-vs-hash match; the verified
  // identity is hashed so the raw email never lands on a room-visible row.
  const reclaimMemberKeyHash = options.reclaimMemberKey
    ? await sha256Hex(options.reclaimMemberKey)
    : undefined;
  const authIdHash = options.authId ? await sha256Hex(options.authId) : undefined;
  const agentIdHash = options.agentId ? await sha256Hex(options.agentId) : undefined;
  // T-49: if this session's row is GONE (it left, or the host removed it), its
  // lineage may be tombstoned. Presenting the credential is what reactivates it, so
  // the cards it posted start working again — while a replacement wearing the same
  // display name gets a fresh lineage and inherits nothing.
  let restoredLineage: string | undefined;
  for (const anchor of [agentIdHash, reclaimMemberKeyHash, authIdHash]) {
    if (!anchor || restoredLineage) continue;
    const found = await client.command<string | null>(['GET', lineageTombKey(code, anchor)]);
    if (typeof found === 'string' && found) restoredLineage = found;
  }
  const room = await casRoom(client, code, (current) => {
    // T-25/T-66: find the caller's existing row to reclaim (agentIdHash →
    // memberKeyHash → authIdHash → priorIdentity). Reclaiming updates that row
    // IN PLACE; a genuinely new identity (reclaim === undefined) is suffixed on
    // collision.
    const reclaim = findReclaimRow(current, {
      agentIdHash,
      reclaimMemberKeyHash,
      authIdHash,
      priorIdentity: options.priorIdentity,
      joinerName: participant.name,
      now: Date.now(),
    });

    // T-66: decide whether this join may BIND its agent anchor to the reclaimed
    // row. Binding is what makes a row recoverable later, so the rule has to be
    // tight — a permissive bind is a silent identity takeover.
    //
    // Binding is allowed only when the caller has ALREADY proven it owns the
    // row, by one of:
    //   - the row carries this exact anchor (a no-op re-bind), or
    //   - the row is UNPROTECTED (no key, no auth, no other anchor) — the same
    //     trust-on-first-use bar the priorIdentity branch already applies, or
    //   - the caller authenticated to the row with its member key this join.
    //
    // Anything else is refused. In particular a caller CANNOT staple its anchor
    // onto a row protected by someone else's key/auth/anchor — that is exactly
    // the cross-agent takeover this guard exists to stop, and it would be a
    // *permanent* one, since the anchor never rotates.
    let bindAgentAnchor = false;
    // Reset per attempt: casRoom may re-run this mutator on a CAS retry, and a
    // stale audit from a losing attempt must not survive into the winning one.
    anchorAudit = undefined;
    if (agentIdHash && reclaim) {
      const rowAnchor = reclaim.agentIdHash;
      // Did the caller actually prove the member key for THIS row on THIS join?
      const provedWithKey =
        reclaimMemberKeyHash !== undefined && reclaim.memberKeyHash === reclaimMemberKeyHash;

      if (rowAnchor === agentIdHash) {
        bindAgentAnchor = true;
        // Anchor matched, and the caller could NOT present the row's key while
        // the row IS key-protected → the key is lost and the anchor alone
        // brought them home. This is the credential-loss recovery: audit it.
        if (reclaim.memberKeyHash && !provedWithKey) {
          anchorAudit = {
            outcome: 'anchor_recovery',
            name: reclaim.name,
            client: reclaim.client,
            reclaimedProtectedRow: true,
          };
        }
      } else if (rowAnchor !== undefined) {
        throw new AgentAnchorConflictError(reclaim.name);
      } else {
        const unprotected = !reclaim.memberKeyHash && !reclaim.authIdHash;
        if (unprotected || provedWithKey) {
          bindAgentAnchor = true;
          anchorAudit = {
            outcome: 'anchor_bound',
            name: reclaim.name,
            client: reclaim.client,
            reclaimedProtectedRow: Boolean(reclaim.memberKeyHash),
          };
        } else throw new AgentAnchorConflictError(reclaim.name);
      }
    } else if (agentIdHash && !reclaim) {
      // T-32: when a sibling row already carries this anchor (the live-row
      // guard above declined to reclaim it), the new row stays UNANCHORED —
      // two rows sharing one anchor would make every future recovery lookup
      // ambiguous, and the sibling keeps its recovery rights. A genuinely new
      // anchor still binds.
      bindAgentAnchor = !current.participants.some(p => p.agentIdHash === agentIdHash);
    }

    // Never trust a client-supplied hash on the incoming participant row.
    let next = { ...participant, memberKeyHash: undefined as string | undefined };
    const isClaimingHost = participant.name === current.createdBy;

    if (isClaimingHost) {
      // The host slot is gated by hostKey, but the verification is async
      // (crypto.subtle.digest) so it can't run inside this synchronous
      // mutator. Callers MUST call verifyHostKey() first when they intend
      // to claim the host name; that pre-flight throws HostNameTakenError
      // if the key is wrong. Reaching this branch means the caller has
      // already proven they own the host slot.
    } else {
      // Non-host name collision: names are room-visible labels, so keep
      // them unique across client kinds too (web Robin vs agent Robin). The
      // reclaimed row is excluded from the collision set so updating your own
      // row never suffixes you against yourself.
      next = { ...next, name: uniqueNameForRoom(participant.name, current, reclaim) };
    }

    next = {
      ...next,
      color: uniqueColorForRoom(next.color, current, reclaim),
      // T-49: identity continuity follows the session credential. Reclaiming the
      // same row (proved by anchor / member key / verified identity) KEEPS its
      // lineage, so a reconnect revives the cards that session posted. A genuinely
      // new identity mints a fresh one, so a replacement session cannot inherit
      // them by taking the same display name. Never accepted from the client.
      // A CREDENTIAL-proved tombstone outranks the reclaimed row's own value: a
      // reclaim can land on a row this session never posted from (an unprotected row
      // matched by name), and adopting that row's lineage would hand this session
      // someone else's cards while leaving its own dead.
      lineageId: restoredLineage ?? reclaim?.lineageId ?? newLineageId(),
    };

    // Default canSpeak: TRUE for everyone (host, agents, walk-ins). The
    // earlier "host approves new joiners" gate added too much friction —
    // someone joining a fast-moving conversation had to wait for the host
    // to notice and click ✓ before they could even ack a message. Robin's
    // new framing: "进入都自动允许发言 但是只有主持人才可以关闭某个参会
    // 的 agent 或着 web 的发言也就是静音". Same Slack/Zoom mental model.
    //
    // Once joined, the host can mute (canSpeak → false) any participant
    // via setMuted(); muted participants stay in the room (presence intact,
    // can read) but room_send is rejected by appendMessage's findSpeaker
    // gate. Unmute is just setMuted(..., false) flipping it back.
    if (next.canSpeak === undefined) {
      next = { ...next, canSpeak: true };
    }
    // T-30/T-25: stamp the identity anchors on the stored row.
    //  - memberKeyHash: the freshly issued key's hash when issuing; otherwise
    //    PRESERVE the reclaimed row's existing hash. A keyless refresh must not
    //    silently strip an agent's credential binding (the old code cleared it,
    //    which let a bare re-join drop a keyed row's protection).
    //  - authIdHash: stamp the server-verified value when the caller is an
    //    authenticated web user; otherwise preserve any existing anchor on the
    //    reclaimed row. Only ever a server-verified value — never client input.
    //  - agentIdHash (T-66): stamp the durable agent anchor when this join is
    //    allowed to bind it (see bindAgentAnchor above); otherwise PRESERVE the
    //    reclaimed row's existing anchor. Never taken from client input on a web
    //    row — the server only ever passes `agentId` for a trusted local 'cc'
    //    caller. Preserving-on-refresh matters as much as it does for
    //    memberKeyHash: a keyless re-join must not strip the very anchor that
    //    makes the row recoverable.
    next = {
      ...next,
      memberKeyHash: memberKeyHash ?? reclaim?.memberKeyHash,
      authIdHash: authIdHash ?? reclaim?.authIdHash,
      agentIdHash: bindAgentAnchor ? agentIdHash : reclaim?.agentIdHash,
    };
    // Assigned AFTER the canSpeak materialization so the returned
    // `outParticipant` reflects the final stored row, including its
    // approval state (callers like the MCP room_join handler look at this
    // to tell the agent whether it can speak immediately).
    outParticipant = next;

    // Drop the reclaimed row (updated in place) and any exact (name, client)
    // duplicate of the final row, then append the fresh row. This keeps
    // (re)joins idempotent and lets a reclaim collapse a stale duplicate
    // that happens to sit on the final name.
    const keep = current.participants.filter(p => {
      if (reclaim && p === reclaim) return false;
      return !(p.name === next.name && p.client === next.client);
    });

    // T-32 provenance. Reset per CAS retry like anchorAudit.
    displaced = [];
    removalNotice = undefined;
    const now = Date.now();
    const removals: Record<string, RemovalRecord> = { ...current.lastRemovals };

    // Pop this identity's pending removal notice. Try the DESIRED name first —
    // a displaced session rejoining while its old name is retaken lands on a
    // "(2)" suffix, but its notice was stamped under the original name. A
    // record bound to an anchor is popped ONLY by a joiner presenting that
    // anchor: a stranger squatting on the name cannot read someone else's
    // removal record. The handed-out notice never includes the hash.
    for (const key of [removalKey(participant.name, participant.client), removalKey(next.name, next.client)]) {
      const entry = removals[key];
      if (entry && (!entry.anchorHash || entry.anchorHash === agentIdHash)) {
        const { anchorHash: _serverOnly, ...safe } = entry;
        removalNotice = { ...safe, name: key.split('\n')[0]! };
        delete removals[key];
        break;
      }
    }

    // Any LIVE row this join dropped was a session displaced mid-flight, not
    // idle cleanup: record the mechanism so the server can announce it and the
    // displaced session finds the provenance when it comes back.
    for (const p of current.participants) {
      const droppedByDedup = !(reclaim && p === reclaim)
        && p.name === next.name && p.client === next.client;
      const keyRotatedAway = Boolean(
        reclaim && p === reclaim && anchorAudit?.outcome === 'anchor_recovery',
      );
      if ((droppedByDedup || keyRotatedAway) && rowIsLive(p, now)) {
        const mechanism = keyRotatedAway ? 'anchor_recovery' as const : 'join_displacement' as const;
        displaced.push({ name: p.name, client: p.client, mechanism });
        removals[removalKey(p.name, p.client)] = {
          mechanism,
          byName: next.name,
          at: now,
          ...(p.agentIdHash ? { anchorHash: p.agentIdHash } : {}),
        };
      }
    }

    return {
      ...current,
      participants: [...keep, next],
      ...(Object.keys(removals).length > 0 || current.lastRemovals ? { lastRemovals: removals } : {}),
    };
  });

  return { ...room, participant: outParticipant, memberKey, anchorAudit, displaced, removalNotice };
}

// Pre-flight check used by callers that intend to join with the host's name.
// Returns the verified room or throws HostNameTakenError. After this check,
// callers proceed to joinRoom() which trusts that the host claim was
// validated. Splitting verify+write avoids putting async crypto work inside
// the synchronous CAS mutator above.
export async function verifyHostKey(
  client: UpstashClient,
  code: string,
  hostKey: string | undefined,
  opts?: { allowLegacyNoHash?: boolean; authId?: string },
): Promise<void> {
  const room = await getRoom(client, code);
  // T-69: the host key is browser-local, so it cannot identify the same host
  // on another device. Accept the server-verified authenticated identity that
  // created the room. For rooms created before hostAuthIdHash existed, the
  // host participant's existing authIdHash is equally strong evidence: it was
  // stamped only from a verified Access caller after a valid host-key join.
  if (opts?.authId) {
    const authIdHash = await sha256Hex(opts.authId);
    const matchesRoomAnchor = room.hostAuthIdHash === authIdHash;
    const matchesLegacyHostRow = room.participants.some(
      p => p.name === room.createdBy && p.client === 'web' && p.authIdHash === authIdHash,
    );
    if (matchesRoomAnchor || matchesLegacyHostRow) return;
  }
  // T-30 (F1): a room with no stored hash used to auto-pass ANY claim — the
  // legacy bypass that made host authority a name assertion. Now it FAILS
  // CLOSED. `allowLegacyNoHash` (server sets it only from the
  // ALLOW_LEGACY_NAME_AUTH migration flag) is the sole, explicit escape, and
  // the server logs a security event when it is taken.
  if (!room.hostKeyHash) {
    if (opts?.allowLegacyNoHash) return;
    throw new HostNameTakenError(room.createdBy);
  }
  if (!hostKey) throw new HostNameTakenError(room.createdBy);
  const hash = await sha256Hex(hostKey);
  if (hash !== room.hostKeyHash) throw new HostNameTakenError(room.createdBy);
}

// Mute or unmute a participant. Host-only. Mute flips `canSpeak` to false
// and the next room_send by that participant returns a MutedError;
// presence (visibility, ability to read) is unaffected. Unmute flips back
// to true. Idempotent — calling with the same value bumps version but is
// a no-op for the participant row.
export async function setMuted(
  client: UpstashClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: 'web' | 'cc',
  muted: boolean,
): Promise<Room> {
  return casRoom(client, code, (current) => {
    if (current.createdBy !== requesterName) {
      throw new NotHostError(requesterName, current.createdBy);
    }
    return {
      ...current,
      participants: current.participants.map(p =>
        (p.name === targetName && p.client === targetClient)
          ? { ...p, canSpeak: !muted }
          : p,
      ),
    };
  });
}

/**
 * @deprecated Use `setMuted(..., false)`. Kept as a thin alias so older
 * callers still compile while we migrate the web UI to the mute toggle.
 */
export function approveParticipant(
  client: UpstashClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: 'web' | 'cc',
): Promise<Room> {
  return setMuted(client, code, requesterName, targetName, targetClient, false);
}

// Server-side check: is this (name, client) tuple a participant who's been
// approved to speak? Returns the participant on success, null on miss.
// Treats `canSpeak === undefined` as approved (legacy rooms without the
// field). All new joiners flow through joinRoom which always sets the
// field, so undefined only appears for participants from before this code
// landed.
export function findSpeaker(
  room: Room,
  name: string,
  clientKind: 'web' | 'cc',
): Participant | null {
  const p = room.participants.find(x => x.name === name && x.client === clientKind);
  if (!p) return null;
  if (p.canSpeak === false) return null;
  return p;
}

// Set or clear reply-mode coordination on a room. Host-only. Switching
// modes mid-conversation is supported; any in-flight turn state is cleared.
//
// Validates that the right fields are present for the requested mode:
//   - 'open':       config can be empty / undefined
//   - 'sequential': leadAgentName + leadAgentClient required IF caller wants
//                   a non-default Lead; otherwise the room falls back to
//                   "first cc-client agent in join order" at turn time.
//                   Callers are encouraged to specify, but it's not enforced
//                   here so UI can offer a "start sequential with first agent
//                   as Lead" shortcut without forcing a selection.
//   - 'moderator':  moderatorAgentName + moderatorAgentClient REQUIRED —
//                   moderator mode is meaningless without a routing agent.
export class InvalidModeConfigError extends Error {
  constructor(mode: ReplyMode, missingField: string) {
    super(`replyMode='${mode}' requires modeConfig.${missingField}.`);
    this.name = 'InvalidModeConfigError';
  }
}

export async function setReplyMode(
  client: UpstashClient,
  code: string,
  requesterName: string,
  mode: ReplyMode,
  config: ReplyModeConfig | undefined,
): Promise<Room> {
  const updated = await casRoom(client, code, (current) => {
    if (current.createdBy !== requesterName) {
      throw new NotHostError(requesterName, current.createdBy);
    }
    if (mode === 'moderator') {
      if (!config?.moderatorAgentName || !config?.moderatorAgentClient) {
        throw new InvalidModeConfigError('moderator', 'moderatorAgentName + moderatorAgentClient');
      }
    }
    if (config?.leadGraceMs !== undefined) {
      const leadDeadline = config.timeoutMs?.lead ?? DEFAULT_TURN_TIMEOUTS_MS.lead;
      if (
        !Number.isFinite(config.leadGraceMs)
        || config.leadGraceMs < 0
        || config.leadGraceMs > leadDeadline
      ) {
        throw new InvalidModeConfigError(
          mode,
          `leadGraceMs (must be a finite number in [0, ${leadDeadline}])`,
        );
      }
    }
    // Persist normalized config. For 'open' we still keep whatever the
    // caller passed (e.g. timeoutMs they pre-configured before switching
    // away from sequential) so a later switch back doesn't lose settings.
    return {
      ...current,
      replyMode: mode,
      modeConfig: config,
    };
  });
  // Any mode change aborts an in-flight turn. We do this as a best-effort
  // sibling write (not atomic with the room CAS) — the only failure mode
  // is "old turnState lingers", which the next human message will
  // overwrite via newSequentialTurn / moderator startup anyway. Keeping
  // it out of the CAS mutator avoids cyclic imports and keeps the room
  // module unaware of turnState internals.
  await client.command(['DEL', `turn-state:${code}`]);
  return updated;
}

/**
 * Thrown by `appendMessage` when the sender is not allowed to speak under
 * the current reply-mode turn state. Slice A never throws this; Slice B
 * begins throwing it in 'sequential' / 'moderator' rooms.
 */
export class NotYourTurnError extends Error {
  constructor(name: string, mode: ReplyMode) {
    super(`"${name}" is not allowed to speak right now (reply mode: ${mode}).`);
    this.name = 'NotYourTurnError';
  }
}

/**
 * Thrown by `appendMessage` when the sender's `canSpeak` is false —
 * either because the host muted them, or (legacy) because they joined a
 * pre-mute-model room that still defaulted non-host to false.
 */
export class MutedError extends Error {
  constructor(name: string, host: string) {
    super(`"${name}" has been muted by the host (${host}). Ask the host to unmute (🔊) to keep talking.`);
    this.name = 'MutedError';
  }
}

/** @deprecated Same shape as MutedError, kept for backward compat. */
export const NotApprovedError = MutedError;

/**
 * T-05: thrown by `appendMessage` when the sender joined as a guest viewer.
 * Distinct from MutedError so clients can explain "you chose read-only"
 * rather than "the host silenced you".
 */
export class ViewerError extends Error {
  constructor(name: string) {
    super(`"${name}" joined as a guest viewer — viewers are read-only. Rejoin without viewer mode to participate.`);
    this.name = 'ViewerError';
  }
}

// Remove a participant from the room. Only the host (createdBy) may kick.
// Upstash has no per-call auth so this is a soft guard inside the CAS — anyone
// with the REST token can still bypass it, but no path through the public web
// or MCP UI lets a non-host hit this. Identity is (name, client), same as
// joinRoom.
export class NotHostError extends Error {
  constructor(requester: string, host: string) {
    super(`Only the host (${host}) can remove participants — requester: ${requester}`);
    this.name = 'NotHostError';
  }
}

export async function removeParticipant(
  client: UpstashClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: 'web' | 'cc'
): Promise<Room> {
  // T-49: remember the departing row's lineage against each anchor that could prove
  // ownership of it, BEFORE the row disappears. This write is REQUIRED: if durable
  // continuity cannot be recorded, removal fails and the live row remains rather
  // than silently orphaning every action the session authored.
  const before = await getRoom(client, code);
  const leaving = before.participants.find(p => p.name === targetName && p.client === targetClient);
  if (leaving?.lineageId) {
    for (const anchor of [leaving.agentIdHash, leaving.memberKeyHash, leaving.authIdHash]) {
      if (!anchor) continue;
      await client.command(['SET', lineageTombKey(code, anchor), leaving.lineageId]);
    }
  }
  return casRoom(client, code, (current) => {
    // Self-removal is always allowed — agents that finish their turn or
    // were told to leave call this with requesterName === targetName.
    // Removing someone else still requires the host slot.
    const isSelfRemoval = requesterName === targetName;
    if (!isSelfRemoval && current.createdBy !== requesterName) {
      throw new NotHostError(requesterName, current.createdBy);
    }
    // T-32: a host kick gets provenance the target can read on rejoin.
    // Self-removal is voluntary — no notice. The record is bound to the
    // removed row's anchor when it has one, so only that identity pops it.
    const targetRow = current.participants.find(
      p => p.name === targetName && p.client === targetClient,
    );
    const removals = isSelfRemoval
      ? current.lastRemovals
      : {
          ...current.lastRemovals,
          [removalKey(targetName, targetClient)]: {
            mechanism: 'host_removal' as const,
            byName: requesterName,
            at: Date.now(),
            ...(targetRow?.agentIdHash ? { anchorHash: targetRow.agentIdHash } : {}),
          },
        };
    return {
      ...current,
      participants: current.participants.filter(
        p => !(p.name === targetName && p.client === targetClient)
      ),
      ...(removals ? { lastRemovals: removals } : {}),
    };
  });
}

// Silent no-op if the named participant is not in the room. In practice the
// caller passes its own name from session state, so a miss means the user was
// removed externally — we just skip the heartbeat. version still bumps so
// drift remains visible if it ever matters.
export async function endRoom(
  client: UpstashClient,
  code: string,
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    status: 'ended' as const,
    endedAt: Date.now(),
  }));
}

export async function reactivateRoom(
  client: UpstashClient,
  code: string,
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    status: 'active' as const,
    endedAt: undefined,
  }));
}

// Archive is a reversible hidden flag, orthogonal to status: an archived room
// keeps its active/ended status but drops out of those views into "Archived".
export async function archiveRoom(
  client: UpstashClient,
  code: string,
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    archived: true,
    archivedAt: Date.now(),
  }));
}

export async function unarchiveRoom(
  client: UpstashClient,
  code: string,
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    archived: false,
    archivedAt: undefined,
  }));
}

// Bind (or clear) the room's workspace — the single source of truth that
// summoned agents inherit.
export async function setRoomWorkspace(
  client: UpstashClient,
  code: string,
  workspace: string,
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    workspace: workspace || undefined,
  }));
}

// Set (or clear) the room's template id — host-editable so existing rooms can
// be CONVERTED to a type, not just born with one. Joiners read it from the
// room record; agents get the template brief in their join response.
export async function setRoomTemplate(
  client: UpstashClient,
  code: string,
  templateId: string,
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    templateId: templateId || undefined,
  }));
}

// T-47: persist (or clear) owner-authored presentation guidance. Validation and
// host authorization happen at the server boundary; this store helper only makes
// the room mutation explicit and versioned.
export async function setRoomOutputInstructions(
  client: UpstashClient,
  code: string,
  outputInstructions: string,
  updatedBy: string,
): Promise<Room> {
  const value = outputInstructions || undefined;
  return casRoom(client, code, (current) => ({
    ...current,
    outputInstructions: value,
    outputInstructionsUpdatedAt: value ? Date.now() : undefined,
    outputInstructionsUpdatedBy: value ? updatedBy : undefined,
  }));
}

export async function updatePresence(
  client: UpstashClient,
  code: string,
  name: string,
  at: number
): Promise<void> {
  await casRoom(client, code, (current) => ({
    ...current,
    participants: current.participants.map(p =>
      p.name === name ? { ...p, lastSeenAt: at } : p
    ),
  }));
}

// Stamp how long this participant intends to stay in their current room_listen
// window. Other participants can read this from the room's participant list
// to know who's actively listening vs just present-but-idle.
export async function setListenUntil(
  client: UpstashClient,
  code: string,
  name: string,
  until: number
): Promise<void> {
  // T-20: listenArmedAt is the delivery watermark — arming a listen drains
  // the room up to this instant, so older messages are verifiably in the
  // participant's hands. Stamped here (the one funnel every runtime's listen
  // cycle already goes through), no client change required.
  await casRoom(client, code, (current) => ({
    ...current,
    participants: current.participants.map(p =>
      p.name === name ? { ...p, listenUntil: until, lastSeenAt: Date.now(), listenArmedAt: Date.now() } : p
    ),
  }));
}

// T-04: stamp a declared work window (see Participant.workingUntil). Written
// on room_status pings and task claims so a heads-down agent reads as
// `working` instead of decaying to stale while it runs a long job.
export async function setWorkingUntil(
  client: UpstashClient,
  code: string,
  name: string,
  until: number
): Promise<void> {
  await casRoom(client, code, (current) => ({
    ...current,
    participants: current.participants.map(p =>
      p.name === name ? { ...p, workingUntil: until, workingBy: 'self', lastSeenAt: Date.now() } : p
    ),
  }));
}

// T-36: a work window vouched for by the agent's SUPERVISOR, not the agent.
//
// The summoner can see the harness's pane; when it shows a turn in flight, the
// process is provably alive even though the room has heard nothing. Observed
// live: an agent read `disconnected` to the host for ~40 minutes of continuous
// work, while the summoner vetoed 13 nudges because it could see the terminal
// working. The room was telling the host the opposite of what the machinery knew.
//
// Deliberately does NOT touch lastSeenAt. We have not heard from this
// participant — bumping it would corrupt the "last heard 12m ago" figure the
// host reads, and that number's honesty is the whole point of T-143. Only the
// work window moves, and `workingBy` records that a supervisor vouched for it.
export async function setTerminalWorking(
  client: UpstashClient,
  code: string,
  name: string,
  until: number
): Promise<void> {
  await casRoom(client, code, (current) => ({
    ...current,
    participants: current.participants.map(p =>
      p.name === name ? { ...p, workingUntil: until, workingBy: 'terminal' as const } : p
    ),
  }));
}
