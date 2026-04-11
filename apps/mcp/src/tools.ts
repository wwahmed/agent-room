import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createClient,
  createRoom,
  getRoom,
  joinRoom,
  appendMessage,
  listMessages,
  type UpstashEnv,
} from '@agent-room/upstash-client';
import { generateCode, AVATAR_PALETTE } from '@agent-room/shared';
import type { Message, Participant } from '@agent-room/shared';

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (parts[0] ?? '??').slice(0, 2).toUpperCase().padEnd(2, '?');
}

function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]!;
}

function ok(value: unknown) {
  return {
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

export function registerTools(server: Server, env: UpstashEnv) {
  const client = createClient(env);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'room_create',
        description: 'Create a new meeting room and return the 9-char code.',
        inputSchema: {
          type: 'object',
          required: ['topic', 'name'],
          properties: {
            topic: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
      {
        name: 'room_join',
        description: 'Join an existing meeting as the named participant.',
        inputSchema: {
          type: 'object',
          required: ['code', 'name'],
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
      {
        name: 'room_send',
        description: 'Send a message to a meeting room as the joined participant.',
        inputSchema: {
          type: 'object',
          required: ['code', 'name', 'text'],
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      {
        name: 'room_list_messages',
        description: 'List messages from a room starting at an index.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string' },
            since: { type: 'number' },
          },
        },
      },
      {
        name: 'room_listen',
        description:
          'Long-poll for new messages. Polls every 2s until a message arrives or timeoutMs elapses.',
        inputSchema: {
          type: 'object',
          required: ['code', 'since'],
          properties: {
            code: { type: 'string' },
            since: { type: 'number' },
            timeoutMs: { type: 'number' },
          },
        },
      },
      {
        name: 'room_minutes',
        description:
          "Return the room's topic, participants and full transcript so the CC agent can summarize it.",
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string' } },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const a = (args ?? {}) as Record<string, any>;

    if (name === 'room_create') {
      const code = generateCode();
      const room = await createRoom(client, { code, topic: a.topic, createdBy: a.name });
      const participant: Participant = {
        name: a.name,
        role: a.role ?? '',
        color: colorForName(a.name),
        initials: initialsFor(a.name),
        client: 'cc',
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      await joinRoom(client, code, participant);
      return ok({ code, topic: room.topic });
    }

    if (name === 'room_join') {
      const participant: Participant = {
        name: a.name,
        role: a.role ?? '',
        color: colorForName(a.name),
        initials: initialsFor(a.name),
        client: 'cc',
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      const updated = await joinRoom(client, a.code, participant);
      return ok({ topic: updated.topic, participants: updated.participants.map((p) => p.name) });
    }

    if (name === 'room_send') {
      const msg: Message = {
        id: Date.now(),
        type: 'msg',
        name: a.name,
        initials: initialsFor(a.name),
        color: colorForName(a.name),
        role: '',
        text: a.text,
        client: 'cc',
        time: Date.now(),
      };
      await appendMessage(client, a.code, msg);
      return ok('sent');
    }

    if (name === 'room_list_messages') {
      const since = typeof a.since === 'number' ? a.since : 0;
      const msgs = await listMessages(client, a.code, since);
      return ok(msgs);
    }

    if (name === 'room_listen') {
      const since = a.since ?? 0;
      const timeoutMs = a.timeoutMs ?? 10000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const msgs = await listMessages(client, a.code, since);
        if (msgs.length > 0) return ok(msgs);
        await new Promise((r) => setTimeout(r, 2000));
      }
      return ok([]);
    }

    if (name === 'room_minutes') {
      const all = await listMessages(client, a.code, 0);
      const room = await getRoom(client, a.code);
      return ok({
        topic: room.topic,
        participants: room.participants.map((p) => p.name),
        transcript: all.map((m) => `${m.name}: ${m.text}`).join('\n'),
      });
    }

    throw new Error(`Unknown tool: ${name}`);
  });
}
