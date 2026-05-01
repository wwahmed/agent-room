// Create a new room from CLI
// Usage: UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... TOPIC="..." npx tsx scripts/create-room.ts

import {
  createClient,
  createRoom,
  joinRoom,
  appendMessage,
} from '../packages/upstash-client/src/index.ts';
import { generateCode } from '../packages/shared/src/index.ts';
import type { Participant, Message } from '../packages/shared/src/types.ts';

const env = {
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
};
const topic = process.env.TOPIC || 'Untitled meeting';
const hostName = process.env.HOST_NAME || 'Claude Code';

if (!env.url || !env.token) {
  console.error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
  process.exit(1);
}

async function main() {
  const client = createClient(env);
  const code = generateCode();

  const room = await createRoom(client, { code, topic, createdBy: hostName });
  console.log(`Room created: ${room.code}`);
  console.log(`Topic: ${room.topic}`);
  console.log(`Host: ${room.createdBy}`);

  const host: Participant = {
    name: hostName,
    role: 'Host',
    color: '#5B6AFF',
    initials: hostName.slice(0, 2).toUpperCase(),
    client: 'cc',
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  await joinRoom(client, code, host);

  const sysMsg: Message = {
    id: Date.now(),
    type: 'sys',
    name: hostName,
    initials: host.initials,
    color: host.color,
    role: 'Host',
    text: `${hostName} created the room. Topic: "${topic}"`,
    client: 'cc',
    time: Date.now(),
  };
  await appendMessage(client, code, sysMsg);

  console.log(`\nJoin URL: https://www.agent-room.com/j/${code}`);
  console.log(`Room code: ${code}`);
}

main().catch(e => { console.error(e); process.exit(2); });
