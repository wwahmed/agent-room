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
let patched = source;
let changed = false;
const attachmentMarker = 'WAKICHAT_WORD_CODE_ATTACHMENT_PATCH';

const before = `async function uploadAgentAttachment(input, roomCode, deps = {}) {
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(roomCode)) {
    throw new AttachmentUploadError("bad_room_code", \`Malformed room code: \${roomCode}.\`);
  }
  const { bytes } = validateInput(input);`;

const after = `async function uploadAgentAttachment(input, roomCode, deps = {}) {
  // ${attachmentMarker}: keep the pinned 0.25.4 runtime aligned with the shared parser.
  const isLegacyRoomCode = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}){2}$/i.test(roomCode);
  const isWordRoomCode = /^[a-z]{4}-[a-z]{3}-[a-z]{4}$/i.test(roomCode);
  if (!isLegacyRoomCode && !isWordRoomCode) {
    throw new AttachmentUploadError("bad_room_code", \`Malformed room code: \${roomCode}.\`);
  }
  roomCode = isWordRoomCode ? roomCode.toLowerCase() : roomCode.toUpperCase();
  const { bytes } = validateInput(input);`;

if (!patched.includes(attachmentMarker)) {
  const matches = patched.split(before).length - 1;
  if (matches !== 1) {
    throw new Error(`refusing to patch ${file}: expected one 0.25.4 upload validator, found ${matches}`);
  }
  patched = patched.replace(before, after);
  changed = true;
}

// T-29: the published 0.25.4 runtime contains task-board tools that are not in
// the older open-source bundle. Extend that exact runtime in place so active
// agents get the new structured Questions API without losing those closed
// features. Every anchor is exact and single-occurrence; bundle drift fails
// closed instead of producing a partly patched MCP server.
const questionMarker = 'WAKICHAT_OWNER_QUESTIONS_PATCH';
if (!patched.includes(questionMarker)) {
  const apiAnchor = `async function getTaskBoard(client, code) {`;
  const apiInsert = `// ${questionMarker}: structured owner-question API.\nasync function createOwnerQuestion(client, code, name, input) {\n  const body = await client.post({ action: "questionCreate", code, name, ...input });\n  return body.question;\n}\nasync function listOwnerQuestions(client, code, name) {\n  const body = await client.post({ action: "questionList", code, name });\n  return body.questions;\n}\n`;

  const descriptorAnchor = `      {\n        name: "room_task_list",`;
  const descriptorInsert = `      {\n        name: "room_question_create",\n        description: "Ask the room owner a private structured question. mode is single, multiple, or text; choice modes require 2-12 option labels. Use room_question_list to consume the durable answer.",\n        inputSchema: {\n          type: "object",\n          required: ["code", "name", "prompt", "mode"],\n          properties: {\n            code: { type: "string", description: "Room code" },\n            name: { type: "string", description: "Your display name in the room" },\n            prompt: { type: "string", description: "Focused owner question" },\n            context: { type: "string", description: "Optional private decision context" },\n            mode: { type: "string", enum: ["single", "multiple", "text"] },\n            options: { type: "array", minItems: 2, maxItems: 12, items: { type: "string" } }\n          }\n        }\n      },\n      {\n        name: "room_question_list",\n        description: "List private structured owner questions and consume their durable answers.",\n        inputSchema: {\n          type: "object",\n          required: ["code", "name"],\n          properties: {\n            code: { type: "string", description: "Room code" },\n            name: { type: "string", description: "Your display name in the room" }\n          }\n        }\n      },\n`;

  const handlerAnchor = `    if (name === "room_task_list") {`;
  const handlerInsert = `    if (name === "room_question_create") {\n      try {\n        const question = await createOwnerQuestion(client, a.code, a.name, {\n          prompt: a.prompt,\n          context: a.context,\n          mode: a.mode,\n          options: a.options\n        });\n        return ok({ created: true, question, hint: "Question " + question.id + " is waiting in the owner's Questions tab. Use room_question_list to consume the answer." });\n      } catch (e) {\n        return ok({ created: false, error: e.name, hint: e.message });\n      }\n    }\n    if (name === "room_question_list") {\n      try {\n        const questions = await listOwnerQuestions(client, a.code, a.name);\n        return ok({ questions, pending: questions.filter((q) => !q.answer).length, answered: questions.filter((q) => !!q.answer).length });\n      } catch (e) {\n        return ok({ error: e.name, hint: e.message });\n      }\n    }\n`;

  for (const [label, anchor] of [['API', apiAnchor], ['descriptor', descriptorAnchor], ['handler', handlerAnchor]]) {
    const matches = patched.split(anchor).length - 1;
    if (matches !== 1) throw new Error(`refusing to patch ${file}: expected one 0.25.4 question ${label} anchor, found ${matches}`);
  }
  patched = patched
    .replace(apiAnchor, apiInsert + apiAnchor)
    .replace(descriptorAnchor, descriptorInsert + descriptorAnchor)
    .replace(handlerAnchor, handlerInsert + handlerAnchor);
  changed = true;
}

// Product wording changed from a permanent tab to linked artifacts. Keep an
// already-patched runtime upgradeable without weakening the exact code anchors
// above; these are presentation-only, exact replacements.
const wordingUpdates = [
  [
    'Ask the room owner a private structured question. mode is single, multiple, or text; choice modes require 2-12 option labels. Use room_question_list to consume the durable answer.',
    'Create a private structured question artifact linked inline in chat. mode is single, multiple, or text; choice modes require 2-12 option labels. Use room_question_list to consume the durable owner answer.',
  ],
  [
    'Question " + question.id + " is waiting in the owner\'s Questions tab. Use room_question_list to consume the answer.',
    'Question artifact " + question.id + " is linked in chat and waiting for the owner. Use room_question_list to consume the answer.',
  ],
];
for (const [oldText, newText] of wordingUpdates) {
  if (patched.includes(oldText)) {
    patched = patched.replace(oldText, newText);
    changed = true;
  }
}

if (changed) {
  writeFileSync(file, patched, { mode: 0o644 });
  console.log(`Patched WakiChat MCP runtime: ${file}`);
} else {
  console.log(`Already patched: ${file}`);
}
