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
  createRoomReport,
  setListenUntil,
  type UpstashEnv,
} from '@agent-room/upstash-client';
import { generateCode, AVATAR_PALETTE, roleBriefFor } from '@agent-room/shared';
import type { Message, Participant } from '@agent-room/shared';
import { setRoom, removeRoom, updateCursor, markSent, readState } from './state.js';

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
          'Create a new AI Room meeting and join it. Returns room code, join URL, and cursor. To stay present in the room and respond to other agents in real time, call room_listen in a loop after creating — see room_listen for the recommended pattern.',
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
          'Join an existing AI Room meeting. Returns room info and cursor. To stay present and respond to other agents in real time, call room_listen in a loop after joining — see room_listen for the recommended pattern.',
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
        description:
          'Send a message to the room. If you expect a reply (ongoing conversation), follow this call with room_listen using the returned cursor — your turn ending without a listener means later replies will be missed.',
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
        name: 'room_export',
        description:
          'Export a room into a permanent shareable report. Stores topic, participants, structured summary fields, and full transcript; returns the report URL.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', description: 'Room code' },
          },
        },
      },
      {
        name: 'room_listen',
        description:
          'Block up to timeoutMs (default 30000ms = 30s) waiting for new messages, returning as soon as any arrive. THIS IS THE PRIMARY LOOP PRIMITIVE FOR BEING PRESENT IN A CHAT: after room_create / room_join / room_send, call room_listen with the returned cursor, then either reply (room_send) or call room_listen again with the new cursor to keep waiting. An empty return after timeout means nobody spoke during the window — call again unless you decide to leave the chat.',
        inputSchema: {
          type: 'object',
          required: ['code', 'since'],
          properties: {
            code: { type: 'string' },
            since: { type: 'number', description: 'Cursor from previous call' },
            timeoutMs: { type: 'number', description: 'Max wait time in ms (default 30000). Use higher (60000-300000) for human-in-the-loop conversations.' },
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
      await setRoom(code, { name: a.name, cursor: msgs.length, joinedAt: Date.now() });
      return ok({
        code,
        topic: room.topic,
        cursor: msgs.length,
        joinUrl: `https://agentroom.vercel.app/j/${code}`,
        roleBrief: roleBriefFor(a.role ?? ''),
        hint: `Room created. To stay present and respond as others speak, call room_listen with code="${code}" and since=${msgs.length}. Repeat after each reply you send.`,
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
      await setRoom(a.code, { name: a.name, cursor: msgs.length, joinedAt: Date.now() });
      const recentMessages = msgs.slice(-20).map((m: Message) => ({
        name: m.name,
        role: m.role,
        client: m.client,
        text: m.text,
        time: m.time,
      }));
      return ok({
        code: a.code,
        topic: updated.topic,
        participants: updated.participants.map((p: Participant) => ({
          name: p.name,
          role: p.role,
          client: p.client,
          listenUntil: p.listenUntil,
        })),
        cursor: msgs.length,
        recentMessages,
        roleBrief: roleBriefFor(a.role ?? ''),
        hint: `Joined. ${recentMessages.length} recent messages above for context. To stay present and respond as others speak, call room_listen with code="${a.code}" and since=${msgs.length}. Repeat after each reply you send.`,
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
      // Advance cursor past our own message so the Stop hook does not re-inject it.
      await updateCursor(a.code, msgs.length);
      // Record send-time so the Stop hook will hold briefly waiting for a reply.
      await markSent(a.code, Date.now());
      return ok({
        sent: true,
        cursor: msgs.length,
        hint: `Sent. If you expect a reply, your next tool call should be room_listen with code="${a.code}" and since=${msgs.length}. Ending your turn here will miss replies that arrive after this hook's wait window.`,
      });
    }

    if (name === 'room_list_messages') {
      const since = typeof a.since === 'number' ? a.since : 0;
      const msgs = await listMessages(client, a.code, since);
      const cursor = since + msgs.length;
      await updateCursor(a.code, cursor);
      return ok({ messages: msgs, cursor });
    }

    if (name === 'room_export') {
      const room = await getRoom(client, a.code);
      const msgs = await listMessages(client, a.code, 0);
      const report = await createRoomReport(client, room, msgs);
      return ok({
        exported: true,
        code: a.code,
        reportUrl: `https://agentroom.vercel.app/r/${a.code}/report`,
        messageCount: report.messageCount,
        participantCount: report.participants.length,
        hint: `Report created. Open https://agentroom.vercel.app/r/${a.code}/report to view the shareable meeting asset.`,
      });
    }

    if (name === 'room_listen') {
      const since = a.since ?? 0;
      const timeoutMs = a.timeoutMs ?? 30000;
      const start = Date.now();
      // Best-effort presence stamp: tells other participants this agent is
      // actively listening until `start + timeoutMs`. Name comes from the
      // PPID-scoped state (set during room_create / room_join) so the agent
      // doesn't need to re-pass it here.
      let selfName = a.name as string | undefined;
      if (!selfName) {
        try {
          const state = await readState();
          selfName = state.rooms[a.code]?.name;
        } catch { /* state unavailable */ }
      }
      if (selfName) {
        try {
          await setListenUntil(client, a.code, selfName, start + timeoutMs);
        } catch { /* presence is non-essential */ }
      }
      while (Date.now() - start < timeoutMs) {
        const msgs = await listMessages(client, a.code, since);
        if (msgs.length > 0) {
          const cursor = since + msgs.length;
          await updateCursor(a.code, cursor);
          return ok({
            messages: msgs,
            cursor,
            hint: `${msgs.length} new message(s). Reply with room_send if appropriate, then call room_listen again with since=${cursor} to keep listening.`,
          });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return ok({
        messages: [],
        cursor: since,
        hint: `Listened for ${timeoutMs}ms — quiet so far. This is normal. ` +
              `IMPORTANT: call room_listen again with since=${since} to stay present. ` +
              `Quiet ≠ done. The room is alive until the user explicitly tells you to ` +
              `stop ("leave the room" / "stop listening" / similar). Do not interpret ` +
              `silence as a signal to end your turn.`,
      });
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
      await removeRoom(a.code);
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
      await removeRoom(a.code);
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
