import {
  createClient,
  listMessages,
  getRoom,
  type UpstashEnv,
} from '@agent-room/upstash-client';
import type { Message } from '@agent-room/shared';
import { readState, updateCursor, bumpBlockStreak, resetBlockStreak, removeRoom } from './state.js';

// Stop-hook long-poll: how long the hook holds the turn open looking for new
// room messages before letting the agent stop. Increased from the original
// 8s to a full 30s so the hook + the agent's room_listen window line up —
// without this, an agent that finished a turn without a recent send would
// only get an 8-second window to catch a web user's reply before sleeping.
const POLL_MAX_MS = 30_000;
const POLL_INTERVAL_MS = 1_500;

// How many CONSECUTIVE no-message blocks we issue before letting the agent
// actually stop. Each block runs for up to POLL_MAX_MS, so 12 × 30s = 6 min
// of guaranteed presence after the agent's last meaningful action. The
// streak resets whenever a real message arrives (productive activity is
// not penalized) and on UserPromptSubmit. This is the practical bound on
// how long an idle agent stays "listening" after a quiet stretch.
const MAX_BLOCKS_PER_CYCLE = 12;

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
  lines.push('[agent-room] New messages received while you were idle:');
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

  // User typed something — fresh turn cycle. Reset the block streak so the
  // next Stop hook can block fresh up to MAX_BLOCKS_PER_CYCLE times.
  if (event === 'UserPromptSubmit') {
    try { await resetBlockStreak(); } catch { /* non-essential */ }
  }

  // Cap the autonomous block-continue chain. We DO allow continuing past
  // stop_hook_active=true (so two agents can chat back-and-forth without the
  // user having to retype), but we cap at MAX_BLOCKS_PER_CYCLE to ensure
  // there's always an exit. UserPromptSubmit resets the counter.
  if (event === 'Stop' && input.stop_hook_active === true) {
    const state = await readState();
    if ((state.blockStreak ?? 0) >= MAX_BLOCKS_PER_CYCLE) {
      // Reached the cap — let Claude actually stop. Future user input
      // resets the counter via the UserPromptSubmit branch above.
      try { await resetBlockStreak(); } catch { /* non-essential */ }
      process.exit(0);
    }
  }

  let pending: PendingRoom[];
  try {
    pending = await fetchPending(env);
  } catch {
    process.exit(0);
  }

  let withMessages = pending.filter((r) => r.messages.length > 0);
  await commitCursors(pending); // advance cursors even when only own-messages were skipped

  // Long-poll fallback (Fix A): on Stop, if there's any active room at all,
  // hold the turn open and watch for incoming messages. This used to fire
  // ONLY when the agent had recently sent a message, leaving a death zone
  // where a passively-listening agent would sleep instantly the moment its
  // turn ended — and any later web user reply would be missed.
  if (withMessages.length === 0 && event === 'Stop') {
    const state = await readState();
    const hasActiveRoom = Object.keys(state.rooms).length > 0;
    if (hasActiveRoom) {
      const deadline = Date.now() + POLL_MAX_MS;
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

  // Fix A continued: if we got messages, deliver them and RESET the block
  // streak (productive activity isn't penalized — the cap exists to bound
  // pure idle loops, not real conversations).
  if (withMessages.length > 0 && event === 'Stop') {
    try { await resetBlockStreak(); } catch { /* non-essential */ }
    const text = formatMessages(withMessages);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: text }));
    process.exit(0);
  }

  // Fix A + B: still no messages, but there are active rooms. Force the
  // agent to call room_listen again instead of letting it sleep silently.
  // bumpBlockStreak() advances the cap; we already short-circuited on the
  // cap up top (`stop_hook_active && streak >= MAX`), so reaching this
  // branch means we have budget for one more keep-alive nudge.
  if (withMessages.length === 0 && event === 'Stop') {
    let activeRooms: Array<{ code: string; topic: string; selfName: string; cursor: number }> = [];
    try {
      const state = await readState();
      const upstashClient = createClient(env);
      // Best-effort cleanup: drop rooms from local state that are gone
      // server-side (TTL expired) or marked ended, or where this agent is
      // no longer in the participants list. Without this, a left-over
      // entry would keep the Stop hook looping "call room_listen" forever
      // after the meeting closes — Codex caught this in 0.12.0 review.
      for (const [code, r] of Object.entries(state.rooms)) {
        try {
          const room = await getRoom(upstashClient, code);
          const stillIn = room.participants.some(p => p.name === r.name && p.client === 'cc');
          if (room.status !== 'active' || !stillIn) {
            try { await removeRoom(code); } catch { /* non-essential */ }
            continue;
          }
          activeRooms.push({ code, topic: room.topic, selfName: r.name, cursor: r.cursor });
        } catch {
          // Room not found / TTL expired — drop it from state too.
          try { await removeRoom(code); } catch { /* non-essential */ }
        }
      }
    } catch { /* fall through to plain exit */ }

    if (activeRooms.length > 0) {
      try { await bumpBlockStreak(); } catch { /* non-essential */ }
      const lines: string[] = [];
      lines.push('[agent-room] No new messages during the long-poll, but you are still in an active room.');
      lines.push('');
      lines.push('Call room_listen NOW to stay present. Do NOT call any other tool, do NOT "give a status update" — silence is normal during pauses, the conversation may resume any moment.');
      lines.push('');
      for (const r of activeRooms) {
        lines.push(`  • room_listen({ code: "${r.code}", since: ${r.cursor} })  // joined as "${r.selfName}"`);
      }
      lines.push('');
      lines.push('After the listen returns, decide: reply with room_send (and queue another room_listen), or call room_listen again to keep waiting. The only valid reasons to stop are: room ended, you were removed from participants, or the host explicitly said you can leave.');
      process.stdout.write(JSON.stringify({ decision: 'block', reason: lines.join('\n') }));
      process.exit(0);
    }
    process.exit(0);
  }

  if (withMessages.length === 0) {
    process.exit(0);
  }

  const text = formatMessages(withMessages);

  if (event === 'UserPromptSubmit') {
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
