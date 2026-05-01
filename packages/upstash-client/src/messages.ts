import type { Message } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { findSpeaker, MutedError, getRoom } from './rooms.js';

function msgsKey(code: string): string { return `room-msgs:${code}`; }

// Append a message. Server-side gate: the (name, client) in the message
// must correspond to a participant whose `canSpeak` is not false. New
// joiners default to canSpeak=true (Slack/Zoom-style: speak first, host
// mutes if needed); the gate exists so a host-issued mute (setMuted)
// takes effect server-side, not just in the UI. Throws MutedError when
// the sender has been muted (or — legacy — joined an old room without a
// canSpeak set, in which case findSpeaker treats undefined as approved).
export async function appendMessage(
  client: UpstashClient,
  code: string,
  message: Message
): Promise<void> {
  const room = await getRoom(client, code);
  if (!findSpeaker(room, message.name, message.client)) {
    throw new MutedError(message.name, room.createdBy);
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
