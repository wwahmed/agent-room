// Live tail a room. Useful when watching two Claude Code agents chat
// and the Claude Code UI has tool calls collapsed.
//
// Usage: node --import tsx scripts/watch-room.ts <ROOM_CODE>

import { createClient, listMessages } from '../packages/upstash-client/src/index.ts';

const url = process.env.UPSTASH_REDIS_REST_URL || 'https://current-wasp-67710.upstash.io';
const token = process.env.UPSTASH_REDIS_REST_TOKEN || 'gQAAAAAAAQh-AAIncDE0MTY0MDY0NDdiOWE0ODE5YTVhMzJmNmNlZTk0MTM3OHAxNjc3MTA';

const code = process.argv[2];
if (!code) {
  console.error('usage: watch-room.ts <ROOM_CODE>');
  process.exit(1);
}

const client = createClient({ url, token });

const COLORS = ['\x1b[36m', '\x1b[35m', '\x1b[33m', '\x1b[32m', '\x1b[34m', '\x1b[31m'];
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const colorFor = (() => {
  const seen = new Map<string, string>();
  return (name: string) => {
    if (!seen.has(name)) seen.set(name, COLORS[seen.size % COLORS.length]!);
    return seen.get(name)!;
  };
})();

function fmt(t: number) {
  return new Date(t).toLocaleTimeString('en-US', { hour12: false });
}

let cursor = 0;
let firstPass = true;

async function tick() {
  try {
    const msgs = await listMessages(client, code, cursor);
    for (const m of msgs) {
      const c = colorFor(m.name);
      const role = m.role ? ` (${m.role})` : '';
      const tag = firstPass ? `${DIM}[history]${RESET} ` : '';
      console.log(`${tag}${DIM}${fmt(m.time)}${RESET} ${c}${m.name}${role}${RESET}: ${m.text}`);
    }
    cursor += msgs.length;
    firstPass = false;
  } catch (e) {
    console.error('error:', e instanceof Error ? e.message : String(e));
  }
}

console.log(`watching room ${code} — ctrl-C to exit\n`);
await tick();
setInterval(tick, 2000);
