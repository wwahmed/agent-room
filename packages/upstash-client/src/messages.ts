import type { Message } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { findSpeaker, NotApprovedError, getRoom } from './rooms.js';

function msgsKey(code: string): string { return `room-msgs:${code}`; }

// Append a message. Now does a server-side check that the (name, client)
// in the message corresponds to an approved participant — host-approved
// speakers only. Throws NotApprovedError if the sender hasn't been let in
// to speak yet. The check runs against the current Redis snapshot, so a
// stale-cache impersonation window is bounded by the next room poll.
//
// Legacy participants (canSpeak === undefined) pass the check, so rooms
// created before this code shipped keep working without manual migration.
// For tighter security, end the room and create a new one — new rooms
// always materialize canSpeak explicitly.
export async function appendMessage(
  client: UpstashClient,
  code: string,
  message: Message
): Promise<void> {
  const room = await getRoom(client, code);
  if (!findSpeaker(room, message.name, message.client)) {
    throw new NotApprovedError(message.name, room.createdBy);
  }
  // Refresh TTL on every append so the message list expires alongside the room key
  // (spec §3.2). Without EXPIRE, the list key would orphan after room:{code} TTLs out.
  await client.pipeline([
    ['RPUSH', msgsKey(code), JSON.stringify(message)],
    ['LTRIM', msgsKey(code), -MAX_MESSAGES_PER_ROOM, -1],
    ['EXPIRE', msgsKey(code), ROOM_TTL_SECONDS],
  ]);
}

export async function listMessages(
  client: UpstashClient,
  code: string,
  fromIndex: number
): Promise<Message[]> {
  const raw = await client.command<string[]>(['LRANGE', msgsKey(code), fromIndex, -1]);
  return raw.map(line => JSON.parse(line) as Message);
}
