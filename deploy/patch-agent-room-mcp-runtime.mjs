#!/usr/bin/env node
// Patch the pinned closed MCP runtime until the canonical source fix can be
// published upstream. The replacement is deliberately exact and version-
// bounded: a changed bundle fails closed instead of patching an unknown file.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv[2];
if (!target) throw new Error('usage: patch-agent-room-mcp-runtime.mjs <dist/index.js>');

const file = resolve(target);
const source = readFileSync(file, 'utf8');
const marker = 'WAKICHAT_WORD_CODE_ATTACHMENT_PATCH';
if (source.includes(marker)) {
  console.log(`Already patched: ${file}`);
  process.exit(0);
}

const before = `async function uploadAgentAttachment(input, roomCode, deps = {}) {
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(roomCode)) {
    throw new AttachmentUploadError("bad_room_code", \`Malformed room code: \${roomCode}.\`);
  }
  const { bytes } = validateInput(input);`;

const after = `async function uploadAgentAttachment(input, roomCode, deps = {}) {
  // ${marker}: keep the pinned 0.25.4 runtime aligned with the shared parser.
  const isLegacyRoomCode = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}){2}$/i.test(roomCode);
  const isWordRoomCode = /^[a-z]{4}-[a-z]{3}-[a-z]{4}$/i.test(roomCode);
  if (!isLegacyRoomCode && !isWordRoomCode) {
    throw new AttachmentUploadError("bad_room_code", \`Malformed room code: \${roomCode}.\`);
  }
  roomCode = isWordRoomCode ? roomCode.toLowerCase() : roomCode.toUpperCase();
  const { bytes } = validateInput(input);`;

const matches = source.split(before).length - 1;
if (matches !== 1) {
  throw new Error(`refusing to patch ${file}: expected one 0.25.4 upload validator, found ${matches}`);
}

writeFileSync(file, source.replace(before, after), { mode: 0o644 });
console.log(`Patched word-code attachment support: ${file}`);
