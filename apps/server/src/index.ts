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
//   ALLOW_LEGACY_NAME_AUTH  T-30 migration bridge  (default off = fully closed)
//                   When on, keyless MCP 0.25.x rows may host/send by name
//                   ONLY when unambiguous; every use logs a [security] event.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { generateRoomCode, canonicalizeCode, ROOM_TTL_SECONDS } from '@agent-room/shared';
import { verifyAccessJwt, allowedEmails } from './access.js';
import { createProjectFromCandidate, getProject, listProjectCandidates, listProjects, loadLedgerBoard, readDoc, syncTaskLedger, validateRegistryAtStartup, type SyncResult } from './projects.js';
import { decideSenderAuth } from './roomauth.js';
import { applyAliasMigration, applyBindingOverride, AliasMigrationError } from './taskmigrate.js';
import { roomActivityAt } from './roomactivity.js';
import type { Message, Participant, ReplyMode, ReplyModeConfig } from '@agent-room/shared';
import {
  appendMessage,
  appendSystemMessage,
  casRoom,
  createRoom,
  createRoomReport,
  directInvoke,
  endRoom,
  generateMemberKey,
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
  sha256Hex,
  sweepTimeouts,
  updatePresence,
  verifyHostKey,
  type UpstashClient,
} from '@agent-room/upstash-client';

const PORT = Number(process.env.PORT || 8210);
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const KV_TOKEN = process.env.KV_TOKEN || '';
// T-30 migration bridge. Default OFF = fully closed (F1/F2): host actions and
// sends on keyless rows are denied. Set ON in an env that still runs
// credential-unaware MCP 0.25.x clients (they cannot carry a memberKey), so
// their host/send actions keep working via the name path — but ONLY when
// unambiguous, and every use is logged as a security event. Remove once a
// credential-carrying client ships (T-25/T-31).
const ALLOW_LEGACY_NAME_AUTH = /^(1|true|yes|on)$/i.test(process.env.ALLOW_LEGACY_NAME_AUTH || '');
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
    case 'MemberAuthError':
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

// ---------- T-36 host-recovery: double-consent orphaned-host rescue ----------
// (1) The host-machine OPERATOR arms recovery by writing a 0600 ARM_FILE (only
// someone with host filesystem access can). (2) An authenticated allowlisted
// USER presenting their live memberKey makes the recoverHost request. Only then
// does the server mint a fresh hostKey, atomically re-host + run the declared
// alias migration, and return the key in THAT response body (never logged).
// Auto-disarms after one success; a rollback snapshot is written first.
const RECOVERY_DIR = join(homedir(), '.wakichat');
const ARM_FILE = join(RECOVERY_DIR, 'host-recovery.armed');
interface ArmSpec {
  code: string;
  target: { name: string; client: 'web' | 'cc' };
  migrations: { from: string; to: string; toClient?: 'web' | 'cc' }[];
  overrides?: { taskId: string; field: 'owner' | 'verifier'; to: string; toClient?: 'web' | 'cc' }[];
}
function readArmSpec(): ArmSpec | null {
  try {
    if (!existsSync(ARM_FILE)) return null;
    return JSON.parse(readFileSync(ARM_FILE, 'utf8')) as ArmSpec;
  } catch {
    return null;
  }
}
function disarmRecovery(): void {
  try {
    unlinkSync(ARM_FILE);
  } catch {
    /* already gone */
  }
}
function writeRecoveryRollback(code: string, data: unknown): void {
  try {
    mkdirSync(RECOVERY_DIR, { recursive: true, mode: 0o700 });
  } catch {
    /* exists */
  }
  const safe = code.replace(/[^A-Za-z0-9-]/g, '_');
  writeFileSync(join(RECOVERY_DIR, `host-recovery.rollback.${safe}.json`), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
}

function securityEvent(msg: string): void {
  // Distinct prefix so `chat-error.log` greps cleanly for anything that took
  // a relaxed (flag-gated) authentication path.
  console.warn(`[security] ${msg}`);
}

function memberAuthError(message: string): Error {
  const err = new Error(message);
  err.name = 'MemberAuthError';
  return err;
}

// T-30 (F1): host authority now REQUIRES a valid hostKey — the name-equality
// fallback is gone. `verifyHostKey` fails closed on a room with no stored
// hash unless the migration flag is on (in which case the relaxation is
// logged). Applies to end/reactivate/setReplyMode/directInvoke/skipCurrent
// AND (routed here at the server) setMuted/removeParticipant.
async function requireHost(code: string, hostKey: string | undefined): Promise<void> {
  await verifyHostKey(client, code, hostKey, { allowLegacyNoHash: ALLOW_LEGACY_NAME_AUTH });
  if (!hostKey && ALLOW_LEGACY_NAME_AUTH) {
    securityEvent(`host action on ${code} authorized via legacy no-hash path (ALLOW_LEGACY_NAME_AUTH) — no hostKey presented`);
  }
}

// T-30 (F2): authenticate a sender/presence caller against the row it claims.
// A row carrying a memberKeyHash REQUIRES the matching plaintext memberKey —
// a claimed display name never authenticates. A keyless row (credential-
// unaware MCP 0.25.x) is accepted only via the flag-gated legacy path, and
// only when the (name, client) tuple is unambiguous; otherwise it fails
// closed. Never trusts a client-supplied identity beyond what it can prove.
async function authenticateSender(
  code: string,
  name: string,
  clientKind: 'web' | 'cc',
  memberKey: string | undefined,
  caller: Caller,
): Promise<void> {
  const room = await getRoom(client, code);
  const rows = room.participants.filter(p => p.name === name && p.client === clientKind);
  // No row yet: let the downstream speaker gate (findSpeaker → MutedError)
  // produce the not-in-room signal; there is nothing to authenticate against.
  if (rows.length === 0) return;

  const presentedHash = memberKey ? await sha256Hex(memberKey) : undefined;
  const decision = decideSenderAuth(rows, presentedHash, ALLOW_LEGACY_NAME_AUTH);
  if (decision.ok) {
    if (decision.via === 'legacy-name') {
      securityEvent(`send/presence as "${name}" (${clientKind}) on ${code} via legacy name path (ALLOW_LEGACY_NAME_AUTH); caller=${caller.kind}`);
    }
    return;
  }
  switch (decision.reason) {
    case 'need-key':
      throw memberAuthError(`This participant requires its member credential. Rejoin the room to obtain one, then retry.`);
    case 'bad-key':
      throw memberAuthError(`Member credential does not match "${name}". A display name alone cannot authenticate.`);
    case 'ambiguous':
      throw memberAuthError(`"${name}" (${clientKind}) is ambiguous — ${rows.length} rows share it. Rejoin with a distinct name or a member credential.`);
    case 'no-flag':
    default:
      throw memberAuthError(`Sender authentication required for "${name}". Rejoin to obtain a member credential.`);
  }
}

async function handleRoomAction(payload: Record<string, unknown>, caller: Caller): Promise<unknown> {
  const action = String(payload.action || '');
  // T-47: accept a code in either format, any case/separator, and route on its
  // canonical form (legacy → UPPER-dashed, words → lower-dashed). An
  // unparseable value passes through unchanged so it still fails as
  // RoomNotFound rather than being masked. Existing legacy codes canonicalize
  // to themselves, so this is a no-op for every room created before word codes.
  const rawCode = String(payload.code || '');
  const code = canonicalizeCode(rawCode) ?? rawCode;

  switch (action) {
    case 'create': {
      // T-47: generate a human-friendly word code (door-cat-hall) that isn't
      // in use. generateRoomCode skips embarrassing combos; the async loop here
      // owns collision detection against live rooms (redis is async, so it
      // can't run inside the generator's sync isTaken).
      let newCode = '';
      for (let i = 0; i < 8; i++) {
        const candidate = generateRoomCode();
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
      // T-30 (F1): mute/unmute is host-only and now REQUIRES a hostKey. The
      // underlying setMuted still name-checks as defense in depth, so pass
      // the verified host name (createdBy), never the caller's claim.
      await requireHost(code, payload.hostKey as string | undefined);
      const room = await getRoom(client, code);
      return {
        room: await setMuted(
          client,
          code,
          room.createdBy,
          String(payload.targetName || ''),
          (payload.targetClient as 'web' | 'cc') || 'web',
          Boolean(payload.muted),
        ),
      };
    }
    case 'updatePresence': {
      // Web heartbeat: stamps lastSeenAt on the participant row. Distinct
      // from 'presence' (setListenUntil), which is the agents' listen-window
      // marker. T-30 (F2): authenticate the heartbeat like a send so a name
      // alone can't refresh someone else's presence.
      const pName = String(payload.name || '');
      await authenticateSender(code, pName, 'web', payload.memberKey as string | undefined, caller);
      await updatePresence(client, code, pName, Number(payload.at || Date.now()));
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
      await requireHost(code, payload.hostKey as string | undefined);
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
        // T-30 (F1): claiming the host slot requires a valid hostKey; a room
        // with no stored hash fails closed unless the migration flag is on.
        await verifyHostKey(client, code, hostKey, { allowLegacyNoHash: ALLOW_LEGACY_NAME_AUTH });
      }
      // T-30 (F2): credential-aware clients (web) set wantMemberKey and get a
      // one-time member credential minted for their row. MCP 0.25.x never
      // sets it, so its row stays keyless and takes the legacy send path.
      //
      // T-25 identity reclaim anchors:
      //  - reclaimMemberKey: the key the caller already holds (same field it
      //    sends to authenticate). Lets a returning AGENT reclaim its own row
      //    by hash instead of proliferating "(2)", "(3)" … rows.
      //  - authId: the caller's SERVER-VERIFIED Access email, and ONLY that —
      //    set for authenticated web callers only, never from client input. It
      //    is the durable anchor for a HUMAN whose per-tab memberKey is gone in
      //    a fresh tab but whose Access cookie persists. Scoped to web so an
      //    agent row can never be reclaimed via a human's identity.
      const authId =
        caller.kind === 'user' && participant.client === 'web' ? caller.email : undefined;
      const joined = await joinRoom(client, code, participant, {
        priorIdentity,
        issueMemberKey: Boolean(payload.wantMemberKey),
        reclaimMemberKey: payload.memberKey as string | undefined,
        authId,
      });
      const { participant: outParticipant, memberKey, ...roomRest } = joined;
      return { room: roomRest, participant: outParticipant, memberKey };
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
      // T-30 (F2): the sender must prove it owns the row it claims. A member
      // credential (if the row has one) or the flag-gated legacy path — a
      // display name alone never authenticates a send.
      await authenticateSender(
        code,
        String(message.name),
        (message.client as 'web' | 'cc') || 'cc',
        payload.memberKey as string | undefined,
        caller,
      );
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
      const targetName = String(payload.targetName || '');
      const targetClient = (payload.targetClient as 'web' | 'cc') || 'cc';
      const requesterName = String(payload.requesterName || '');
      // T-30 (F1/F2): kicking SOMEONE ELSE is host-only (hostKey required);
      // removing YOURSELF (leave) must prove the row is yours via member
      // credential / legacy path. Either way, a bare name never authorizes.
      let effectiveRequester = requesterName;
      if (requesterName === targetName) {
        await authenticateSender(code, targetName, targetClient, payload.memberKey as string | undefined, caller);
      } else {
        await requireHost(code, payload.hostKey as string | undefined);
        effectiveRequester = (await getRoom(client, code)).createdBy;
      }
      return {
        room: await removeParticipant(
          client,
          code,
          effectiveRequester,
          targetName,
          targetClient,
        ),
      };
    }
    case 'end': {
      await requireHost(code, payload.hostKey as string | undefined);
      return { room: await endRoom(client, code) };
    }
    case 'reactivate': {
      await requireHost(code, payload.hostKey as string | undefined);
      return { room: await reactivateRoom(client, code) };
    }
    case 'createReport': {
      const room = await getRoom(client, code);
      const messages = await listMessages(client, code, 0);
      return { report: await createRoomReport(client, room, messages) };
    }
    case 'setReplyMode': {
      await requireHost(code, payload.hostKey as string | undefined);
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
      await requireHost(code, payload.hostKey as string | undefined);
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
      await requireHost(code, payload.hostKey as string | undefined);
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
    case 'taskReassignAlias': {
      // T-36: host-authorized, audited migration of task owner/verifier
      // bindings from a defunct alias to a current KEYED participant (T-25
      // rename recovery). Fails closed on: missing/wrong host credential
      // (requireHost — strict once ALLOW_LEGACY_NAME_AUTH is off), an absent /
      // ambiguous / non-keyed target, and any owner==verifier collision the
      // remap would create. Atomic: applyAliasMigration validates the whole
      // board before mutating, and we commit once. Historical message
      // attribution (room-msgs) is never touched.
      await requireHost(code, payload.hostKey as string | undefined);
      const from = String(payload.from || '').trim();
      const to = String(payload.to || '').trim();
      const toClient = (payload.toClient as 'web' | 'cc') || 'cc';
      const room = await getRoom(client, code);
      const toRows = room.participants.filter((p) => p.name === to && p.client === toClient);
      if (toRows.length === 0) {
        throw taskError('BadRequestError', `reassign target @${to} (${toClient}) is not a participant in this room`);
      }
      if (toRows.length > 1) {
        throw taskError('BadRequestError', `reassign target @${to} (${toClient}) is ambiguous — ${toRows.length} rows share it`);
      }
      if (!toRows[0].memberKeyHash) {
        throw taskError('MemberAuthError', `reassign target @${to} is not keyed; only a credentialed identity can receive task bindings`);
      }
      const board = await getTaskBoard(code);
      let migrated: string[];
      try {
        migrated = applyAliasMigration(board.tasks, { from, to, toClient });
      } catch (e) {
        const err = e as AliasMigrationError;
        throw taskError(err.name || 'BadRequestError', err.message);
      }
      if (migrated.length === 0) {
        securityEvent(`alias-migration on ${code}: no task bindings matched @${from} (idempotent no-op; host-authorized)`);
        return { board, migrated };
      }
      await commitBoard(code, board);
      securityEvent(`alias-migration on ${code}: @${from} -> @${to} (${toClient}); rewrote ${migrated.join(', ')} (host-authorized)`);
      return { board, migrated };
    }
    case 'recoverHost': {
      // T-36: rescue a room whose host alias is defunct and whose hostKey is
      // unrecoverable. DOUBLE consent — host-operator ARM_FILE (0600) + an
      // authenticated allowlisted USER presenting the armed target's live
      // memberKey. Atomic: snapshot → validate keyed targets → apply alias
      // migration → commit board → mint+reset host authority → disarm. The new
      // hostKey is returned ONLY in this response body (to that browser) and is
      // never logged.
      if (caller.kind !== 'user') {
        throw taskError('NotHostError', 'host recovery requires an authenticated web session');
      }
      const arm = readArmSpec();
      if (!arm || arm.code !== code) {
        throw taskError('NotHostError', 'host recovery is not armed for this room');
      }
      const room = await getRoom(client, code);
      const reqName = arm.target.name;
      const reqClient = arm.target.client || 'web';
      const reqRows = room.participants.filter((p) => p.name === reqName && p.client === reqClient);
      const presentedHash = payload.memberKey ? await sha256Hex(String(payload.memberKey)) : undefined;
      if (reqRows.length !== 1 || !reqRows[0].memberKeyHash || !presentedHash || presentedHash !== reqRows[0].memberKeyHash) {
        throw taskError('MemberAuthError', `host recovery requires @${reqName}'s current member credential`);
      }
      // Snapshot BEFORE any mutation (rollback), then validate + apply every
      // declared migration atomically against keyed targets.
      const board = await getTaskBoard(code);
      writeRecoveryRollback(code, { at: nowMs(), hostKeyHash: room.hostKeyHash ?? null, board });
      const migrated: string[] = [];
      for (const mig of arm.migrations) {
        const toClient = mig.toClient || 'cc';
        const tRows = room.participants.filter((p) => p.name === mig.to && p.client === toClient);
        if (tRows.length !== 1 || !tRows[0].memberKeyHash) {
          throw taskError('MemberAuthError', `migration target @${mig.to} (${toClient}) is not a uniquely keyed participant`);
        }
        try {
          migrated.push(...applyAliasMigration(board.tasks, { from: mig.from, to: mig.to, toClient }));
        } catch (e) {
          const err = e as AliasMigrationError;
          throw taskError(err.name || 'BadRequestError', err.message);
        }
      }
      // Function-based overrides (e.g. one task keeps a different owner than the
      // rest of its old alias). Applied after blanket migrations; each target
      // must be a uniquely keyed participant, and collisions fail closed.
      for (const ov of arm.overrides || []) {
        const toClient = ov.toClient || 'cc';
        const tRows = room.participants.filter((p) => p.name === ov.to && p.client === toClient);
        if (tRows.length !== 1 || !tRows[0].memberKeyHash) {
          throw taskError('MemberAuthError', `override target @${ov.to} (${toClient}) is not a uniquely keyed participant`);
        }
        try {
          migrated.push(applyBindingOverride(board.tasks, { taskId: ov.taskId, field: ov.field, to: ov.to, toClient }));
        } catch (e) {
          const err = e as AliasMigrationError;
          throw taskError(err.name || 'BadRequestError', err.message);
        }
      }
      await commitBoard(code, board);
      const newHostKey = generateMemberKey();
      const newHash = await sha256Hex(newHostKey);
      await casRoom(client, code, (cur) => ({ ...cur, hostKeyHash: newHash }));
      disarmRecovery();
      securityEvent(
        `host-recovery on ${code}: re-hosted to @${reqName} (${caller.email}); migrated ${migrated.join(', ') || '(none)'} (operator-armed + user-authenticated)`,
      );
      return { recovered: true, migrated, hostKey: newHostKey };
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
        return sendJson(res, 200, await handleRoomAction(payload, roomCaller));
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
          // T-35: cheap per-room activity — last message's `time` (tail of the
          // room-msgs list) and the maintained count key. Empty/unreadable
          // rooms fall back to createdAt so a brand-new room still sorts sanely.
          let lastMsgTime: number | undefined;
          try {
            const lastRaw = await redis.lindex(`room-msgs:${r.code}`, -1);
            if (lastRaw) lastMsgTime = Number((JSON.parse(lastRaw) as { time?: number }).time);
          } catch {
            /* no messages / unparseable tail → fall back to createdAt */
          }
          const lastActivityAt = roomActivityAt(Number(r.createdAt), lastMsgTime);
          const cntRaw = await redis.get(`room-msg-count:${r.code}`);
          const messageCount = Number.isFinite(Number(cntRaw)) ? Number(cntRaw) : 0;
          rooms.push({
            code: r.code,
            topic: r.topic,
            status: r.status,
            createdBy: r.createdBy,
            createdAt: r.createdAt,
            participants: (r.participants || []).length,
            lastActivityAt,
            messageCount,
          });
        } catch {
          // skip unparseable rooms
        }
      }
      // Recent-activity-first (Waqas: "surface recent rooms"). Stable tiebreak
      // on createdAt keeps ordering deterministic when activity ties.
      rooms.sort((a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt) || Number(b.createdAt) - Number(a.createdAt));
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
