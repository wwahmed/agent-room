#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8210';
const PRESENCE_STALE_MS = 60_000;
const PRESENCE_DISCONNECTED_MS = 5 * 60_000;

export function classifyPresence(participant, now = Date.now()) {
  if (Number(participant.listenUntil || 0) > now) return 'listening';

  const age = Math.max(0, now - Number(participant.lastSeenAt || 0));
  if (age <= PRESENCE_STALE_MS) return 'online';
  if (age <= PRESENCE_DISCONNECTED_MS) return 'stale';
  return 'disconnected';
}

function usage() {
  return [
    'Usage: npm run room:health -- --code <ROOM-CODE> [options]',
    '',
    'Options:',
    '  --base-url <url>  Room server URL (default http://127.0.0.1:8210)',
    '  --name <name>      Restrict output to one exact participant name',
    '  --json             Emit machine-readable JSON',
    '',
    'The command reads only public room presence fields and never prints member keys,',
    'proxy tokens, session ids, or local agent configuration.',
  ].join('\n');
}

export function parseArgs(argv) {
  const out = { baseUrl: DEFAULT_BASE_URL, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--code') out.code = argv[++i];
    else if (arg === '--base-url') out.baseUrl = argv[++i];
    else if (arg === '--name') out.name = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return out;
}

function ageLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  if (ms < 1_000) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

export function summarizeParticipants(participants, now = Date.now()) {
  return participants.map((participant) => ({
    name: participant.name,
    client: participant.client || 'unknown',
    role: participant.role || '',
    state: classifyPresence(participant, now),
    lastSeenAgo: ageLabel(now - Number(participant.lastSeenAt || 0)),
    listenRemainingMs: Math.max(0, Number(participant.listenUntil || 0) - now),
  }));
}

async function fetchRoom(baseUrl, code) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'get', code }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error || `Room API returned HTTP ${response.status}`);
  }
  if (!body.room || !Array.isArray(body.room.participants)) {
    throw new Error('Room API returned an invalid room payload');
  }
  return body.room;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (!args.code) throw new Error('--code is required');

  const room = await fetchRoom(args.baseUrl, args.code);
  const now = Date.now();
  let rows = summarizeParticipants(room.participants, now);
  if (args.name) rows = rows.filter((row) => row.name === args.name);

  const result = {
    code: room.code,
    status: room.status,
    checkedAt: new Date(now).toISOString(),
    participants: rows,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Room ${result.code} (${result.status})`);
    if (rows.length === 0) console.log('No matching participants.');
    for (const row of rows) {
      const remaining = row.state === 'listening'
        ? `, listen window ${ageLabel(row.listenRemainingMs)} remaining`
        : '';
      console.log(`- ${row.name} [${row.client}]: ${row.state}; last seen ${row.lastSeenAgo} ago${remaining}`);
    }
  }

  if (args.name && rows.length === 0) return 2;
  if (args.name && rows.some((row) => row.state === 'disconnected')) return 3;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(`room-health: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
