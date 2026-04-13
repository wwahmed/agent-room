// Join an existing room as "Bot" from outside the browser, then send a hello.
// Usage: CODE=AWZ-BFH-Q22 npx tsx scripts/join-as-bot.ts

import {
  createClient,
  getRoom,
  joinRoom,
  appendMessage,
  listMessages,
} from '../packages/upstash-client/src/index.ts';
import type { Participant, Message } from '../packages/shared/src/types.ts';

const env = {
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
};
const code = process.env.CODE;
if (!code) { console.error('Set CODE=XXX-XXX-XXX'); process.exit(1); }

async function main() {
  const client = createClient(env);

  const room = await getRoom(client, code!);
  console.log(`→ Joined: "${room.topic}" hosted by ${room.createdBy}`);
  console.log(`  version=${room.version}  participants=${room.participants.map(p => p.name).join(', ') || '(none)'}`);

  const bot: Participant = {
    name: 'Bot',
    role: 'Integration tester',
    color: '#10B981',
    initials: 'BO',
    client: 'cc',
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  const after = await joinRoom(client, code!, bot);
  console.log(`→ Bot joined. new version=${after.version}  participants=${after.participants.map(p => p.name).join(', ')}`);

  const msg: Message = {
    id: Date.now(),
    type: 'msg',
    name: 'Bot',
    initials: 'BO',
    color: '#10B981',
    role: 'Integration tester',
    text: 'hi from node — if you see this on the left in your browser, cross-client sync works 👍',
    client: 'cc',
    time: Date.now(),
  };
  await appendMessage(client, code!, msg);
  console.log(`→ Sent message #${msg.id}`);

  // List everything so we can see the current state
  const all = await listMessages(client, code!, 0);
  console.log(`\n→ Current message stream (${all.length} total):`);
  for (const m of all) {
    console.log(`  [${new Date(m.time).toLocaleTimeString()}] ${m.name}: ${m.text}`);
  }
}

main().catch(e => { console.error(e); process.exit(2); });
