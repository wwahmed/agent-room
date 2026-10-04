#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { runHook } from './hook.js';

// Runtime capability markers — agent-room-mcp-launch.sh greps the built runtime
// for BOTH of these to prefer this reconciled fork build over the registry
// fallback. This build is a strict SUPERSET of what those two patches provided:
// WAKICHAT_WORD_CODE_ATTACHMENT_PATCH (verbatim word-code joins + attachments)
// and WAKICHAT_OWNER_QUESTIONS_PATCH (owner questions) — PLUS the member-key
// passivity fix (wantMemberKey), the merged evidence-gated task board, and
// attachment text-extraction. The env-guarded reference keeps the string in the
// minified bundle (not tree-shaken).
const WAKICHAT_RUNTIME_CAPS = 'WAKICHAT_WORD_CODE_ATTACHMENT_PATCH WAKICHAT_OWNER_QUESTIONS_PATCH WAKICHAT_CLAUDE_REWAKE_PATCH';
if (process.env.WAKICHAT_PRINT_CAPS) process.stderr.write(WAKICHAT_RUNTIME_CAPS + '\n');

// The MCP server talks to the hosted agent-room backend over HTTP
// (`/api/room`) — no database credentials live on the client. The backend
// URL defaults to https://www.agent-room.com and is overridable via
// AGENT_ROOM_BASE_URL for self-hosted deployments.
const sub = process.argv[2];

if (sub === 'hook') {
  await runHook();
} else if (sub === 'init') {
  const { runInit } = await import('./init.js');
  await runInit(process.argv.slice(3));
} else {
  const server = new Server(
    { name: 'agent-room', version: '0.1.0' },
    { capabilities: { tools: {}, logging: {} } }
  );
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
