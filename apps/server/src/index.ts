// Self-host server for agent-room on a single always-on Mac.
//
// Replaces three pieces of the hosted (Vercel + Upstash) deployment:
//
//   1. `/kv` + `/kv/pipeline` — Upstash-REST-compatible proxy in front of a
//      local Redis. LOCAL TOOLING ONLY (agents/scripts on this Mac with the
//      bearer token). The browser never speaks this protocol (T-12).
//   2. `POST /api/room`      — the room API for BOTH the `agent-room-mcp`
//      npm package (AGENT_ROOM_BASE_URL) and the web client
//      (apps/web/src/lib/api.ts). The hosted implementation is not in
//      the public repo; this one dispatches straight onto the exported
//      functions of @agent-room/upstash-client over the same local Redis.
//   3. Static hosting of the built web UI (apps/web/dist) with SPA fallback.
//
// Auth model (T-12): the shell is public; every data surface is enforced
// HERE at the origin. Browsers authenticate via a fully validated
// Cloudflare Access JWT (header or CF_Authorization cookie); local
// processes (Claude / Codex MCP servers) reach 127.0.0.1 directly and are
// trusted only when the request did not traverse the Cloudflare edge.
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
import { verifyAccessJwt, allowedEmails } from './access.js';
import { createProjectFromCandidate, getProject, listProjectCandidates, listProjects, loadLedgerBoard, readDoc, syncTaskLedger, validateRegistryAtStartup, type SyncResult } from './projects.js';
import type { Message, Participant, ReplyMode, ReplyModeConfig } from '@agent-room/shared';
import {
  appendMessage,
  appendSystemMessage,
  casRoom,
  createRoom,
  createRoomReport,
  directInvoke,
  endRoom,
  getMessageTotalCount,
  getRoom,
  getRoomReport,
  getTurnState,
  hostSkipCurrent,
  joinRoom,
  listMessages,
  reactivateRoom,
  removeParticipant,
  RoomNotFoundError,
  setListenUntil,
  setMuted,
  setReplyMode,
  sweepTimeouts,
  updatePresence,
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

// ---------- caller identity (T-12) ----------

type Caller = { kind: 'local' } | { kind: 'user'; email: string } | { kind: 'anonymous' };

// Edge-traversing requests carry a signed Access JWT which we fully
// validate (signature/iss/aud/exp) and allowlist-check. Local processes
// (the agents' MCP servers) hit 127.0.0.1 directly and are trusted.
// Anything else is anonymous and gets no data access.
function accessJwtFrom(req: IncomingMessage): string | null {
  const header = req.headers['cf-access-jwt-assertion'];
  if (typeof header === 'string' && header) return header;
  // On Access-bypassed paths the edge does not inject the header, but the
  // domain-wide CF_Authorization cookie carries the same signed JWT.
  const cookies = req.headers.cookie || '';
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookies);
  return m ? m[1] : null;
}

async function resolveCaller(req: IncomingMessage): Promise<Caller> {
  const jwt = accessJwtFrom(req);
  if (typeof jwt === 'string' && jwt) {
    const claims = await verifyAccessJwt(jwt);
    if (claims && allowedEmails().has(claims.email.toLowerCase())) {
      return { kind: 'user', email: claims.email.toLowerCase() };
    }
    return { kind: 'anonymous' };
  }
  // CRITICAL: cloudflared delivers edge traffic from 127.0.0.1 too. Only
  // treat loopback as trusted-local when the request did NOT traverse the
  // edge (no cf-ray/cf-connecting-ip, which Cloudflare always injects and
  // an external caller cannot remove).
  const viaEdge = Boolean(req.headers['cf-ray'] || req.headers['cf-connecting-ip']);
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  if (loopback && !viaEdge) return { kind: 'local' };
  return { kind: 'anonymous' };
}

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
    case 'BadRequestError':
      return 400;
    case 'LedgerConflictError':
      return 409;
    case 'ProjectRegistryError':
      return 503; // registry misconfigured: project features fail closed
    default:
      return 500;
  }
}

// Admin = an Access-authenticated allowlisted user (ADMIN_EMAILS env
// narrows it further if set). Local agents are trusted for room data but
// NOT for the onboarding surface — registering projects is the owner's
// call, made in a browser.
function adminGate(caller: Caller): { status: number; body: unknown } | null {
  if (caller.kind === 'anonymous') return { status: 401, body: { error: 'Unauthorized', message: 'Sign in required.' } };
  if (caller.kind !== 'user') return { status: 403, body: { error: 'Forbidden', message: 'Project onboarding is owner-only; use the web app.' } };
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (admins.length > 0 && !admins.includes(caller.email)) {
    return { status: 403, body: { error: 'Forbidden', message: 'Project onboarding is owner-only.' } };
  }
  return null;
}

// Registry problems are logged in full server-side; browsers get a
// generic message so absolute host paths never leak (Codex round-3).
function sanitizeProjectError(err: Error): { error: string; message: string } {
  if (err.name === 'ProjectRegistryError') {
    console.error(`[project] ${err.message}`);
    return { error: err.name, message: 'Project registry is misconfigured on the server; check the server log.' };
  }
  return { error: err.name, message: err.message };
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
  // Auth: local tooling ONLY (trusted loopback or the server-side bearer
  // token). Browsers get no raw Redis access at all — even authenticated
  // Access users must go through the typed /api/room surface (T-12). An
  // arbitrary-command proxy is too much power to hand a web session.
  const caller = await resolveCaller(req);
  const auth = req.headers.authorization || '';
  const bearerOk = auth === `Bearer ${KV_TOKEN}`;
  if (caller.kind !== 'local' && !bearerOk) return sendJson(res, 401, { error: 'unauthorized' });

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
      // T-18: optional project binding at create time (the web form makes
      // it required; MCP clients may attach later via attachProject).
      const projectId = String(payload.projectId || '');
      if (projectId) {
        if (!getProject(projectId)) {
          const err = new Error(`Unknown project "${projectId}". Ids come from GET /api/projects.`);
          err.name = 'BadRequestError';
          throw err;
        }
        const withProject = await casRoom(client, newCode, (cur) => ({ ...cur, projectId }));
        return { room: withProject, hostKey };
      }
      return { room, hostKey };
    }
    case 'get': {
      return { room: await getRoom(client, code) };
    }
    case 'verifyHostKey': {
      // Pre-flight for a web client about to claim the host slot. Throws
      // HostNameTakenError (403) on a wrong key; legacy rooms without a
      // hostKeyHash always pass, matching joinRoom's own check.
      await verifyHostKey(client, code, payload.hostKey as string | undefined);
      return { ok: true };
    }
    case 'setMuted': {
      return {
        room: await setMuted(
          client,
          code,
          String(payload.requesterName || ''),
          String(payload.targetName || ''),
          (payload.targetClient as 'web' | 'cc') || 'web',
          Boolean(payload.muted),
        ),
      };
    }
    case 'updatePresence': {
      // Web heartbeat: stamps lastSeenAt on the participant row. Distinct
      // from 'presence' (setListenUntil), which is the agents' listen-window
      // marker.
      await updatePresence(client, code, String(payload.name || ''), Number(payload.at || Date.now()));
      return { ok: true };
    }
    case 'messageCount': {
      // Absolute message counter (survives LTRIM). The web poller anchors
      // its cursor to this so trimmed history can't desync it.
      return { total: await getMessageTotalCount(client, code) };
    }
    case 'getReport': {
      return { report: await getRoomReport(client, code) };
    }
    case 'attachProject': {
      // Host-gated: binding a room to a project decides where its task
      // ledger lands on disk.
      await requireHost(code, payload.requesterName as string | undefined, payload.hostKey as string | undefined);
      const projectId = String(payload.projectId || '');
      if (!getProject(projectId)) {
        const err = new Error(`Unknown project "${projectId}". Ids come from GET /api/projects.`);
        err.name = 'BadRequestError';
        throw err;
      }
      const room = await casRoom(client, code, (cur) => ({ ...cur, projectId }));
      // Resume: an empty board + an existing ledger means a prior room's
      // state outlived Redis — hydrate it so work continues seamlessly.
      const board = await getTaskBoard(code);
      let resumed = 0;
      if (board.tasks.length === 0) {
        const ledger = loadLedgerBoard(projectId);
        if (ledger && ledger.board.tasks.length > 0) {
          await saveTaskBoard(code, ledger.board as unknown as TaskBoard);
          resumed = ledger.board.tasks.length;
        }
      }
      const sync = await syncProjectForRoom(code, Boolean(payload.force));
      return { room, resumed, sync };
    }
    case 'projectSync': {
      const room = await getRoom(client, code);
      if (!room.projectId) {
        const err = new Error('This room is not attached to a project. Use attachProject first.');
        err.name = 'BadRequestError';
        throw err;
      }
      return { sync: await syncProjectForRoom(code, Boolean(payload.force)) };
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
      await commitBoard(code, board);
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
      await commitBoard(code, board);
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
      await commitBoard(code, board);
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
      await commitBoard(code, board);
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

// ---------- project ledger sync (T-18) ----------

/**
 * Serialize the room's live board into the attached project's durable
 * Markdown ledger. Conflict state is derived from the FILE (embedded
 * section hash), so no Redis state is involved and Redis loss cannot
 * silently authorize an overwrite.
 */
async function syncProjectForRoom(code: string, force = false): Promise<SyncResult | { skipped: string }> {
  const room = await getRoom(client, code);
  if (!room.projectId) return { skipped: 'room has no project' };
  const board = await getTaskBoard(code);
  return syncTaskLedger(room.projectId, code, board, force);
}

/**
 * Durable-first board commit: for project-attached rooms the Markdown
 * ledger is written SYNCHRONOUSLY with the post-mutation board BEFORE
 * Redis is updated. A ledger conflict or write error fails the whole
 * mutation with the live board untouched — no silent split-brain. If
 * the Redis write after a successful ledger write fails, the durable
 * side is AHEAD (safe direction); the next successful mutation or
 * projectSync reconverges.
 */
async function commitBoard(code: string, board: TaskBoard): Promise<void> {
  const room = await getRoom(client, code);
  if (room.projectId) {
    const res = syncTaskLedger(room.projectId, code, board, false);
    if (res.conflict) {
      const err = new Error(`Project ledger conflict: ${res.conflict}`);
      err.name = 'LedgerConflictError';
      throw err;
    }
  }
  await saveTaskBoard(code, board);
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
      const roomCaller = await resolveCaller(req);
      if (roomCaller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
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
        return sendJson(res, statusForError(e), sanitizeProjectError(e));
      }
    }

    if (path === '/api/upload' || path === '/api/delete-room-blobs') {
      return sendJson(res, 501, {
        error: 'NotImplemented',
        message: 'Attachments are disabled on this self-hosted deployment.',
      });
    }

    if (path === '/api/me' && req.method === 'GET') {
      // Identity comes from the fully validated Access JWT (signature,
      // issuer, audience, expiry, allowlist) — not the spoofable plain
      // email header. Local/anonymous callers get identity: null.
      const caller = await resolveCaller(req);
      if (caller.kind !== 'user') return sendJson(res, 200, { identity: null });
      const email = caller.email;
      let mapped: { name?: string; role?: string } | undefined;
      try {
        const map = JSON.parse(process.env.IDENTITY_MAP || '{}') as Record<string, { name?: string; role?: string }>;
        mapped = map[email];
      } catch {
        // malformed IDENTITY_MAP falls back to email-derived name
      }
      return sendJson(res, 200, {
        identity: {
          email,
          name: mapped?.name || email.split('@')[0],
          role: mapped?.role || '',
        },
      });
    }

    if (path === '/api/rooms' && req.method === 'GET') {
      const roomsCaller = await resolveCaller(req);
      if (roomsCaller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const keys: string[] = [];
      let scanCursor = '0';
      do {
        const [next, batch] = (await redis.scan(scanCursor, 'MATCH', 'room:???-???-???', 'COUNT', 200)) as [string, string[]];
        scanCursor = next;
        keys.push(...batch);
      } while (scanCursor !== '0');
      const rooms: Array<Record<string, unknown>> = [];
      for (const key of keys) {
        const raw = await redis.get(key);
        if (!raw) continue;
        try {
          const r = JSON.parse(raw) as {
            code: string; topic: string; status: string; createdBy: string; createdAt: number;
            participants?: Array<unknown>;
          };
          rooms.push({
            code: r.code,
            topic: r.topic,
            status: r.status,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
            participants: (r.participants || []).length,
          });
        } catch {
          // skip unparseable rooms
        }
      }
      rooms.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
      return sendJson(res, 200, { rooms });
    }

    // ---------- T-18: project registry (ids + doc roles only, never paths) ----------
    if (path === '/api/projects' && req.method === 'GET') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      try {
        return sendJson(res, 200, { projects: listProjects() });
      } catch (e) {
        const err = e as Error;
        return sendJson(res, statusForError(err), sanitizeProjectError(err));
      }
    }

    if (path === '/api/project/candidates' && req.method === 'GET') {
      // Onboarding surface is ADMIN-ONLY: the Access-authenticated owner
      // (allowlist) — not local agents, not merely-authenticated callers.
      const caller = await resolveCaller(req);
      const gate = adminGate(caller);
      if (gate) return sendJson(res, gate.status, gate.body);
      return sendJson(res, 200, { candidates: listProjectCandidates() });
    }

    if (path === '/api/project/create' && req.method === 'POST') {
      const caller = await resolveCaller(req);
      const gate = adminGate(caller);
      if (gate) return sendJson(res, gate.status, gate.body);
      try {
        const body = JSON.parse(await readBody(req)) as { key?: string; id?: string; name?: string };
        const project = createProjectFromCandidate(String(body.key || ''), body.id, body.name);
        return sendJson(res, 200, { project });
      } catch (e) {
        const err = e as Error;
        if (err.name === 'SyntaxError') return sendJson(res, 400, { error: 'BadRequest', message: 'invalid JSON body' });
        return sendJson(res, statusForError(err), sanitizeProjectError(err));
      }
    }

    if (path === '/api/project/doc' && req.method === 'GET') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const q = new URL(req.url || '/', 'http://x').searchParams;
      try {
        // readDoc resolves the role through the registry with realpath
        // containment; role "tasks" is readable here too but only ever
        // WRITTEN via the room actions.
        return sendJson(res, 200, readDoc(String(q.get('id') || ''), String(q.get('role') || '')));
      } catch (e) {
        const err = e as Error;
        return sendJson(res, statusForError(err), sanitizeProjectError(err));
      }
    }

    if (path === '/api/version' && req.method === 'GET') {
      // The bundle filename hash changes on every web deploy; clients poll
      // this to show the update banner. Read from disk each time (cheap,
      // and always reflects what bin/deploy-web just wrote).
      try {
        const html = await readFile(join(WEB_DIST, 'index.html'), 'utf8');
        const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
        return sendJson(res, 200, { bundle: match?.[1] ?? 'unknown' });
      } catch {
        return sendJson(res, 200, { bundle: 'unknown' });
      }
    }

    if (path === '/login') {
      // The edge protects this path with the Google/Access policy; reaching
      // the origin means login completed. Bounce to the shell, where the
      // CF_Authorization cookie now authenticates every data call.
      res.writeHead(302, { Location: '/' });
      return res.end();
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
  validateRegistryAtStartup();
});
