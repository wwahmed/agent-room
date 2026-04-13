import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  createClient,
  createRoom,
  getRoom,
  joinRoom,
  endRoom,
  reactivateRoom,
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
      { type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

// Active watchers — one per room code
const watchers = new Map<string, { stop: () => void }>();

export function registerTools(server: Server, env: UpstashEnv) {
  const client = createClient(env);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'room_create',
        description:
          'Create a new AI Room meeting and join it. Returns room code, join URL, and cursor for listening. After creating, use CronCreate to poll room_list_messages every minute for real-time monitoring.',
        inputSchema: {
          type: 'object',
          required: ['topic', 'name'],
          properties: {
            topic: { type: 'string', description: 'Meeting topic' },
            name: { type: 'string', description: 'Your display name' },
            role: { type: 'string', description: 'Your role (optional)' },
          },
        },
      },
      {
        name: 'room_join',
        description:
          'Join an existing AI Room meeting. Returns room info and cursor for listening. After joining, use CronCreate to poll room_list_messages every minute for real-time monitoring.',
        inputSchema: {
          type: 'object',
          required: ['code', 'name'],
          properties: {
            code: { type: 'string', description: '9-char room code (e.g. ABC-DEF-GHJ)' },
            name: { type: 'string', description: 'Your display name' },
            role: { type: 'string', description: 'Your role (optional)' },
          },
        },
      },
      {
        name: 'room_send',
        description: 'Send a message to the room.',
        inputSchema: {
          type: 'object',
          required: ['code', 'name', 'text'],
          properties: {
            code: { type: 'string', description: 'Room code' },
            name: { type: 'string', description: 'Your display name' },
            text: { type: 'string', description: 'Message text' },
            role: { type: 'string', description: 'Your role (optional)' },
          },
        },
      },
      {
        name: 'room_list_messages',
        description: 'Get all messages from a room, optionally starting from a cursor.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string' },
            since: { type: 'number', description: 'Cursor index (0 = from beginning)' },
          },
        },
      },
      {
        name: 'room_listen',
        description:
          'Poll for new messages once. Returns new messages and updated cursor. For continuous monitoring, use room_watch instead.',
        inputSchema: {
          type: 'object',
          required: ['code', 'since'],
          properties: {
            code: { type: 'string' },
            since: { type: 'number', description: 'Cursor from previous call' },
            timeoutMs: { type: 'number', description: 'Max wait time in ms (default 30000)' },
          },
        },
      },
      {
        name: 'room_watch',
        description:
          'Start continuous background monitoring of a room. New messages are pushed as logging notifications (works in Cursor/Windsurf). For Claude Code, logging notifications are not surfaced to the model — use CronCreate to poll room_list_messages every minute instead. Only one watcher per room. Returns immediately.',
        inputSchema: {
          type: 'object',
          required: ['code', 'since'],
          properties: {
            code: { type: 'string', description: 'Room code' },
            since: { type: 'number', description: 'Cursor to start watching from' },
            name: { type: 'string', description: 'Your name (to filter out own messages)' },
          },
        },
      },
      {
        name: 'room_unwatch',
        description: 'Stop watching a room.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string' } },
        },
      },
      {
        name: 'room_end',
        description: 'End a meeting. The room becomes read-only but can be reactivated within 24h.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string' } },
        },
      },
      {
        name: 'room_reactivate',
        description: 'Reactivate an ended meeting.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string' } },
        },
      },
      {
        name: 'room_minutes',
        description:
          "Get room topic, participants and full transcript for summarization.",
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
      const msgs = await listMessages(client, code, 0);
      return ok({
        code,
        topic: room.topic,
        cursor: msgs.length,
        joinUrl: `https://ai-room.vercel.app/j/${code}`,
        hint: 'Room created. Call room_watch to start monitoring messages.',
      });
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
      const msgs = await listMessages(client, a.code, 0);
      return ok({
        code: a.code,
        topic: updated.topic,
        participants: updated.participants.map((p: Participant) => p.name),
        cursor: msgs.length,
        hint: 'Joined. Call room_watch to start monitoring messages.',
      });
    }

    if (name === 'room_send') {
      let role: string = a.role ?? '';
      if (!role) {
        try {
          const room = await getRoom(client, a.code);
          role = room.participants.find((p: Participant) => p.name === a.name)?.role ?? '';
        } catch { /* fall through */ }
      }
      const msg: Message = {
        id: Date.now(),
        type: 'msg',
        name: a.name,
        initials: initialsFor(a.name),
        color: colorForName(a.name),
        role,
        text: a.text,
        client: 'cc',
        time: Date.now(),
      };
      await appendMessage(client, a.code, msg);
      const msgs = await listMessages(client, a.code, 0);
      return ok({ sent: true, cursor: msgs.length });
    }

    if (name === 'room_list_messages') {
      const since = typeof a.since === 'number' ? a.since : 0;
      const msgs = await listMessages(client, a.code, since);
      return ok({ messages: msgs, cursor: since + msgs.length });
    }

    if (name === 'room_listen') {
      const since = a.since ?? 0;
      const timeoutMs = a.timeoutMs ?? 30000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const msgs = await listMessages(client, a.code, since);
        if (msgs.length > 0) {
          return ok({ messages: msgs, cursor: since + msgs.length });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return ok({ messages: [], cursor: since });
    }

    if (name === 'room_watch') {
      const code = a.code;
      const selfName = a.name || '';

      // Stop existing watcher for this room
      if (watchers.has(code)) {
        watchers.get(code)!.stop();
      }

      let cursor = a.since ?? 0;
      let running = true;

      const poll = async () => {
        while (running) {
          try {
            const msgs = await listMessages(client, code, cursor);
            if (msgs.length > 0) {
              cursor += msgs.length;
              // Filter out own messages
              const others = msgs.filter((m: Message) => !(m.client === 'cc' && m.name === selfName));
              if (others.length > 0) {
                const summary = others.map((m: Message) => `${m.name}: ${m.text}`).join('\n');
                try {
                  await server.sendLoggingMessage({
                    level: 'info',
                    logger: `room:${code}`,
                    data: JSON.stringify({
                      type: 'new_messages',
                      code,
                      cursor,
                      messages: others.map((m: Message) => ({
                        name: m.name,
                        text: m.text,
                        time: m.time,
                        client: m.client,
                      })),
                      summary,
                    }),
                  });
                } catch { /* client may not support logging */ }
              }
            }
          } catch { /* network error, retry */ }
          await new Promise((r) => setTimeout(r, 2000));
        }
      };

      poll(); // fire and forget

      watchers.set(code, { stop: () => { running = false; } });

      return ok({
        watching: true,
        code,
        cursor,
        hint: 'Background watcher started. Logging notifications will be pushed for clients that support it. For Claude Code, use CronCreate with room_list_messages for reliable polling.',
      });
    }

    if (name === 'room_unwatch') {
      const w = watchers.get(a.code);
      if (w) {
        w.stop();
        watchers.delete(a.code);
        return ok({ stopped: true, code: a.code });
      }
      return ok({ stopped: false, message: 'No active watcher for this room' });
    }

    if (name === 'room_end') {
      await endRoom(client, a.code);
      // Stop watcher if active
      const w = watchers.get(a.code);
      if (w) { w.stop(); watchers.delete(a.code); }
      return ok({ ended: true, code: a.code });
    }

    if (name === 'room_reactivate') {
      await reactivateRoom(client, a.code);
      return ok({ reactivated: true, code: a.code });
    }

    if (name === 'room_minutes') {
      const all = await listMessages(client, a.code, 0);
      const room = await getRoom(client, a.code);
      return ok({
        topic: room.topic,
        participants: room.participants.map((p: Participant) => p.name),
        transcript: all.map((m: Message) => `${m.name}: ${m.text}`).join('\n'),
      });
    }

    throw new Error(`Unknown tool: ${name}`);
  });
}
