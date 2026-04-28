// Unified CLI for room operations from Claude Code
// Usage:
//   npx tsx scripts/room-cmd.ts create --topic "..." [--host "..."]
//   npx tsx scripts/room-cmd.ts join --code XXX-XXX-XXX [--name "..."] [--role "..."]
//   npx tsx scripts/room-cmd.ts send --code XXX-XXX-XXX --text "..." [--name "..."]
//   npx tsx scripts/room-cmd.ts listen --code XXX-XXX-XXX [--cursor N]

import {
  createClient,
  createRoom,
  getRoom,
  joinRoom,
  appendMessage,
  listMessages,
} from '../packages/upstash-client/src/index.ts';
import { generateCode } from '../packages/shared/src/index.ts';
import type { Participant, Message } from '../packages/shared/src/types.ts';

const env = {
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
};
if (!env.url || !env.token) {
  console.error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN');
  process.exit(1);
}

const client = createClient(env);
const args = process.argv.slice(2);
const cmd = args[0];

function flag(name: string): string | undefined {
  const idx = args.indexOf('--' + name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function cmdCreate() {
  const topic = flag('topic') || 'Untitled';
  const host = flag('host') || 'Claude Code';
  const code = generateCode();
  await createRoom(client, { code, topic, createdBy: host });
  const p: Participant = {
    name: host, role: 'Host', color: '#5B6AFF', initials: host.slice(0, 2).toUpperCase(),
    client: 'cc', joinedAt: Date.now(), lastSeenAt: Date.now(),
  };
  await joinRoom(client, code, p);
  // Get current message count for cursor
  const msgs = await listMessages(client, code, 0);
  console.log(JSON.stringify({ action: 'created', code, topic, host, cursor: msgs.length, joinUrl: `https://agentroom.vercel.app/j/${code}` }));
}

async function cmdJoin() {
  const code = flag('code');
  if (!code) { console.error('--code required'); process.exit(1); }
  const name = flag('name') || 'Claude Code';
  const role = flag('role') || 'AI Agent';
  const room = await getRoom(client, code);
  const p: Participant = {
    name, role, color: '#5B6AFF', initials: name.slice(0, 2).toUpperCase(),
    client: 'cc', joinedAt: Date.now(), lastSeenAt: Date.now(),
  };
  await joinRoom(client, code, p);
  const msgs = await listMessages(client, code, 0);
  console.log(JSON.stringify({ action: 'joined', code, topic: room.topic, name, cursor: msgs.length, participants: room.participants.map(pp => pp.name).concat([name]) }));
}

async function cmdSend() {
  const code = flag('code');
  const text = flag('text');
  const name = flag('name') || 'Claude Code';
  if (!code || !text) { console.error('--code and --text required'); process.exit(1); }
  const msg: Message = {
    id: Date.now(), type: 'msg', name, initials: name.slice(0, 2).toUpperCase(),
    color: '#5B6AFF', role: 'AI Agent', text, client: 'cc', time: Date.now(),
  };
  await appendMessage(client, code, msg);
  const msgs = await listMessages(client, code, 0);
  console.log(JSON.stringify({ action: 'sent', code, cursor: msgs.length }));
}

async function cmdListen() {
  const code = flag('code');
  const cursorStart = parseInt(flag('cursor') || '0', 10);
  if (!code) { console.error('--code required'); process.exit(1); }
  const POLL_MS = 2000;
  const MAX_POLLS = 15;
  let cursor = cursorStart;
  for (let i = 0; i < MAX_POLLS; i++) {
    const fresh = await listMessages(client, code, cursor);
    if (fresh.length > 0) {
      const newMsgs = fresh.filter(m => m.client !== 'cc' || m.name !== (flag('name') || 'Claude Code'));
      console.log(JSON.stringify({ action: 'messages', code, cursor: cursor + fresh.length, messages: fresh.map(m => ({ name: m.name, text: m.text, time: m.time, client: m.client })) }));
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  console.log(JSON.stringify({ action: 'no_messages', code, cursor }));
  process.exit(0);
}

async function main() {
  switch (cmd) {
    case 'create': await cmdCreate(); break;
    case 'join': await cmdJoin(); break;
    case 'send': await cmdSend(); break;
    case 'listen': await cmdListen(); break;
    default: console.error('Usage: create|join|send|listen'); process.exit(1);
  }
}
main().catch(e => { console.error(e); process.exit(2); });
