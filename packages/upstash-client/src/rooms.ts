import type { Room, Participant } from '@agent-room/shared';
import { ROOM_TTL_SECONDS } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { RoomNotFoundError, ConcurrencyError } from './errors.js';

function roomKey(code: string): string { return `room:${code}`; }

export interface CreateRoomInput {
  code: string;
  topic: string;
  createdBy: string;
}

export async function createRoom(client: UpstashClient, input: CreateRoomInput): Promise<Room> {
  const now = Date.now();
  const room: Room = {
    code: input.code,
    topic: input.topic,
    createdAt: now,
    createdBy: input.createdBy,
    status: 'active',
    version: 1,
    participants: [],
  };
  await client.command(['SET', roomKey(input.code), JSON.stringify(room), 'EX', ROOM_TTL_SECONDS]);
  return room;
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

// Name is the participant identity in MVP (spec §14: no user accounts).
// Same name re-joining replaces the prior entry — this makes browser refresh
// idempotent. Two different humans choosing the same name is a known MVP
// collision; acceptable until real accounts land in Phase 2+.
export async function joinRoom(
  client: UpstashClient,
  code: string,
  participant: Participant
): Promise<Room> {
  return casRoom(client, code, (current) => ({
    ...current,
    participants: [
      ...current.participants.filter(p => p.name !== participant.name),
      participant,
    ],
  }));
}

// Silent no-op if the named participant is not in the room. In practice the
// caller passes its own name from session state, so a miss means the user was
// removed externally — we just skip the heartbeat. version still bumps so
// drift remains visible if it ever matters.
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
