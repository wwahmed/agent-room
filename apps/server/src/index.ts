// Self-host server for agent-room on a single always-on Mac.
//
// Replaces three pieces of the hosted (Vercel + Upstash) deployment:
//
//   1. `/kv` + `/kv/pipeline` — Upstash-REST-compatible proxy in front of a
//      local Redis. The web client talks this protocol directly from the
//      browser (VITE_UPSTASH_REDIS_REST_URL points here at build time).
//   2. `POST /api/room`      — the room API the `agent-room-mcp` npm package
//      talks to (AGENT_ROOM_BASE_URL). The hosted implementation is not in
//      the public repo; this one dispatches straight onto the exported
//      functions of @agent-room/upstash-client over the same local Redis.
//   3. Static hosting of the built web UI (apps/web/dist) with SPA fallback.
//
// Auth model: the public hostname (chat.wakilabs.dev) is gated by Cloudflare
// Access at the edge; local processes (Claude / Codex MCP servers) reach
// 127.0.0.1 directly. The /kv proxy additionally requires the bearer token
// baked into the web bundle so a mis-scoped tunnel rule can't expose raw
// Redis without it.
//
// Env:
//   PORT            listen port                    (default 8210)
//   REDIS_URL       redis connection string        (default redis://127.0.0.1:6379)
//   KV_TOKEN        bearer token for /kv           (required)
//   WEB_DIST        path to built web UI           (default ../../web/dist relative to this file)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { generateCode, ROOM_TTL_SECONDS } from '@agent-room/shared';
import type { Message, Participant, ReplyMode, ReplyModeConfig } from '@agent-room/shared';
import {
  appendMessage,
  appendSystemMessage,
  createRoom,
  createRoomReport,
  directInvoke,
  endRoom,
  getRoom,
  getTurnState,
  hostSkipCurrent,
  joinRoom,
  listMessages,
  reactivateRoom,
  removeParticipant,
  RoomNotFoundError,
  setListenUntil,
  setReplyMode,
  sweepTimeouts,
  verifyHostKey,
  type UpstashClient,
} from '@agent-room/upstash-client';

const PORT = Number(process.env.PORT || 8210);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const KV_TOKEN = process.env.KV_TOKEN || '';
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(process.env.WEB_DIST || join(HERE, '..', '..', 'web', 'dist'));

if (!KV_TOKEN) {
  console.error('[server] KV_TOKEN is required (bearer token for the /kv proxy)');
  process.exit(1);
}

const redis = new Redis(REDIS_URL);

// ---------- UpstashClient over local Redis (in-process, no HTTP hop) ----------

const client: UpstashClient = {
  async command<T>(cmd: readonly (string | number)[]): Promise<T> {
    const [name, ...args] = cmd;
    return (await redis.call(String(name), ...args.map(String))) as T;
  },
  async pipeline<T>(cmds: readonly (readonly (string | number)[])[]): Promise<T[]> {
    const p = redis.pipeline();
    for (const cmd of cmds) {
      const [name, ...args] = cmd;
      p.call(String(name), ...args.map(String));
    }
    const out = await p.exec();
    if (!out) throw new Error('pipeline aborted');
    return out.map(([err, val]) => {
      if (err) throw err;
      return val as T;
    });
  },
};

// ---------- helpers ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) {
        rej(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => res(data));
    req.on('error', rej);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function statusForError(err: Error): number {
  switch (err.name) {
    case 'RoomNotFoundError':
      return 404;
    case 'HostNameTakenError':
    case 'MutedError':
    case 'NotYourTurnError':
    case 'NotHostError':
      return 403;
    case 'InvalidModeConfigError':
    case 'ModeNotSupportedError':
      return 400;
    default:
      return 500;
  }
}

function sysMessage(text: string, metadata: Record<string, unknown>): Message {
  return {
    id: Date.now(),
    type: 'sys',
    name: 'system',
    initials: '⚙️',
    color: '#6B7280',
    role: '',
    text,
    client: 'cc',
    time: Date.now(),
    metadata,
  } as unknown as Message;
}

// ---------- /kv — Upstash REST-compatible proxy ----------

async function handleKv(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' });
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${KV_TOKEN}`) return sendJson(res, 401, { error: 'unauthorized' });

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' });
  }

  try {
    if (path === '/pipeline') {
      const cmds = body as (string | number)[][];
      if (!Array.isArray(cmds) || cmds.some((c) => !Array.isArray(c))) {
        return sendJson(res, 400, { error: 'pipeline body must be an array of command arrays' });
      }
      // Mirror Upstash pipeline semantics: per-command errors become
      // per-entry `{error}` objects rather than failing the whole batch.
      const p = redis.pipeline();
      for (const cmd of cmds) p.call(String(cmd[0]), ...cmd.slice(1).map(String));
      const out = (await p.exec()) ?? [];
      return sendJson(
        res,
        200,
        out.map(([err, val]) => (err ? { error: String(err.message || err) } : { result: val })),
      );
    }
    const cmd = body as (string | number)[];
    if (!Array.isArray(cmd) || cmd.length === 0) {
      return sendJson(res, 400, { error: 'command body must be a non-empty array' });
    }
    const result = await redis.call(String(cmd[0]), ...cmd.slice(1).map(String));
    return sendJson(res, 200, { result });
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------- /api/room — dispatcher for the agent-room-mcp client ----------

async function requireHost(code: string, requesterName: string | undefined, hostKey: string | undefined): Promise<void> {
  // hostKey is the strong credential. Fall back to name equality for
  // requesters that predate key storage — acceptable in a single-user,
  // Access-gated deployment.
  if (hostKey) {
    await verifyHostKey(client, code, hostKey);
    return;
  }
  const room = await getRoom(client, code);
  if (requesterName && requesterName === room.createdBy) return;
  const err = new Error(`Only the host (${room.createdBy}) can do that.`);
  err.name = 'NotHostError';
  throw err;
}

async function handleRoomAction(payload: Record<string, unknown>): Promise<unknown> {
  const action = String(payload.action || '');
  const code = String(payload.code || '');

  switch (action) {
    case 'create': {
      // Generate a code that isn't in use (createRoom itself overwrites).
      let newCode = '';
      for (let i = 0; i < 8; i++) {
        const candidate = generateCode();
        try {
          await getRoom(client, candidate);
        } catch (err) {
          if (err instanceof RoomNotFoundError || (err as Error).name === 'RoomNotFoundError') {
            newCode = candidate;
            break;
          }
          throw err;
        }
      }
      if (!newCode) throw new Error('could not allocate a room code');
      const created = await createRoom(client, {
        code: newCode,
        topic: String(payload.topic || ''),
        createdBy: String(payload.createdBy || ''),
      });
      const { hostKey, ...room } = created;
      return { room, hostKey };
    }
    case 'get': {
      return { room: await getRoom(client, code) };
    }
    case 'join': {
      const participant = payload.participant as Participant;
      const hostKey = payload.hostKey as string | undefined;
      const priorIdentity = payload.priorIdentity as { name: string; client: 'web' | 'cc' } | undefined;
      const room = await getRoom(client, code);
      if (participant.name === room.createdBy) {
        // Claiming the host slot requires the key (legacy rooms without a
        // hash pass verifyHostKey unconditionally).
        await verifyHostKey(client, code, hostKey);
      }
      const joined = await joinRoom(client, code, participant, { priorIdentity });
      const { participant: outParticipant, ...roomRest } = joined;
      return { room: roomRest, participant: outParticipant };
    }
    case 'messages': {
      return { messages: await listMessages(client, code, Number(payload.cursor || 0)) };
    }
    case 'sweep': {
      const room = await getRoom(client, code);
      const swept = await sweepTimeouts(client, code, room);
      for (const entry of swept.skipped) {
        await appendSystemMessage(
          client,
          code,
          sysMessage(`${entry.name}'s turn timed out — moving on.`, {
            eventType: 'turn_timeout',
            skippedName: entry.name,
            skippedClient: entry.client,
          }),
        );
      }
      return { room: await getRoom(client, code) };
    }
    case 'send': {
      const message = payload.message as Message;
      const kind = (payload.kind as string) || 'message';
      if (!message || typeof (message as { name?: unknown }).name !== 'string' || !(message as { name?: string }).name) {
        // Without a sender name the speaker check can only fail, and the
        // resulting MutedError text ('"undefined" has been muted') sends
        // agents down the wrong path. Name the real problem instead.
        const err = new Error('message.name is required — pass your display name in the room_send call.');
        err.name = 'BadRequestError';
        throw err;
      }
      if (kind === 'status') {
        // Status updates append without touching the turn machinery.
        await getRoom(client, code);
        await appendSystemMessage(client, code, message);
        return { result: { appended: true, metadata: (message as { metadata?: unknown }).metadata ?? {} } };
      }
      return { result: await appendMessage(client, code, message) };
    }
    case 'systemMessage': {
      await appendSystemMessage(client, code, payload.message as Message);
      return {};
    }
    case 'presence': {
      await setListenUntil(client, code, String(payload.name || ''), Number(payload.until || 0));
      return {};
    }
    case 'turnState': {
      return { turnState: await getTurnState(client, code) };
    }
    case 'removeParticipant': {
      return {
        room: await removeParticipant(
          client,
          code,
          String(payload.requesterName || ''),
          String(payload.targetName || ''),
          (payload.targetClient as 'web' | 'cc') || 'cc',
        ),
      };
    }
    case 'end': {
      await requireHost(code, payload.requesterName as string | undefined, payload.hostKey as string | undefined);
      return { room: await endRoom(client, code) };
    }
    case 'reactivate': {
      await requireHost(code, payload.requesterName as string | undefined, payload.hostKey as string | undefined);
      return { room: await reactivateRoom(client, code) };
    }
    case 'createReport': {
      const room = await getRoom(client, code);
      const messages = await listMessages(client, code, 0);
      return { report: await createRoomReport(client, room, messages) };
    }
    case 'setReplyMode': {
      await requireHost(code, payload.requesterName as string | undefined, payload.hostKey as string | undefined);
      const room = await setReplyMode(
        client,
        code,
        String(payload.requesterName || ''),
        payload.mode as ReplyMode,
        payload.config as ReplyModeConfig | undefined,
      );
      return { room };
    }
    case 'directInvoke': {
      await requireHost(code, payload.requesterName as string | undefined, payload.hostKey as string | undefined);
      return {
        added: await directInvoke(
          client,
          code,
          payload.target as { name: string; client: 'web' | 'cc' },
          (payload.source as 'host' | 'moderator') || 'host',
        ),
      };
    }
    case 'skipCurrent': {
      await requireHost(code, payload.requesterName as string | undefined, payload.hostKey as string | undefined);
      const room = await getRoom(client, code);
      const skipped = await hostSkipCurrent(client, code, room);
      if (skipped) {
        await appendSystemMessage(
          client,
          code,
          sysMessage(`${skipped.name} was skipped by the host.`, {
            eventType: 'turn_skipped',
            skippedName: skipped.name,
          }),
        );
      }
      return { skipped };
    }
    case 'taskBoard': {
      await getRoom(client, code);
      return { board: await getTaskBoard(code) };
    }
    case 'taskCreate': {
      await getRoom(client, code);
      const board = await getTaskBoard(code);
      const id =
        typeof payload.id === 'string' && payload.id.trim()
          ? payload.id.trim()
          : `T-${String(board.tasks.length + 1).padStart(2, '0')}`;
      if (board.tasks.some((t) => t.id === id)) {
        throw taskError('BadRequestError', `Task id ${id} already exists on this board.`);
      }
      const task: BoardTask = {
        id,
        title: String(payload.title || '').slice(0, 200),
        state: 'todo',
        createdBy: String(payload.requesterName || ''),
        owner: (payload.owner as string) || undefined,
        ownerClient: (payload.ownerClient as 'web' | 'cc') || undefined,
        verifier: (payload.verifier as string) || undefined,
        verifierClient: (payload.verifierClient as 'web' | 'cc') || undefined,
        dod: (payload.dod as string) || undefined,
        createdAt: nowMs(),
      };
      if (!task.title) throw taskError('BadRequestError', 'title is required');
      if (task.verifier && task.owner && task.verifier === task.owner) {
        throw taskError('BadRequestError', 'verifier must be a different agent than the owner');
      }
      board.tasks.push(task);
      await saveTaskBoard(code, board);
      return { board, task };
    }
    case 'taskClaim': {
      const board = await getTaskBoard(code);
      const task = requireTask(board, String(payload.id || ''));
      if (task.state !== 'todo' && task.state !== 'rejected') {
        throw taskError('BadRequestError', `Task ${task.id} is ${task.state}; only todo/rejected tasks can be claimed.`);
      }
      task.owner = String(payload.name || '');
      task.ownerClient = (payload.client as 'web' | 'cc') || 'cc';
      task.state = 'in_progress';
      task.claimedAt = nowMs();
      await saveTaskBoard(code, board);
      return { board, task };
    }
    case 'taskSubmit': {
      const board = await getTaskBoard(code);
      const task = requireTask(board, String(payload.id || ''));
      const name = String(payload.name || '');
      if (task.owner && task.owner !== name) {
        throw taskError('NotYourTurnError', `Only the owner (@${task.owner}) can submit ${task.id}.`);
      }
      const ev = (payload.evidence || {}) as Record<string, unknown>;
      const missing = ['fileListing', 'fileExcerpt', 'runOutput'].filter(
        (k) => typeof ev[k] !== 'string' || !(ev[k] as string).trim(),
      );
      if (missing.length > 0 || !Number.isFinite(Number(ev.exitCode))) {
        throw taskError(
          'BadRequestError',
          `Submission incomplete: evidence requires fileListing, fileExcerpt, runOutput and numeric exitCode (missing: ${[...missing, ...(Number.isFinite(Number(ev.exitCode)) ? [] : ['exitCode'])].join(', ')}).`,
        );
      }
      task.owner = task.owner || name;
      task.state = 'awaiting_review';
      task.evidence = {
        fileListing: String(ev.fileListing),
        fileExcerpt: String(ev.fileExcerpt),
        runOutput: String(ev.runOutput),
        exitCode: Number(ev.exitCode),
      };
      task.submittedAt = nowMs();
      await saveTaskBoard(code, board);
      return { board, task };
    }
    case 'taskVerify': {
      const board = await getTaskBoard(code);
      const task = requireTask(board, String(payload.id || ''));
      const name = String(payload.name || '');
      const verdict = String(payload.verdict || '');
      if (task.state !== 'awaiting_review') {
        throw taskError('BadRequestError', `Task ${task.id} is ${task.state}; only awaiting_review tasks can be verified.`);
      }
      if (task.owner && task.owner === name) {
        throw taskError('NotHostError', `Self-verification rejected: @${name} owns ${task.id}.`);
      }
      if (task.verifier && task.verifier !== name) {
        throw taskError('NotHostError', `Only the designated verifier (@${task.verifier}) can rule on ${task.id}.`);
      }
      if (verdict !== 'done' && verdict !== 'rejected') {
        throw taskError('BadRequestError', 'verdict must be "done" or "rejected"');
      }
      task.state = verdict;
      task.verdict = verdict;
      task.note = (payload.note as string) || undefined;
      task.verifiedBy = name;
      task.verifiedAt = nowMs();
      await saveTaskBoard(code, board);
      return { board, task };
    }
    default:
      throw new Error(`unknown action: ${action || '(none)'}`);
  }
}

// ---------- task board (npm client >= 0.25 contract; not in the public repo) ----------

interface BoardTask {
  id: string;
  title: string;
  state: 'todo' | 'in_progress' | 'awaiting_review' | 'done' | 'rejected';
  createdBy: string;
  owner?: string;
  ownerClient?: 'web' | 'cc';
  verifier?: string;
  verifierClient?: 'web' | 'cc';
  dod?: string;
  evidence?: { fileListing: string; fileExcerpt: string; runOutput: string; exitCode: number };
  verdict?: 'done' | 'rejected';
  note?: string;
  verifiedBy?: string;
  createdAt?: number;
  claimedAt?: number;
  submittedAt?: number;
  verifiedAt?: number;
}

interface TaskBoard {
  tasks: BoardTask[];
}

function nowMs(): number {
  return Date.now();
}

function taskError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function requireTask(board: TaskBoard, id: string): BoardTask {
  const task = board.tasks.find((t) => t.id === id);
  if (!task) throw taskError('RoomNotFoundError', `Task ${id} not found on this board.`);
  return task;
}

function taskBoardKey(code: string): string {
  return `room-tasks:${code}`;
}

async function getTaskBoard(code: string): Promise<TaskBoard> {
  const raw = await redis.get(taskBoardKey(code));
  if (!raw) return { tasks: [] };
  try {
    const parsed = JSON.parse(raw) as TaskBoard;
    return Array.isArray(parsed.tasks) ? parsed : { tasks: [] };
  } catch {
    return { tasks: [] };
  }
}

async function saveTaskBoard(code: string, board: TaskBoard): Promise<void> {
  await redis.set(taskBoardKey(code), JSON.stringify(board), 'EX', ROOM_TTL_SECONDS);
}

// ---------- static web UI ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

async function handleStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(WEB_DIST, safePath);
  if (!filePath.startsWith(WEB_DIST)) filePath = join(WEB_DIST, 'index.html');
  if (safePath === '/' || safePath === '' || !existsSync(filePath) || extname(filePath) === '') {
    filePath = join(WEB_DIST, 'index.html');
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

// ---------- server ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/kv' || path === '/kv/') return await handleKv(req, res, '/');
    if (path === '/kv/pipeline') return await handleKv(req, res, '/pipeline');

    if (path === '/api/room' && req.method === 'POST') {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
      } catch {
        return sendJson(res, 400, { error: 'BadRequest', message: 'invalid JSON body' });
      }
      try {
        return sendJson(res, 200, await handleRoomAction(payload));
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        // Log rejected actions with enough identity context to diagnose
        // transient CAS/identity races without guessing (text bodies omitted).
        const who = (payload.message as { name?: string; client?: string } | undefined);
        console.warn(
          `[api/room] ${payload.action} rejected: ${e.name} (${e.message}) code=${payload.code ?? ''} name=${who?.name ?? payload.name ?? payload.requesterName ?? ''} client=${who?.client ?? ''}`,
        );
        return sendJson(res, statusForError(e), { error: e.name, message: e.message });
      }
    }

    if (path === '/api/upload' || path === '/api/delete-room-blobs') {
      return sendJson(res, 501, {
        error: 'NotImplemented',
        message: 'Attachments are disabled on this self-hosted deployment.',
      });
    }

    if (path === '/healthz') {
      const pong = await redis.ping();
      return sendJson(res, pong === 'PONG' ? 200 : 500, { ok: pong === 'PONG' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return await handleStatic(res, path);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(`[server] ${req.method} ${path} failed:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] agent-room self-host listening on http://127.0.0.1:${PORT}`);
  console.log(`[server] web dist: ${WEB_DIST}`);
  console.log(`[server] redis: ${REDIS_URL}`);
});
