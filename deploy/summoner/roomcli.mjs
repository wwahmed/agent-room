// roomcli.mjs — minimal room I/O for a summoned agent's driver.
// Talks to the agent-room server over loopback (trusted `local` caller).
// The memberKey is minted once via `join {wantMemberKey:true}` and persisted
// to a 0600 keyfile; it is injected on send/presence and NEVER printed.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = process.env.ROOM_BASE || 'http://127.0.0.1:8210';

async function api(body) {
  const res = await fetch(`${BASE}/api/room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`room api ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function readKey(keyfile) {
  try { return existsSync(keyfile) ? readFileSync(keyfile, 'utf8').trim() : ''; }
  catch { return ''; }
}
function writeKey(keyfile, key) {
  mkdirSync(dirname(keyfile), { recursive: true });
  writeFileSync(keyfile, key, { mode: 0o600 });
  try { chmodSync(keyfile, 0o600); } catch {}
}

// Join the room, minting (or reclaiming) a memberKey stored at keyfile.
export async function joinMint({ code, name, role, color, keyfile, harness }) {
  const now = Date.now();
  const out = await api({
    action: 'join', code, wantMemberKey: true,
    memberKey: readKey(keyfile) || undefined,
    participant: {
      name, role: role || 'AI Agent', color: color || '#4F46E5',
      initials: name.slice(0, 2).toUpperCase(), client: 'cc',
      // harness = provider, so the app shows the provider's logo as the avatar.
      ...(harness ? { harness } : {}),
      joinedAt: now, lastSeenAt: now,
    },
  });
  if (out.memberKey) writeKey(keyfile, out.memberKey);
  return { participant: out.participant, joined: true };
}

// Fetch messages after `cursor`. Returns the array (may be empty).
export async function messagesSince(code, cursor) {
  const out = await api({ action: 'messages', code, cursor });
  return out.messages || [];
}

// Long-poll for new messages after `cursor` up to `seconds`.
export async function listen(code, cursor, seconds = 240) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const msgs = await messagesSince(code, cursor);
    if (msgs.length) return msgs;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return [];
}

// Send a chat message as this agent (memberKey injected from keyfile).
export async function send({ code, name, text, color, keyfile, kind = 'message' }) {
  const now = Date.now();
  const out = await api({
    action: 'send', code, kind,
    memberKey: readKey(keyfile) || undefined,
    message: {
      id: now, type: 'msg', name, initials: name.slice(0, 2).toUpperCase(),
      color: color || '#4F46E5', role: 'AI Agent', text, client: 'cc', time: now,
    },
  });
  return out.result;
}

// Advertise a listening-presence window so the room shows the agent online.
export async function presence({ code, name, keyfile, until }) {
  try {
    await api({
      action: 'updatePresence', code, name,
      memberKey: readKey(keyfile) || undefined, at: Date.now(),
    });
  } catch {}
  try {
    await api({ action: 'presence', code, name, until: until || (Date.now() + 300000) });
  } catch {}
}

export async function roomStatus(code) {
  try { return await api({ action: 'get', code }); } catch { return null; }
}

// Remove this agent's own participant row (frees the name + clears presence).
export async function leave({ code, name, keyfile }) {
  const key = readKey(keyfile);
  if (!key) return { ok: false, reason: 'no-key' };
  try {
    // Self-removal: requesterName === targetName triggers the member-key auth path.
    await api({
      action: 'removeParticipant', code,
      targetName: name, targetClient: 'cc', requesterName: name, memberKey: key,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e).slice(0, 160) };
  }
}
