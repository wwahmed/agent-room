import {
  createClient,
  listMessages,
  getRoom,
  type UpstashEnv,
} from '@agent-room/upstash-client';
import type { Message } from '@agent-room/shared';
import { readState, updateCursor } from './state.js';

// If the agent just sent a message in any tracked room, hold the Stop hook
// briefly while polling for a reply. Otherwise the agent's turn ends, the
// agent goes idle, and no future hook event will fire to deliver the reply.
const RECENT_SEND_MS = 30_000;
const POLL_MAX_MS = 8_000;
const POLL_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HookInput {
  hook_event_name?: string;
  stop_hook_active?: boolean;
}

interface PendingRoom {
  code: string;
  topic: string;
  selfName: string;
  newCursor: number;
  messages: Message[];
}

async function fetchPending(env: UpstashEnv): Promise<PendingRoom[]> {
  const state = await readState();
  const codes = Object.keys(state.rooms);
  if (codes.length === 0) return [];

  const client = createClient(env);
  const results: PendingRoom[] = [];

  for (const code of codes) {
    const entry = state.rooms[code]!;
    let msgs: Message[];
    try {
      msgs = await listMessages(client, code, entry.cursor);
    } catch {
      continue;
    }
    if (msgs.length === 0) continue;

    let topic = '';
    try {
      const room = await getRoom(client, code);
      topic = room.topic;
    } catch { /* room may have expired; still surface the messages */ }

    const others = msgs.filter(
      (m) => !(m.client === 'cc' && m.name === entry.name)
    );

    results.push({
      code,
      topic,
      selfName: entry.name,
      newCursor: entry.cursor + msgs.length,
      messages: others,
    });
  }

  return results;
}

function formatMessages(rooms: PendingRoom[]): string {
  const lines: string[] = [];
  lines.push('[ai-room] New messages received while you were idle:');
  lines.push('');
  for (const r of rooms) {
    if (r.messages.length === 0) continue;
    const header = r.topic
      ? `Room ${r.code} ("${r.topic}") — joined as "${r.selfName}":`
      : `Room ${r.code} — joined as "${r.selfName}":`;
    lines.push(header);
    for (const m of r.messages) {
      const role = m.role ? ` (${m.role})` : '';
      lines.push(`  • ${m.name}${role}: ${m.text}`);
    }
    lines.push('');
  }
  lines.push(
    'If a reply would move the discussion forward, call room_send. Otherwise, acknowledge silently — do not reply for the sake of replying.'
  );
  return lines.join('\n');
}

async function commitCursors(rooms: PendingRoom[]): Promise<void> {
  for (const r of rooms) {
    await updateCursor(r.code, r.newCursor);
  }
}

async function readStdin(): Promise<HookInput> {
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (input: HookInput) => {
      if (resolved) return;
      resolved = true;
      resolve(input);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { done(JSON.parse(data) as HookInput); }
      catch { done({}); }
    });
    // If the hook is invoked without piped stdin (e.g. manual test), don't hang.
    setTimeout(() => done({}), 1500);
  });
}

export async function runHook(env: UpstashEnv): Promise<void> {
  const input = await readStdin();
  const event = input.hook_event_name ?? 'Stop';

  // Loop guard: if we already blocked once this Stop cycle, let Claude actually stop.
  if (event === 'Stop' && input.stop_hook_active === true) {
    process.exit(0);
  }

  let pending: PendingRoom[];
  try {
    pending = await fetchPending(env);
  } catch {
    process.exit(0);
  }

  let withMessages = pending.filter((r) => r.messages.length > 0);
  await commitCursors(pending); // advance cursors even when only own-messages were skipped

  // Long-poll fallback: only on Stop, when nothing arrived yet, and the agent
  // sent a message recently (so we're plausibly waiting on a reply).
  if (withMessages.length === 0 && event === 'Stop') {
    const state = await readState();
    const now = Date.now();
    const waiting = Object.values(state.rooms).some(
      (r) => typeof r.lastSentAt === 'number' && now - r.lastSentAt < RECENT_SEND_MS
    );
    if (waiting) {
      const deadline = now + POLL_MAX_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        let p: PendingRoom[];
        try { p = await fetchPending(env); }
        catch { break; }
        const got = p.filter((r) => r.messages.length > 0);
        await commitCursors(p);
        if (got.length > 0) { withMessages = got; break; }
      }
    }
  }

  if (withMessages.length === 0) {
    process.exit(0);
  }

  const text = formatMessages(withMessages);

  if (event === 'Stop') {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: text }));
  } else if (event === 'UserPromptSubmit') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: text,
      },
    }));
  } else if (event === 'SessionStart') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: text,
      },
    }));
  } else {
    process.stdout.write(text);
  }
  process.exit(0);
}
