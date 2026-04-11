import type { Message } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS } from '@agent-room/shared';
import type { UpstashClient } from './client.js';

function msgsKey(code: string): string { return `room-msgs:${code}`; }

export async function appendMessage(
  client: UpstashClient,
  code: string,
  message: Message
): Promise<void> {
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
