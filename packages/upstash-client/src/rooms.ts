import type { Room, Participant } from '@agent-room/shared';
import { ROOM_TTL_SECONDS } from '@agent-room/shared';
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

async function sha256Hex(input: string): Promise<string> {
  const cryptoObj: Crypto = (globalThis as unknown as { crypto: Crypto }).crypto;
  const buf = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

export interface CreateRoomInput {
  code: string;
  topic: string;
  createdBy: string;
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
    status: 'active',
    version: 1,
    participants: [],
    hostKeyHash: await sha256Hex(hostKey),
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

// Identity is (name, client). Same name + same client from the same logical
// session is idempotent (browser refresh / agent reconnect just refreshes
// presence). Two important rules layered on top:
//
// 1. Host-name lock: if `participant.name === room.createdBy`, the caller
//    must present the matching `hostKey`. Without it, we throw
//    HostNameTakenError. This is what stops "anyone with the code can
//    impersonate the host".
//
// 2. Non-host name collision: if some OTHER (name, client) tuple already
//    exists in the room and the caller hasn't shown they own the original
//    seat (no shared client identity yet — see Tier B), we auto-suffix
//    "(2)" / "(3)" so two real humans named "Robin" don't displace each
//    other and so no one can squat over an existing participant.
//
// `requesterClaim` is the caller's previous (name, client) tuple if any —
// the web client passes its sessionStorage entry so a refresh on /r/CODE
// still updates the same row instead of getting a "(2)" suffix.
export interface JoinRoomOptions {
  hostKey?: string;
  // Set to the caller's prior identity in the room (from sessionStorage / MCP
  // state). When provided AND it matches an existing participant, that row
  // gets updated in place. Without it, the join is treated as fresh and
  // collisions get suffixed.
  priorIdentity?: { name: string; client: 'web' | 'cc' };
}

// Returns the updated Room with an extra `participant` field showing the
// final, possibly-renamed participant tuple ("Robin (2)" if a name collision
// was suffixed). Existing callers reading `result.participants` etc. still
// work; new callers can read `result.participant.name` to learn what name
// was actually assigned.
export type JoinRoomResult = Room & { participant: Participant };

export async function joinRoom(
  client: UpstashClient,
  code: string,
  participant: Participant,
  options: JoinRoomOptions = {}
): Promise<JoinRoomResult> {
  let outParticipant = participant;
  const room = await casRoom(client, code, (current) => {
    let next = { ...participant };
    const isClaimingHost = participant.name === current.createdBy;

    if (isClaimingHost) {
      // The host slot is gated by hostKey, but the verification is async
      // (crypto.subtle.digest) so it can't run inside this synchronous
      // mutator. Callers MUST call verifyHostKey() first when they intend
      // to claim the host name; that pre-flight throws HostNameTakenError
      // if the key is wrong. Reaching this branch means the caller has
      // already proven they own the host slot.
    } else {
      // Non-host name collision: walk siblings and append "(N)" until unique
      // for this client kind. priorIdentity bypasses the suffix when the
      // caller is updating their own previous row.
      const isMyOwnRow = options.priorIdentity
        && options.priorIdentity.name === participant.name
        && options.priorIdentity.client === participant.client;
      if (!isMyOwnRow) {
        const taken = new Set(
          current.participants
            .filter(p => p.client === participant.client)
            .map(p => p.name),
        );
        if (taken.has(next.name) && next.name !== current.createdBy) {
          let n = 2;
          let candidate = `${participant.name} (${n})`;
          while (taken.has(candidate)) candidate = `${participant.name} (${++n})`;
          next = { ...next, name: candidate };
        }
      }
    }

    outParticipant = next;
    // Default canSpeak: true for the host's own first claim, false for
    // everyone else. Host approval (approveParticipant) flips it to true.
    if (next.canSpeak === undefined) {
      next = { ...next, canSpeak: isClaimingHost };
    }

    // Replace the row matching priorIdentity if given, otherwise replace by
    // the (final) (name, client) tuple. This makes refreshes idempotent
    // without losing earlier presence data.
    const keep = current.participants.filter(p => {
      if (options.priorIdentity
        && p.name === options.priorIdentity.name
        && p.client === options.priorIdentity.client) return false;
      return !(p.name === next.name && p.client === next.client);
    });

    return { ...current, participants: [...keep, next] };
  });

  return { ...room, participant: outParticipant };
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
): Promise<void> {
  const room = await getRoom(client, code);
  // Legacy rooms created before hostKeyHash existed: allow any claim. New
  // rooms (post this change) must always present a key.
  if (!room.hostKeyHash) return;
  if (!hostKey) throw new HostNameTakenError(room.createdBy);
  const hash = await sha256Hex(hostKey);
  if (hash !== room.hostKeyHash) throw new HostNameTakenError(room.createdBy);
}

// Approve a pending participant so they can send messages. Host-only.
// Idempotent: approving an already-approved participant is a no-op (still
// bumps version). Approving the host themselves is also a no-op.
export async function approveParticipant(
  client: UpstashClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: 'web' | 'cc',
): Promise<Room> {
  return casRoom(client, code, (current) => {
    if (current.createdBy !== requesterName) {
      throw new NotHostError(requesterName, current.createdBy);
    }
    return {
      ...current,
      participants: current.participants.map(p =>
        (p.name === targetName && p.client === targetClient)
          ? { ...p, canSpeak: true }
          : p,
      ),
    };
  });
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

export class NotApprovedError extends Error {
  constructor(name: string, host: string) {
    super(`"${name}" hasn't been approved to speak in this room yet — ask the host (${host}) to approve.`);
    this.name = 'NotApprovedError';
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
  return casRoom(client, code, (current) => {
    if (current.createdBy !== requesterName) {
      throw new NotHostError(requesterName, current.createdBy);
    }
    return {
      ...current,
      participants: current.participants.filter(
        p => !(p.name === targetName && p.client === targetClient)
      ),
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
  await casRoom(client, code, (current) => ({
    ...current,
    participants: current.participants.map(p =>
      p.name === name ? { ...p, listenUntil: until, lastSeenAt: Date.now() } : p
    ),
  }));
}
