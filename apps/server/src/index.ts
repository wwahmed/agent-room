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
//   AGENT_ROOM_PUBLIC_ORIGIN lifecycle discovery origin (default https://chat.wakilabs.dev)
//   WEB_DIST        path to built web UI           (default ../../web/dist relative to this file)
//   ALLOW_LEGACY_NAME_AUTH  T-30 migration bridge  (default off = fully closed)
//                   When on, keyless MCP 0.25.x rows may host/send by name
//                   ONLY when unambiguous; every use logs a [security] event.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { generateRoomCode, canonicalizeCode, normalizeRoomTopic, ROOM_CONVENTIONS, ROOM_TEMPLATES_SHARED, ROOM_TTL_SECONDS, isKnownTemplateId, roomTopicIssue, buildOwnerBrief, briefToSpeech, composeBrief, templateInfo } from '@agent-room/shared';
import type { MessageAttachment } from '@agent-room/shared';
import { parseMultipart } from './multipart.js';
import {
  saveBlob,
  readBlob,
  deleteRoomBlobs,
  isAllowedMime,
  attachmentKind,
  mimeForExt,
  MAX_ATTACHMENT_BYTES,
} from './blobstore.js';
import { verifyAccessJwt, allowedEmails } from './access.js';
import { createProjectFromCandidate, getProject, listProjectCandidates, listProjects, loadLedgerBoard, readDoc, syncTaskLedger, validateRegistryAtStartup, type SyncResult } from './projects.js';
import { decideSenderAuth } from './roomauth.js';
import { applyAliasMigration, applyBindingOverride, AliasMigrationError } from './taskmigrate.js';
import { effectiveVerifier, verifierCollidesWithOwner } from './taskrules.js';
import { transcribeSegment, engineStatus } from './transcribe.js';
import { synthesize } from './tts.js';
import { roomActivityAt } from './roomactivity.js';
import {
  isQaRoom,
  listIndexedRoomPage,
  roomListCursor,
  roomListLimit,
  type RoomIndexEntry,
  type RoomListStore,
} from './roomlist.js';
import { redactRoomPayload } from './redact.js';
import { searchMessages, searchRooms, searchTasks, SEARCH_MIN_QUERY, SEARCH_MESSAGE_WINDOW } from './search.js';
import { roomHealth } from './health.js';
import { statusForError } from './httpstatus.js';
import { lifecycleDiscovery } from './lifecycle.js';
import { validateMessageAttachments, validateMessageBody } from './messageAttachments.js';
import { stampMessageEnvelope } from './envelope.js';
import { getReadMarkerState, listReadMarkers, resolveMarkerAccount, setReadMarker, stampReadMarkerTime } from './readmarkers.js';
import {
  selectAttachment, storageKeyFor, verifyIntegrity,
  signDownloadToken, verifyDownloadToken, AttachmentDownloadError,
  INLINE_MAX_BYTES, SIGNED_URL_TTL_MS,
  type SignedTokenClaims,
} from './attachmentDownload.js';
import {
  initPush,
  isTeammateMessage,
  normalizeNotifyLevel,
  ownerEmail,
  parseNotifyPrefs,
  pushEnabled,
  readPushEnv,
  sendToAccount,
  shouldNotifyOwner,
  shouldSuppressAllPush,
  upsertSubscription,
  vapidPublicKey,
  type NotifyLevel,
  type StoredSubscription,
  type SubscriptionStore,
} from './push.js';
import type { Message, Participant, ReplyMode, ReplyModeConfig, RoomQuestion } from '@agent-room/shared';
import { answerRoomQuestion, createRoomQuestion, requireQuestionAgent } from './questions.js';
import { ensureArtifactIndex, listRoomArtifacts,
  appendMessage as appendStoredMessage,
  appendSystemMessage as appendStoredSystemMessage,
  applyMessageReaction,
  casRoom,
  createRoom as createStoredRoom,
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
  archiveRoom,
  unarchiveRoom,
  setRoomTemplate,
  setRoomWorkspace,
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
const PUBLIC_ORIGIN = process.env.AGENT_ROOM_PUBLIC_ORIGIN || 'https://chat.wakilabs.dev';
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

// T-118: owner push channel — enabled only when VAPID keys are configured.
initPush(readPushEnv());
const pushStore: SubscriptionStore = {
  async read(email) {
    const raw = await redis.get(`push:subs:${email}`);
    if (!raw) return [];
    try { return JSON.parse(raw) as StoredSubscription[]; } catch { return []; }
  },
  async write(email, subs) {
    await redis.set(`push:subs:${email}`, JSON.stringify(subs));
  },
};
/** Fire-and-forget owner notification; message flow never blocks on push. */
function notifyOwnerAsync(payload: { title: string; body: string; url: string; tag?: string }): void {
  if (!pushEnabled()) return;
  void sendToAccount(pushStore, ownerEmail(), payload).catch(err => {
    console.error('[push] owner dispatch failed:', (err as Error).message);
  });
}

// T-118 follow-up: per-account notify level, push:prefs:<email>.
async function readNotifyLevel(email: string): Promise<NotifyLevel> {
  return parseNotifyPrefs(await redis.get(`push:prefs:${email}`));
}
async function writeNotifyLevel(email: string, level: NotifyLevel): Promise<void> {
  await redis.set(`push:prefs:${email}`, JSON.stringify({ level }));
}

/**
 * 'all'-level owner notification for an ordinary teammate message. Entirely
 * fire-and-forget: the level lookup, marker read, and total read all happen
 * off the send hot path. Skipped when the owner's read marker shows them
 * caught up in this room within the reading window (mentions never route
 * through here, so they always deliver).
 */
function notifyOwnerAllLevelAsync(code: string, message: Message): void {
  if (!pushEnabled() || !isTeammateMessage(message)) return;
  void (async () => {
    const owner = ownerEmail();
    if ((await readNotifyLevel(owner)) !== 'all') return;
    const [marker, total] = await Promise.all([
      getReadMarkerState(redis, owner, code),
      getMessageTotalCount(client, code),
    ]);
    if (shouldSuppressAllPush({
      markerCount: marker.count,
      markerMovedAt: marker.movedAt,
      totalAfterAppend: total,
      now: Date.now(),
    })) return;
    await sendToAccount(pushStore, owner, {
      title: `${message.name} sent a message`,
      body: String(message.text || '').slice(0, 140),
      url: `/r/${code}`,
      tag: `all-${code}`,
    });
  })().catch(err => {
    console.error('[push] all-level dispatch failed:', (err as Error).message);
  });
}

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

// T-15: room-list reads use a durable recent-activity ZSET instead of SCANning
// every room and issuing sequential GET/LINDEX/GET calls on every request.
// Existing installations are backfilled once; new rooms/messages maintain the
// index on the write path. Expired room members are pruned while paging.
const ROOM_ACTIVITY_INDEX_KEY = 'room-index:activity:v1';
const ROOM_ACTIVITY_INDEX_READY_KEY = 'room-index:activity:v1:ready';
let roomIndexBackfill: Promise<void> | null = null;

async function touchRoomActivityIndex(code: string, at = Date.now()): Promise<void> {
  await redis.zadd(ROOM_ACTIVITY_INDEX_KEY, at, code);
}

async function safelyTouchRoomActivityIndex(code: string, at = Date.now()): Promise<void> {
  try {
    await touchRoomActivityIndex(code, at);
  } catch (error) {
    // A room/message write has already succeeded. Never turn an index-refresh
    // failure into a client retry that could duplicate the durable operation.
    console.warn(`[room-index] could not update ${code}:`, error);
    await redis.del(ROOM_ACTIVITY_INDEX_READY_KEY).catch(() => undefined);
  }
}

const createRoom: typeof createStoredRoom = async (...args) => {
  const created = await createStoredRoom(...args);
  await safelyTouchRoomActivityIndex(created.code, created.createdAt);
  return created;
};

const appendMessage: typeof appendStoredMessage = async (...args) => {
  const result = await appendStoredMessage(...args);
  if (result.appended) await safelyTouchRoomActivityIndex(args[1]);
  return result;
};

const appendSystemMessage: typeof appendStoredSystemMessage = async (...args) => {
  await appendStoredSystemMessage(...args);
  await safelyTouchRoomActivityIndex(args[1]);
};

async function backfillRoomActivityIndex(): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'room:*', 'COUNT', 200);
    cursor = next;
    if (keys.length === 0) continue;
    const reads = redis.pipeline();
    for (const key of keys) {
      reads.get(key);
      const code = key.slice('room:'.length);
      reads.lindex(`room-msgs:${code}`, -1);
    }
    const rows = await reads.exec();
    if (!rows) throw new Error('room index backfill pipeline aborted');
    const writes = redis.pipeline();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const raw = rows[i * 2]?.[1];
      const lastRaw = rows[i * 2 + 1]?.[1];
      if (typeof raw !== 'string') continue;
      try {
        const room = JSON.parse(raw) as { code?: unknown; createdAt?: unknown };
        const code = typeof room.code === 'string' ? room.code : '';
        if (!code || key !== `room:${code}`) continue;
        let lastMessageAt: number | undefined;
        if (typeof lastRaw === 'string') {
          const parsed = JSON.parse(lastRaw) as { time?: unknown };
          const time = Number(parsed.time);
          if (Number.isFinite(time)) lastMessageAt = time;
        }
        writes.zadd(
          ROOM_ACTIVITY_INDEX_KEY,
          roomActivityAt(Number(room.createdAt), lastMessageAt),
          code,
        );
      } catch {
        // Skip malformed/non-room keys just like the former list endpoint.
      }
    }
    await writes.exec();
  } while (cursor !== '0');
  await redis.set(ROOM_ACTIVITY_INDEX_READY_KEY, '1');
}

async function ensureRoomActivityIndex(): Promise<void> {
  if (await redis.get(ROOM_ACTIVITY_INDEX_READY_KEY)) return;
  if (!roomIndexBackfill) {
    roomIndexBackfill = backfillRoomActivityIndex().finally(() => { roomIndexBackfill = null; });
  }
  await roomIndexBackfill;
}

const roomListStore: RoomListStore = {
  async count() {
    return redis.zcard(ROOM_ACTIVITY_INDEX_KEY);
  },
  async range(start, stop) {
    const flat = await redis.zrevrange(ROOM_ACTIVITY_INDEX_KEY, start, stop, 'WITHSCORES');
    const entries: RoomIndexEntry[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      entries.push({ code: flat[i]!, score: Number(flat[i + 1]) });
    }
    return entries;
  },
  async read(entries) {
    const reads = redis.pipeline();
    for (const entry of entries) {
      reads.get(`room:${entry.code}`);
      reads.get(`room-msg-count:${entry.code}`);
    }
    const rows = await reads.exec();
    if (!rows) throw new Error('room list pipeline aborted');
    return entries.map((_, i) => ({
      raw: typeof rows[i * 2]?.[1] === 'string' ? rows[i * 2]![1] as string : null,
      messageCountRaw: rows[i * 2 + 1]?.[1] as string | number | null,
    }));
  },
  async remove(codes) {
    if (codes.length > 0) await redis.zrem(ROOM_ACTIVITY_INDEX_KEY, ...codes);
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
  if (loopback && !viaEdge) {
    // DEV-ONLY visual-verification bypass: when DEV_AUTH_EMAIL is set, a
    // trusted-loopback (non-edge) BROWSER request authenticates AS that
    // allow-listed user, so the web app — which gates on /api/me — is enterable
    // on 127.0.0.1 without the Google flow. Scoped to browser requests (they
    // send Sec-Fetch-* / a Mozilla UA; the agents' MCP node client does not),
    // so summoned agents keep caller.kind==='local' and their identity/anchor
    // paths are untouched. Never fires for real users: edge traffic always
    // carries cf-ray/cf-connecting-ip (excluded above). Off unless the env is set.
    const devEmail = (process.env.DEV_AUTH_EMAIL || '').toLowerCase();
    const isBrowser = Boolean(req.headers['sec-fetch-site']) || /Mozilla\//.test(String(req.headers['user-agent'] || ''));
    if (devEmail && isBrowser && allowedEmails().has(devEmail)) return { kind: 'user', email: devEmail };
    return { kind: 'local' };
  }
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

// Binary-safe body reader for the upload path — string concat corrupts bytes,
// so we accumulate Buffers. Capped a little above the 10 MB attachment limit to
// leave room for multipart framing.
function readRawBody(req: IncomingMessage, maxBytes = 12_000_000): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        rej(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
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
function sanitizeProjectError(err: Error): { error: string; message: string; code?: string } {
  if (err.name === 'ProjectRegistryError') {
    console.error(`[project] ${err.message}`);
    return { error: err.name, message: 'Project registry is misconfigured on the server; check the server log.' };
  }
  // T-123: surface the stable attachment-download code (not_found,
  // not_a_participant, too_large, integrity_mismatch, ...) so a tool consumer
  // can branch on a machine code rather than parsing prose.
  const downloadCode = (err as Error & { downloadCode?: string }).downloadCode;
  return downloadCode
    ? { error: err.name, message: err.message, code: downloadCode }
    : { error: err.name, message: err.message };
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

// T-123: secure attachment download state.
// Signing secret for one-time download URLs. An explicit env value survives
// restarts; the random fallback simply invalidates outstanding 60s tokens on
// restart, which is safe. Never logged.
const ATTACHMENT_SIGN_SECRET = process.env.ATTACHMENT_SIGN_SECRET || randomBytes(32).toString('hex');
// Single-use enforcement: a consumed token's nonce is remembered until its own
// expiry, so a replay after first success is rejected. Pruned lazily.
const consumedDownloadNonces = new Map<string, number>();
// Per (room, participant) sliding-window rate limit on attachment reads.
const DOWNLOAD_RATE_MAX = 30;
const DOWNLOAD_RATE_WINDOW_MS = 60_000;
const downloadRateHits = new Map<string, number[]>();

function downloadRateLimited(key: string, now: number): boolean {
  const hits = (downloadRateHits.get(key) ?? []).filter(t => now - t < DOWNLOAD_RATE_WINDOW_MS);
  if (hits.length >= DOWNLOAD_RATE_MAX) { downloadRateHits.set(key, hits); return true; }
  hits.push(now);
  downloadRateHits.set(key, hits);
  return false;
}

// T-134: the compute endpoints (/api/transcribe, /api/tts) each spawn ffmpeg +
// whisper/say, so cap per-caller volume as a runaway backstop. The ceiling is
// generous on purpose: legitimate continuous dictation is ~24 segments/min and
// a reconnect can drain a buffered backlog in a burst, so a tight cap would
// break real use. This bounds a runaway loop without touching normal traffic.
// A 429 is signalled as transient so the client retries (never drops a segment).
const COMPUTE_RATE_MAX = 300;
const COMPUTE_RATE_WINDOW_MS = 60_000;
const computeRateHits = new Map<string, number[]>();
function computeRateLimited(key: string, now: number): boolean {
  const hits = (computeRateHits.get(key) ?? []).filter(t => now - t < COMPUTE_RATE_WINDOW_MS);
  if (hits.length >= COMPUTE_RATE_MAX) { computeRateHits.set(key, hits); return true; }
  hits.push(now);
  computeRateHits.set(key, hits);
  return false;
}
function computeCallerKey(caller: Caller): string {
  return caller.kind === 'user' ? `u:${caller.email}` : caller.kind;
}

// Structured audit line — NO file contents, credentials, cookies, tokens, or
// signed URLs. Just who read what, when, and the outcome.
function attachmentAudit(fields: { room: string; attachmentId: string; participant: string; op: string; bytes: number; outcome: string }): void {
  console.info(`[audit] attachment op=${fields.op} room=${fields.room} attachment=${fields.attachmentId} participant=${fields.participant} bytes=${fields.bytes} outcome=${fields.outcome}`);
}

// Strict participant authorization for download: unlike the send path, a caller
// with NO matching participant row is REJECTED (not silently allowed), and a
// valid member credential is REQUIRED — a display name alone never authorizes a
// file read. Kicked/left participants have no row, so their access ends at once.
async function authorizeAttachmentParticipant(
  code: string,
  name: string,
  clientKind: 'web' | 'cc',
  memberKey: string | undefined,
  caller: Caller,
): Promise<void> {
  const room = await getRoom(client, code); // throws RoomNotFoundError if the room is gone
  const rows = room.participants.filter(p => p.name === name && p.client === clientKind);
  if (rows.length === 0) {
    throw new AttachmentDownloadError('not_a_participant', `"${name}" (${clientKind}) is not a current participant of this room.`);
  }
  const presentedHash = memberKey ? await sha256Hex(memberKey) : undefined;
  const verifiedAuthIdHash = caller.kind === 'user' && clientKind === 'web' ? await sha256Hex(caller.email) : undefined;
  // Force credential auth (no legacy-name relaxation) for file reads.
  const decision = decideSenderAuth(rows, presentedHash, false, verifiedAuthIdHash);
  if (!decision.ok) {
    throw new AttachmentDownloadError('not_a_participant', `Participant credential required to read attachments in this room. Rejoin to obtain one, then retry.`);
  }
}

// T-30 (F1): host authority now REQUIRES a valid hostKey — the name-equality
// fallback is gone. `verifyHostKey` fails closed on a room with no stored
// hash unless the migration flag is on (in which case the relaxation is
// logged). Applies to end/reactivate/setReplyMode/directInvoke/skipCurrent
// AND (routed here at the server) setMuted/removeParticipant.
async function requireHost(code: string, hostKey: string | undefined, caller: Caller): Promise<void> {
  await verifyHostKey(client, code, hostKey, {
    allowLegacyNoHash: ALLOW_LEGACY_NAME_AUTH,
    authId: caller.kind === 'user' ? caller.email : undefined,
  });
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
  const verifiedAuthIdHash =
    caller.kind === 'user' && clientKind === 'web' ? await sha256Hex(caller.email) : undefined;
  const decision = decideSenderAuth(rows, presentedHash, ALLOW_LEGACY_NAME_AUTH, verifiedAuthIdHash);
  if (decision.ok) {
    if (decision.via === 'legacy-name') {
      securityEvent(`send/presence as "${name}" (${clientKind}) on ${code} via legacy name path (ALLOW_LEGACY_NAME_AUTH); caller=${caller.kind}`);
    }
    return;
  }
  switch (decision.reason) {
    case 'wrong-auth-id':
      throw memberAuthError(`The signed-in account does not own the participant "${name}".`);
    case 'need-key':
      throw memberAuthError(`This participant requires its member credential. Rejoin the room to obtain one, then retry.`);
    case 'bad-key':
      throw memberAuthError(`Member credential does not match "${name}". A display name alone cannot authenticate.`);
    case 'ambiguous':
      throw memberAuthError(`"${name}" (${clientKind}) is ambiguous: ${rows.length} rows share it. Rejoin with a distinct name or a member credential.`);
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
      const requestedTopic = String(payload.topic || '');
      const topicIssue = roomTopicIssue(requestedTopic);
      if (topicIssue) {
        const err = new Error(topicIssue);
        err.name = 'BadRequestError';
        throw err;
      }
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
      // Template id must come from the shared registry — reject typos loudly
      // rather than storing a template no layer can resolve (ba5b1fe lesson:
      // silent normalization makes API misuse invisible).
      const requestedTemplate = payload.templateId;
      if (requestedTemplate !== undefined && requestedTemplate !== '' && !isKnownTemplateId(requestedTemplate)) {
        const err = new Error(`Unknown templateId "${String(requestedTemplate)}". Known ids: ${ROOM_TEMPLATES_SHARED.map((t) => t.id).join(', ')}.`);
        err.name = 'BadRequestError';
        throw err;
      }
      const created = await createRoom(client, {
        code: newCode,
        topic: normalizeRoomTopic(requestedTopic),
        createdBy: String(payload.createdBy || ''),
        hostAuthId: caller.kind === 'user' ? caller.email : undefined,
        workspace: typeof payload.workspace === 'string' && payload.workspace ? payload.workspace : undefined,
        templateId: isKnownTemplateId(requestedTemplate) ? requestedTemplate : undefined,
      });
      const { hostKey, ...room } = created;
      // T-114: harness/probe rooms opt in as QA at creation (explicit flag or
      // the [QA] topic prefix) and are excluded from Home and the desktop
      // ROOMS list for everyone.
      if (payload.qa === true || isQaRoom({ topic: room.topic })) {
        const flagged = await casRoom(client, newCode, (cur) => ({ ...cur, qa: true }));
        return { room: flagged, hostKey };
      }
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
    case 'renameRoom': {
      await requireHost(code, payload.hostKey as string | undefined, caller);
      const requestedTopic = String(payload.topic || '');
      const topicIssue = roomTopicIssue(requestedTopic);
      if (topicIssue) {
        const err = new Error(topicIssue);
        err.name = 'BadRequestError';
        throw err;
      }
      return {
        room: await casRoom(client, code, current => ({
          ...current,
          topic: normalizeRoomTopic(requestedTopic),
        })),
      };
    }
    case 'verifyHostKey': {
      // Pre-flight for a web client about to claim the host slot. Throws
      // HostNameTakenError (403) on a wrong key; legacy rooms without a
      // hostKeyHash always pass, matching joinRoom's own check.
      await verifyHostKey(client, code, payload.hostKey as string | undefined, {
        authId: caller.kind === 'user' ? caller.email : undefined,
      });
      return { ok: true };
    }
    case 'setMuted': {
      // T-30 (F1): mute/unmute is host-only and now REQUIRES a hostKey. The
      // underlying setMuted still name-checks as defense in depth, so pass
      // the verified host name (createdBy), never the caller's claim.
      await requireHost(code, payload.hostKey as string | undefined, caller);
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
      await requireHost(code, payload.hostKey as string | undefined, caller);
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
      // T-145 (completes T-143): a joining participant is present NOW. The cc
      // join path (MCP) does not stamp joinedAt/lastSeenAt, which left a fresh
      // agent reading "unknown"/1969 until its first message. Stamp presence
      // server-side when the client omitted it — respecting any value the client
      // did send — so a new agent reads online immediately and has a real anchor.
      const joinStamp = Date.now();
      if (!Number(participant.lastSeenAt)) participant.lastSeenAt = joinStamp;
      if (!Number(participant.joinedAt)) participant.joinedAt = joinStamp;
      const hostKey = payload.hostKey as string | undefined;
      const priorIdentity = payload.priorIdentity as { name: string; client: 'web' | 'cc' } | undefined;
      const room = await getRoom(client, code);
      if (participant.name === room.createdBy) {
        // T-30 (F1): claiming the host slot requires a valid hostKey; a room
        // with no stored hash fails closed unless the migration flag is on.
        await verifyHostKey(client, code, hostKey, {
          allowLegacyNoHash: ALLOW_LEGACY_NAME_AUTH,
          authId: caller.kind === 'user' ? caller.email : undefined,
        });
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
      //  - agentId (T-66): the agent's DURABLE reclaim anchor, injected by that
      //    agent's own memberkey-proxy. Accepted ONLY from a trusted LOCAL
      //    caller on a 'cc' row. A browser reaches us through the Cloudflare
      //    edge and is therefore never `local`, so a web client cannot mint or
      //    present an agent anchor no matter what it puts in the body — the same
      //    boundary that keeps `authId` server-verified, applied in reverse.
      const agentId =
        caller.kind === 'local' && participant.client === 'cc'
          ? (payload.agentId as string | undefined)
          : undefined;
      const joined = await joinRoom(client, code, participant, {
        priorIdentity,
        issueMemberKey: Boolean(payload.wantMemberKey),
        reclaimMemberKey: payload.memberKey as string | undefined,
        authId,
        agentId,
      });
      // T-66: credential recovery must NEVER be silent. A row changing hands is
      // precisely the event an operator needs to see — and a stolen identity
      // would look exactly like a quiet success. `anchorAudit` carries only
      // room-visible identity (name/client/outcome): no anchors, hashes or keys,
      // so it is safe to log verbatim.
      const { participant: outParticipant, memberKey, anchorAudit, displaced, removalNotice, ...roomRest } = joined;
      if (anchorAudit) {
        securityEvent(
          anchorAudit.outcome === 'anchor_recovery'
            ? `agent-anchor RECOVERY on ${code}: "${anchorAudit.name}" (${anchorAudit.client}) reclaimed its key-protected row WITHOUT presenting a member key — rotating key was lost; a fresh key was issued`
            : `agent-anchor bound on ${code}: "${anchorAudit.name}" (${anchorAudit.client}) is now recoverable (row was ${anchorAudit.reclaimedProtectedRow ? 'key-protected; ownership proven with its member key' : 'unprotected'})`,
        );
        // T-32: recovery must be visible IN THE ROOM, not just in server logs —
        // a displaced or recovering agent (and the host) can read the feed and
        // see exactly which mechanism touched the participant row.
        if (anchorAudit.outcome === 'anchor_recovery') {
          await appendSystemMessage(client, code, sysMessage(
            `${anchorAudit.name} recovered their participant row via their durable agent anchor (previous credential was lost).`,
            { eventType: 'identity_reclaimed', targetAgentName: anchorAudit.name, targetAgentClient: anchorAudit.client },
          )).catch(() => { /* audit message is best-effort; the join itself succeeded */ });
        }
      }
      // T-32: displacement is NEVER silent. Every live row this join removed
      // gets a room-visible system message naming the mechanism, so a kicked
      // agent (and the host) can see exactly what touched the participant list.
      for (const d of displaced ?? []) {
        const how = d.mechanism === 'anchor_recovery'
          ? 'its durable anchor recovered the row and rotated the credential'
          : `a new join arrived under the same name ("${outParticipant.name}")`;
        securityEvent(`participant displaced on ${code}: "${d.name}" (${d.client}) removed — ${how}`);
        await appendSystemMessage(client, code, sysMessage(
          `${d.name}'s previous session was removed: ${how} (mechanism: ${d.mechanism}). If that session was still yours, rejoin — the server will hand you this notice — and post a [RELIABILITY] report for the host.`,
          { eventType: 'participant_displaced', targetAgentName: d.name, targetAgentClient: d.client, mechanism: d.mechanism },
        )).catch(() => { /* best-effort; the join itself succeeded */ });
      }
      // T-21: hand every joining client the room's working conventions so a
      // fresh agent (or a future MCP that surfaces this field) starts with the
      // marker/task/ping etiquette instead of learning it mid-meeting.
      // T-32: `removalNotice` tells a REJOINING identity why its previous row
      // was removed (popped from room.lastRemovals; delivered exactly once).
      return { room: roomRest, participant: outParticipant, memberKey, conventions: ROOM_CONVENTIONS, removalNotice };
    }
    case 'messages': {
      // T-04: optional `limit` bounds the page; omitted keeps cursor-to-end.
      const rawLimit = Number(payload.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : undefined;
      return { messages: await listMessages(client, code, Number(payload.cursor || 0), limit) };
    }
    // T-66: per-participant listen-loop health, so the app can show who is
    // ACTUALLY listening rather than leaving the host to guess whether an agent
    // is thinking, rate-limited, or dead. Derived from real presence fields
    // (listenUntil / lastSeenAt); carries no credential material.
    case 'health': {
      const room = await getRoom(client, code);
      return { health: roomHealth(room.participants, Date.now()) };
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
        const err = new Error('message.name is required. Pass your display name in the room_send call.');
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
      validateMessageAttachments(message);
      validateMessageBody(message);
      // T-143: any authenticated send is proof of life — heal the sender's
      // presence so an actively-posting agent is never shown offline. A server
      // restart can leave a rejoined row with a null lastSeenAt; the first
      // message re-establishes it. Fire-and-forget: never fail a send on this.
      void updatePresence(client, code, String(message.name), Date.now()).catch(() => {});
      // T-113: server-authoritative envelope — id/time stamped when missing,
      // type normalized to 'msg' (only server code authors 'sys' rows).
      const stamped = stampMessageEnvelope(message);
      if (kind === 'status') {
        // Status updates append without touching the turn machinery.
        // T-20: stamp the persisted message so every reader can classify it —
        // the web renders these as quiet status rows and keeps them out of
        // unread counts. Historical unstamped pings stay ordinary messages.
        const statusMessage: Message = {
          ...stamped,
          metadata: { ...(stamped as { metadata?: Record<string, unknown> }).metadata, kind: 'status' },
        } as Message;
        await getRoom(client, code);
        await appendSystemMessage(client, code, statusMessage);
        return { result: { appended: true, metadata: statusMessage.metadata ?? {} } };
      }
      const appendResult = await appendMessage(client, code, stamped);
      // T-118: a message that @mentions the owner taps them on the shoulder —
      // app badge + push on every registered device. Fire-and-forget. At the
      // 'all' notify level, ordinary teammate messages push too (suppressed
      // while the owner is demonstrably reading the room).
      if (shouldNotifyOwner(stamped)) {
        notifyOwnerAsync({
          title: `${stamped.name} mentioned you`,
          body: String(stamped.text || '').slice(0, 140),
          url: `/r/${code}`,
          tag: `mention-${code}`,
        });
      } else if (appendResult.appended) {
        // Only the immediate-append path pushes: turn-gated messages that come
        // back appended:false and flush later never re-enter this dispatch.
        // Mentions behave the same way today, so the channel is consistent.
        notifyOwnerAllLevelAsync(code, stamped);
      }
      return { result: appendResult };
    }
    case 'readMarkerSet': {
      // T-126: READ-STATE IS USER-STATE — advance the account's marker for
      // this room (monotonic; a stale device can never regress it).
      const account = resolveMarkerAccount(caller, payload.account);
      const stored = await setReadMarker(redis, account, code, Number(payload.count));
      // Every marker sync is proof the account has the room open right now —
      // stamp the time so the push channel can suppress 'all'-level pings
      // while the owner is actively reading. Never fail the sync on this.
      void stampReadMarkerTime(redis, account, code, Date.now()).catch(() => {});
      return { result: { code, count: stored } };
    }
    case 'readMarkerList': {
      // T-126: the account's full { code: count } map, one call for Home.
      const account = resolveMarkerAccount(caller, payload.account);
      return { result: { markers: await listReadMarkers(redis, account) } };
    }
    case 'react': {
      // T-121: toggle an acknowledge/reject reaction on a stored message.
      // Same authentication bar as 'send' — a display name alone never reacts.
      const reactorName = String(payload.name || '');
      const reactorClient = (payload.client as 'web' | 'cc') || 'web';
      const kind = payload.kind as string;
      const targetMessageId = Number(payload.messageId);
      if (!reactorName) {
        const err = new Error('name is required. Pass your display name.');
        err.name = 'BadRequestError';
        throw err;
      }
      if (kind !== 'ack' && kind !== 'reject') {
        const err = new Error("kind must be 'ack' or 'reject'.");
        err.name = 'BadRequestError';
        throw err;
      }
      if (!Number.isFinite(targetMessageId) || targetMessageId <= 0) {
        const err = new Error('messageId must be the id of a stored message.');
        err.name = 'BadRequestError';
        throw err;
      }
      await authenticateSender(code, reactorName, reactorClient, payload.memberKey as string | undefined, caller);
      const outcome = await applyMessageReaction(client, code, targetMessageId, { name: reactorName, client: reactorClient }, kind);
      // Event row: how cursor-polling web clients patch the already-rendered
      // target (via reactionsSnapshot) and how listening agents learn that
      // their work was acknowledged or contested (via the text). The web
      // hides this row from the feed; the chips on the message are the UI.
      const verb = outcome.added
        ? (kind === 'ack' ? 'acknowledged' : 'rejected')
        : (kind === 'ack' ? 'withdrew their acknowledgment of' : 'withdrew their rejection of');
      const eventRow: Message = {
        id: Date.now(),
        type: 'sys',
        name: 'system',
        initials: 'SY',
        color: '#64748b',
        role: '',
        client: 'cc',
        time: Date.now(),
        text: `${reactorName} ${verb} ${outcome.target.name}'s message: "${outcome.target.text}"`,
        metadata: {
          eventType: 'reaction',
          targetMessageId,
          reactionKind: kind,
          reactionRemoved: !outcome.added,
          reactionsSnapshot: outcome.reactions,
          targetAgentName: reactorName,
        },
      };
      await appendSystemMessage(client, code, eventRow);
      return { result: { added: outcome.added, reactions: outcome.reactions } };
    }
    case 'attachmentDownload': {
      // T-123: agent-native secure download. Authorized by the caller's
      // participant member credential (NOT a browser cookie), scoped to this
      // one room. Returns inline bytes for small files or a one-time signed
      // URL for larger ones, always with integrity metadata. Every outcome is
      // audited; stable error codes distinguish the failure modes.
      const pName = String(payload.name || '');
      const pClient = (payload.client as 'web' | 'cc') || 'cc';
      const participant = `${pName}|${pClient}`;
      const selector = {
        id: typeof payload.attachmentId === 'string' ? payload.attachmentId : undefined,
        name: typeof payload.attachmentName === 'string' ? payload.attachmentName : undefined,
        url: typeof payload.url === 'string' ? payload.url : undefined,
      };
      const now = Date.now();
      try {
        if (!pName) throw new AttachmentDownloadError('bad_request', 'name (your participant display name) is required.');
        if (!selector.id && !selector.name && !selector.url) {
          throw new AttachmentDownloadError('bad_request', 'Provide exactly one selector: attachmentId, attachmentName, or url.');
        }
        await authorizeAttachmentParticipant(code, pName, pClient, payload.memberKey as string | undefined, caller);
        if (downloadRateLimited(`${code}|${participant}`, now)) {
          throw new AttachmentDownloadError('bad_request', `Rate limit exceeded: at most ${DOWNLOAD_RATE_MAX} attachment reads per minute per participant.`);
        }
        const messages = await listMessages(client, code, 0);
        const resolved = selectAttachment(messages, selector);
        if (!resolved) throw new AttachmentDownloadError('not_found', 'No attachment in this room matches that selector.');
        const key = storageKeyFor(resolved.attachment);
        if (!key) throw new AttachmentDownloadError('not_found', 'Attachment has no resolvable storage key.');
        const blob = readBlob(code, key);
        if (!blob) throw new AttachmentDownloadError('not_found', 'Stored object is missing.');
        const integrity = verifyIntegrity(blob.data, resolved.attachment); // throws integrity_mismatch / too_large

        const base = {
          id: resolved.attachment.id,
          name: resolved.attachment.name,
          declaredMime: resolved.attachment.mime,
          detectedMime: integrity.detectedMime,
          bytes: integrity.bytes,
          sha256: integrity.sha256,
          uploaderMessageId: resolved.uploaderMessageId,
          uploadedAt: resolved.uploadedAt,
        };

        if (integrity.bytes <= INLINE_MAX_BYTES) {
          attachmentAudit({ room: code, attachmentId: base.id, participant, op: 'download-inline', bytes: base.bytes, outcome: 'ok' });
          return { result: { ...base, delivery: 'inline', contentBase64: blob.data.toString('base64') } };
        }
        // Larger than the inline threshold: hand back a one-time signed URL.
        const claims: SignedTokenClaims = {
          code, attachmentId: base.id, storageKey: key, participant,
          op: 'download', exp: now + SIGNED_URL_TTL_MS, nonce: randomUUID(),
        };
        const token = signDownloadToken(ATTACHMENT_SIGN_SECRET, claims);
        attachmentAudit({ room: code, attachmentId: base.id, participant, op: 'download-url', bytes: base.bytes, outcome: 'ok' });
        return { result: { ...base, delivery: 'signed-url', signedUrl: `${PUBLIC_ORIGIN}/dl?token=${encodeURIComponent(token)}`, expiresInMs: SIGNED_URL_TTL_MS } };
      } catch (e) {
        const outcome = e instanceof AttachmentDownloadError ? e.code : 'error';
        attachmentAudit({ room: code, attachmentId: selector.id || selector.name || selector.url || '?', participant, op: 'download', bytes: 0, outcome });
        if (e instanceof AttachmentDownloadError) {
          const err = new Error(e.message);
          // 404 for not_found; 403 for auth; 400 for the rest.
          err.name = e.code === 'not_found' ? 'RoomNotFoundError'
            : (e.code === 'not_a_participant' || e.code === 'permission_revoked') ? 'MemberAuthError'
            : 'BadRequestError';
          (err as Error & { downloadCode?: string }).downloadCode = e.code;
          throw err;
        }
        throw e;
      }
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
        await requireHost(code, payload.hostKey as string | undefined, caller);
        effectiveRequester = (await getRoom(client, code)).createdBy;
      }
      const roomAfterRemove = await removeParticipant(
        client,
        code,
        effectiveRequester,
        targetName,
        targetClient,
      );
      // T-32: host kicks are room-visible with provenance; self-leaves stay
      // quiet (voluntary, and the MCP already narrates its own departures).
      if (requesterName !== targetName) {
        await appendSystemMessage(client, code, sysMessage(
          `${targetName} was removed by the host (${effectiveRequester}) (mechanism: host_removal).`,
          { eventType: 'participant_removed', targetAgentName: targetName, targetAgentClient: targetClient, mechanism: 'host_removal', byName: effectiveRequester },
        )).catch(() => { /* best-effort; the removal itself succeeded */ });
      }
      return { room: roomAfterRemove };
    }
    case 'end': {
      await requireHost(code, payload.hostKey as string | undefined, caller);
      return { room: await endRoom(client, code) };
    }
    case 'reactivate': {
      await requireHost(code, payload.hostKey as string | undefined, caller);
      return { room: await reactivateRoom(client, code) };
    }
    case 'archiveRoom': {
      // Owner-gated in the browser; a trusted local process may also archive
      // (lets the admin/summoner clean up rooms it created).
      if (caller.kind !== 'local') await requireHost(code, payload.hostKey as string | undefined, caller);
      return { room: await archiveRoom(client, code) };
    }
    case 'unarchiveRoom': {
      if (caller.kind !== 'local') await requireHost(code, payload.hostKey as string | undefined, caller);
      return { room: await unarchiveRoom(client, code) };
    }
    case 'setWorkspace': {
      if (caller.kind !== 'local') await requireHost(code, payload.hostKey as string | undefined, caller);
      return { room: await setRoomWorkspace(client, code, String(payload.workspace || '')) };
    }
    case 'setTemplate': {
      // Host-editable room TYPE — this is what lets an existing room be
      // CONVERTED (retagged) rather than templates being creation-only.
      if (caller.kind !== 'local') await requireHost(code, payload.hostKey as string | undefined, caller);
      const templateId = String(payload.templateId || '');
      if (templateId && !isKnownTemplateId(templateId)) {
        const err = new Error(`Unknown templateId "${templateId}". Known ids: ${ROOM_TEMPLATES_SHARED.map((t) => t.id).join(', ')}.`);
        err.name = 'BadRequestError';
        throw err;
      }
      const room = await setRoomTemplate(client, code, templateId);
      // Announce the conversion in-room so agents observe it on their next
      // listen and joiners can see when the type changed.
      const info = templateInfo(templateId);
      const now = Date.now();
      try {
        await appendSystemMessage(client, code, {
          id: now,
          type: 'sys',
          name: 'system',
          initials: '⚙️',
          color: '#6B7280',
          role: '',
          client: 'cc',
          time: now,
          text: info
            ? `Room type set to ${info.label} by the host. Agents: ${info.brief}`
            : 'Room type cleared by the host (untyped room).',
          metadata: { eventType: 'template_changed', ...(templateId ? { templateId } : {}) },
        } as Message);
      } catch { /* announcement is best-effort; the retag itself succeeded */ }
      return { room };
    }
    case 'createReport': {
      const room = await getRoom(client, code);
      const messages = await listMessages(client, code, 0);
      return { report: await createRoomReport(client, room, messages) };
    }
    case 'setReplyMode': {
      await requireHost(code, payload.hostKey as string | undefined, caller);
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
      await requireHost(code, payload.hostKey as string | undefined, caller);
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
      await requireHost(code, payload.hostKey as string | undefined, caller);
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
    case 'questionList': {
      const room = await getRoom(client, code);
      if (caller.kind === 'user') {
        await requireHost(code, payload.hostKey as string | undefined, caller);
      } else {
        requireQuestionAgent(room.participants, String(payload.name || ''));
      }
      return { questions: await listRoomQuestions(code) };
    }
    case 'questionCreate': {
      if (caller.kind !== 'local') {
        throw taskError('NotHostError', 'Only an agent in this room can create an owner question.');
      }
      const room = await getRoom(client, code);
      if (room.status !== 'active') throw taskError('BadRequestError', 'Cannot create a question in an ended room.');
      const name = String(payload.name || '').trim();
      requireQuestionAgent(room.participants, name);
      const question = createRoomQuestion({
        id: `Q-${randomUUID()}`,
        prompt: payload.prompt,
        context: payload.context,
        mode: payload.mode,
        options: payload.options,
        createdBy: name,
        now: nowMs(),
      });
      await appendRoomQuestion(code, question);
      await appendSystemMessage(
        client,
        code,
        sysMessage(`${name} created a question artifact for the room owner.`, {
          eventType: 'question_created',
          questionId: question.id,
          targetAgentName: name,
          targetAgentClient: 'cc',
        }),
      );
      // T-118: questions are addressed to the owner by definition.
      notifyOwnerAsync({
        title: `${name} asked you a question`,
        body: String(question.prompt || '').slice(0, 140),
        url: `/r/${code}?panel=questions`,
        tag: `question-${question.id}`,
      });
      return { question };
    }
    case 'questionAnswer': {
      if (caller.kind !== 'user') {
        throw taskError('NotHostError', 'Only the authenticated room owner can answer questions.');
      }
      await requireHost(code, payload.hostKey as string | undefined, caller);
      const room = await getRoom(client, code);
      const question = await answerStoredRoomQuestion(
        code,
        String(payload.id || ''),
        payload.value,
        room.ownerName || room.createdBy,
      );
      return { question };
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
      // Builder != verifier: if this task was cross-assigned a verifier that is
      // the very agent now claiming it (its original builder went offline and
      // someone else picked the work up), keep verification open by re-opening
      // the verifier slot — a claimant may never be left as their own verifier.
      // (See taskrules.ts; the verify handler tolerates the collision too.)
      if (verifierCollidesWithOwner(task.owner, task.verifier)) {
        task.verifier = undefined;
        task.verifierClient = undefined;
      }
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
      // Honor a designated verifier only when it differs from the owner; an
      // owner==verifier assignment can never be satisfied and must not lock
      // other agents out (taskrules.ts). The self-verify guard above still
      // bars the owner, so builder != verifier holds either way.
      const effVerifier = effectiveVerifier(task.owner, task.verifier);
      if (effVerifier && effVerifier !== name) {
        throw taskError('NotHostError', `Only the designated verifier (@${effVerifier}) can rule on ${task.id}.`);
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
      await requireHost(code, payload.hostKey as string | undefined, caller);
      const from = String(payload.from || '').trim();
      const to = String(payload.to || '').trim();
      const toClient = (payload.toClient as 'web' | 'cc') || 'cc';
      const room = await getRoom(client, code);
      const toRows = room.participants.filter((p) => p.name === to && p.client === toClient);
      if (toRows.length === 0) {
        throw taskError('BadRequestError', `reassign target @${to} (${toClient}) is not a participant in this room`);
      }
      if (toRows.length > 1) {
        throw taskError('BadRequestError', `reassign target @${to} (${toClient}) is ambiguous: ${toRows.length} rows share it`);
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

// ---------- owner questions ----------

function roomQuestionsKey(code: string): string {
  return `room-questions:${code}`;
}

async function listRoomQuestions(code: string): Promise<RoomQuestion[]> {
  const rows = await redis.lrange(roomQuestionsKey(code), 0, -1);
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row) as RoomQuestion];
    } catch {
      return [];
    }
  });
}

async function appendRoomQuestion(code: string, question: RoomQuestion): Promise<void> {
  const key = roomQuestionsKey(code);
  await redis.rpush(key, JSON.stringify(question));
  await redis.expire(key, ROOM_TTL_SECONDS);
}

async function answerStoredRoomQuestion(
  code: string,
  id: string,
  value: unknown,
  answeredBy: string,
): Promise<RoomQuestion> {
  const key = roomQuestionsKey(code);
  const questions = await listRoomQuestions(code);
  const index = questions.findIndex(question => question.id === id);
  if (index < 0) throw taskError('RoomNotFoundError', `Question ${id || '(missing)'} not found.`);
  const answered = answerRoomQuestion(questions[index]!, value, answeredBy, nowMs());
  await redis.lset(key, index, JSON.stringify(answered));
  await redis.expire(key, ROOM_TTL_SECONDS);
  return answered;
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
  if (safePath === '/' || safePath === '' || extname(filePath) === '') {
    // Extension-less paths are SPA navigation routes: serve the app shell.
    filePath = join(WEB_DIST, 'index.html');
  } else if (!existsSync(filePath)) {
    // T-115: a missing FILE must 404. The old fallback served index.html for
    // ANY missing path, so a stale /assets/*.js or an unregistered /sw.js got
    // an HTML body under a script URL: the browser executes it, dies on '<'
    // as a syntax error, and the user sees a traceless white screen (this bit
    // the first T-118 deploy). 404 is loud, cacheable-safe, and honest.
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
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
        return sendJson(res, 200, redactRoomPayload(await handleRoomAction(payload, roomCaller)));
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

    // Summon Agent — forward owner-authenticated requests to the loopback
    // agent-summoner service (deploy/summoner), which spawns/kills/tracks the
    // CLI agents. Kept out of this process so summoning can't destabilize the
    // room server and so quorum can reuse the same service.
    if (path === '/api/summon' || path.startsWith('/api/summon/')) {
      const summonCaller = await resolveCaller(req);
      if (summonCaller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const SUMMONER = process.env.SUMMONER_URL || 'http://127.0.0.1:8219';
      const routeMap: Record<string, string> = {
        'GET /api/summon/workspaces': '/workspaces',
        'GET /api/summon/providers': '/providers',
        'GET /api/summon/agents': '/agents',
        'POST /api/summon': '/summon',
        'POST /api/summon/dismiss': '/dismiss',
        'POST /api/summon/relaunch': '/relaunch',
        'POST /api/summon/resummon': '/resummon',
      };
      const target = routeMap[`${req.method} ${path}`];
      if (!target) return sendJson(res, 404, { error: 'NotFound', message: 'unknown summon route' });
      try {
        const init: RequestInit = { method: req.method };
        if (req.method === 'POST') {
          init.headers = { 'content-type': 'application/json' };
          init.body = await readBody(req);
        }
        const upstream = await fetch(SUMMONER + target + url.search, init);
        const text = await upstream.text();
        res.writeHead(upstream.status, { 'content-type': 'application/json' });
        return res.end(text);
      } catch {
        return sendJson(res, 502, { error: 'SummonerUnavailable', message: 'the agent summoner service is not reachable' });
      }
    }

    // T-51: attachment upload — multipart in, MessageAttachment out, stored on
    // local disk (self-host has no Vercel Blob). Access-gated.
    if (path === '/api/upload' && req.method === 'POST') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const ct = String(req.headers['content-type'] || '');
      if (!/multipart\/form-data/i.test(ct)) return sendJson(res, 400, { error: 'bad_request', message: 'expected multipart/form-data' });
      let raw: Buffer;
      try {
        raw = await readRawBody(req);
      } catch {
        return sendJson(res, 413, { error: 'file_too_large', message: 'Upload exceeds the size limit.' });
      }
      let parsed;
      try {
        parsed = parseMultipart(raw, ct);
      } catch {
        return sendJson(res, 400, { error: 'bad_request', message: 'malformed multipart body' });
      }
      const code = canonicalizeCode(String(parsed.fields.roomCode || ''));
      if (!code) return sendJson(res, 400, { error: 'bad_request', message: 'missing or invalid roomCode' });
      const file = parsed.files.find((f) => f.field === 'file') ?? parsed.files[0];
      if (!file) return sendJson(res, 400, { error: 'no_file', message: 'no file part in upload' });
      if (file.data.length === 0) return sendJson(res, 400, { error: 'empty_file', message: 'the file is empty' });
      if (file.data.length > MAX_ATTACHMENT_BYTES) return sendJson(res, 413, { error: 'file_too_large', message: 'Attachment exceeds the 10 MB limit.' });
      const mime = (file.contentType.split(';')[0] || '').trim().toLowerCase();
      if (!isAllowedMime(mime)) return sendJson(res, 415, { error: 'mime_not_allowed', message: `Unsupported file type: ${mime || file.filename}` });
      const stored = saveBlob(code, file.data, mime);
      const width = Number(parsed.fields.width);
      const height = Number(parsed.fields.height);
      const attachment: MessageAttachment = {
        id: stored.key,
        type: attachmentKind(mime),
        url: stored.url,
        storageKey: `${code}/${stored.key}`,
        name: file.filename || stored.key,
        size: stored.size,
        mime,
        uploadedAt: Date.now(),
        ...(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : {}),
      };
      return sendJson(res, 200, attachment);
    }

    // T-131: local speech-to-text for silent, continuous dictation. The client
    // checks status first so it can fall back to the built-in engine when the
    // local one is not installed, rather than recording into a dead endpoint.
    if (path === '/api/transcribe/status' && req.method === 'GET') {
      const s = await engineStatus();
      return sendJson(res, 200, { ok: s.ok, engine: s.ok ? 'whisper-local' : 'none', reason: s.reason });
    }
    // Transcription model selector (Settings): choose the local Whisper model.
    // Bigger = more accurate, a touch slower. Stored in a config file the
    // whisper-launch wrapper reads; changing it restarts the whisper service.
    if (path === '/api/transcribe/model' && (req.method === 'GET' || req.method === 'POST')) {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const whisperDir = join(homedir(), '.cache', 'whisper');
      const cfgPath = join(homedir(), '.agent-room', 'whisper-model');
      const catalog = [
        { id: 'ggml-base.en.bin', label: 'Fast (base)', note: 'quickest, lower accuracy', sizeMB: 148 },
        { id: 'ggml-small.en.bin', label: 'Balanced (small)', note: 'good accuracy, fast', sizeMB: 466 },
        { id: 'ggml-medium.en.bin', label: 'Best (medium)', note: 'highest accuracy', sizeMB: 1500 },
      ];
      const readCurrent = () => {
        try { const c = readFileSync(cfgPath, 'utf8').trim(); if (c) return c; } catch { /* default below */ }
        return 'ggml-medium.en.bin';
      };
      if (req.method === 'GET') {
        const available = catalog.map(m => ({ ...m, downloaded: existsSync(join(whisperDir, m.id)) }));
        return sendJson(res, 200, { current: readCurrent(), available });
      }
      // POST — switch the model.
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(await readBody(req)); } catch { /* empty */ }
      const model = String(body.model || '');
      const entry = catalog.find(m => m.id === model);
      if (!entry) return sendJson(res, 400, { error: 'bad_model', message: 'unknown transcription model' });
      if (!existsSync(join(whisperDir, model))) {
        return sendJson(res, 409, { error: 'not_downloaded', message: `${entry.label} isn't downloaded on this machine yet.` });
      }
      try { mkdirSync(dirname(cfgPath), { recursive: true }); } catch { /* exists */ }
      writeFileSync(cfgPath, model);
      // Restart whisper so the wrapper re-reads the model (best-effort).
      try { execFile('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid?.() ?? 0}/com.wakilabs.whisper`], () => {}); } catch { /* non-fatal */ }
      return sendJson(res, 200, { current: model, restarted: true });
    }
    if (path === '/api/transcribe' && req.method === 'POST') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      if (computeRateLimited(computeCallerKey(caller), nowMs())) return sendJson(res, 429, { error: 'rate_limited', message: 'Too many requests, slow down.' });
      let raw: Buffer;
      try {
        raw = await readRawBody(req);
      } catch {
        return sendJson(res, 413, { error: 'file_too_large', message: 'Audio segment exceeds the size limit.' });
      }
      if (!raw || raw.length === 0) return sendJson(res, 400, { error: 'empty', message: 'no audio in body' });
      const result = await transcribeSegment(raw);
      if (!result.ok) {
        // 422 = this segment can never succeed (undecodable) -> client drops it
        // and drains past. 503 = transient (engine down) -> client keeps the
        // segment buffered and retries.
        const status = result.permanent ? 422 : 503;
        const error = result.permanent ? 'bad_segment' : 'engine_unavailable';
        return sendJson(res, status, { error, engine: 'none', text: '', reason: result.reason });
      }
      return sendJson(res, 200, { text: result.text, engine: result.engine });
    }

    // T-134: assemble the owner brief server-side from real messages + the
    // account read marker + the board, so the client just renders and speaks.
    if (path === '/api/brief' && req.method === 'GET') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      const code = canonicalizeCode(String(url.searchParams.get('code') || ''));
      if (!code) return sendJson(res, 400, { error: 'bad_request', message: 'missing or invalid code' });
      const self = String(url.searchParams.get('self') || '');
      let firstUnreadIndex: number | null = null;
      try {
        const account = resolveMarkerAccount(caller, url.searchParams.get('account'));
        const markers = await listReadMarkers(redis, account);
        firstUnreadIndex = code in markers ? markers[code] ?? null : null;
      } catch { firstUnreadIndex = null; } // no account/marker -> first-visit framing
      const messages = await listMessages(client, code, 0);
      const board = await getTaskBoard(code);
      const briefMessages = (messages as Array<{ name?: string; text?: string }>).map((m) => ({ name: String(m.name || ''), text: m.text }));
      const briefTasks = board.tasks.map((t) => ({ id: t.id, title: t.title, state: t.state, owner: t.owner, verifier: t.verifier }));
      // T-134 legacy shape (still consumed by the header button during transition).
      const lines = buildOwnerBrief({ selfName: self, firstUnreadIndex, messages: briefMessages, tasks: briefTasks });
      // T-139: the agreed protocol brief — server-composed, honest by construction,
      // with display + speech renderings. `mode=deep` expands; `topic` scopes it.
      const mode = url.searchParams.get('mode') === 'deep' ? 'deep' : 'default';
      const topic = url.searchParams.get('topic')?.trim() || undefined;
      const brief = composeBrief({ selfName: self, firstUnreadIndex, messages: briefMessages, tasks: briefTasks, mode, topic });
      return sendJson(res, 200, { lines, speech: briefToSpeech(lines), brief });
    }

    // T-134: local text-to-speech for the owner brief's speaker button.
    if (path === '/api/tts' && req.method === 'POST') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      if (computeRateLimited(computeCallerKey(caller), nowMs())) return sendJson(res, 429, { error: 'rate_limited', message: 'Too many requests, slow down.' });
      let text = '';
      try {
        const body = JSON.parse(await readBody(req)) as { text?: unknown };
        text = typeof body.text === 'string' ? body.text : '';
      } catch {
        return sendJson(res, 400, { error: 'bad_request', message: 'expected JSON { text }' });
      }
      const result = await synthesize(text);
      if (!result.ok || !result.audio) return sendJson(res, 503, { error: 'tts_unavailable', reason: result.reason });
      res.writeHead(200, { 'content-type': result.mime || 'audio/mpeg', 'content-length': String(result.audio.length), 'cache-control': 'no-store' });
      res.end(result.audio);
      return;
    }

    if (path === '/api/delete-room-blobs' && req.method === 'POST') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      let payload: { roomCode?: string };
      try {
        payload = JSON.parse(await readBody(req)) as { roomCode?: string };
      } catch {
        return sendJson(res, 400, { error: 'bad_request', message: 'invalid JSON body' });
      }
      const code = canonicalizeCode(String(payload.roomCode || ''));
      if (!code) return sendJson(res, 400, { error: 'bad_request', message: 'invalid roomCode' });
      return sendJson(res, 200, { deleted: deleteRoomBlobs(code) });
    }

    // T-123: one-time signed download URL for the large-file path. Self-
    // authorizing (the HMAC token carries the room/attachment/participant
    // claims); no Access cookie required, so an agent can follow it directly.
    // Single-use: a consumed nonce is rejected on replay. Never logged.
    if (path === '/dl' && req.method === 'GET') {
      const token = url.searchParams.get('token') || '';
      const nowDl = Date.now();
      // Prune expired nonces opportunistically.
      for (const [n, exp] of consumedDownloadNonces) if (exp < nowDl) consumedDownloadNonces.delete(n);
      let claims: SignedTokenClaims;
      try {
        claims = verifyDownloadToken(ATTACHMENT_SIGN_SECRET, token, nowDl);
      } catch (e) {
        const code = e instanceof AttachmentDownloadError ? e.code : 'bad_request';
        return sendJson(res, code === 'expired' ? 410 : 400, { error: code, message: 'Invalid or expired download token.' });
      }
      if (consumedDownloadNonces.has(claims.nonce)) {
        attachmentAudit({ room: claims.code, attachmentId: claims.attachmentId, participant: claims.participant, op: 'download-url-follow', bytes: 0, outcome: 'replayed' });
        return sendJson(res, 410, { error: 'replayed', message: 'This download link has already been used.' });
      }
      consumedDownloadNonces.set(claims.nonce, claims.exp);
      const blob = readBlob(claims.code, claims.storageKey);
      if (!blob) {
        attachmentAudit({ room: claims.code, attachmentId: claims.attachmentId, participant: claims.participant, op: 'download-url-follow', bytes: 0, outcome: 'not_found' });
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
      }
      attachmentAudit({ room: claims.code, attachmentId: claims.attachmentId, participant: claims.participant, op: 'download-url-follow', bytes: blob.data.length, outcome: 'ok' });
      res.writeHead(200, {
        'Content-Type': mimeForExt(blob.ext),
        'Content-Length': String(blob.data.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'attachment',
      });
      res.end(blob.data);
      return;
    }

    // T-51: serve a stored attachment. Access-gated (only signed-in users can
    // fetch), and hardened against the fact that we accept svg/html: a strict
    // sandbox CSP + nosniff neutralizes any active content on direct
    // navigation, while <img> embedding of images still works.
    if (path.startsWith('/blobs/') && req.method === 'GET') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const parts = path.split('/');
      const blob = readBlob(decodeURIComponent(parts[2] || ''), decodeURIComponent(parts[3] || ''));
      if (!blob) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mimeForExt(blob.ext),
        'Content-Length': String(blob.data.length),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Content-Disposition': 'inline',
      });
      res.end(blob.data);
      return;
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

    // ---------- T-118: owner push channel ----------
    if (path === '/api/push/vapid-public-key' && req.method === 'GET') {
      if (!pushEnabled()) return sendJson(res, 503, { error: 'push_disabled' });
      return sendJson(res, 200, { publicKey: vapidPublicKey() });
    }
    if (path === '/api/push/subscribe' && req.method === 'POST') {
      if (!pushEnabled()) return sendJson(res, 503, { error: 'push_disabled' });
      const caller = await resolveCaller(req);
      // Access-authenticated users register for their own account; trusted
      // local tooling may register for the owner account (receipt harnesses).
      const email = caller.kind === 'user' ? caller.email : caller.kind === 'local' ? ownerEmail() : null;
      if (!email) return sendJson(res, 401, { error: 'unauthorized' });
      let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
      const sub = body.subscription;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys.auth) {
        return sendJson(res, 400, { error: 'subscription must carry endpoint and keys' });
      }
      const current = await pushStore.read(email);
      await pushStore.write(email, upsertSubscription(current, sub as never, Date.now()));
      return sendJson(res, 200, { registered: true, devices: current.length + 1 });
    }
    if (path === '/api/push/test' && req.method === 'POST') {
      if (!pushEnabled()) return sendJson(res, 503, { error: 'push_disabled' });
      const caller = await resolveCaller(req);
      const email = caller.kind === 'user' ? caller.email : caller.kind === 'local' ? ownerEmail() : null;
      if (!email) return sendJson(res, 401, { error: 'unauthorized' });
      const outcome = await sendToAccount(pushStore, email, {
        title: 'WakiChat test notification',
        body: 'The notification pipe works end to end on this device.',
        url: '/',
        tag: 'push-test',
      });
      return sendJson(res, 200, outcome);
    }
    if (path === '/api/push/prefs' && (req.method === 'GET' || req.method === 'POST')) {
      if (!pushEnabled()) return sendJson(res, 503, { error: 'push_disabled' });
      const caller = await resolveCaller(req);
      // Same auth bar as /api/push/subscribe: users act on their own account,
      // trusted local tooling acts for the owner, anonymous gets nothing.
      const email = caller.kind === 'user' ? caller.email : caller.kind === 'local' ? ownerEmail() : null;
      if (!email) return sendJson(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET') {
        return sendJson(res, 200, { level: await readNotifyLevel(email) });
      }
      let body: { level?: unknown };
      try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
      if (body.level !== 'all' && body.level !== 'mentions') {
        return sendJson(res, 400, { error: "level must be 'mentions' or 'all'" });
      }
      const level = normalizeNotifyLevel(body.level);
      await writeNotifyLevel(email, level);
      return sendJson(res, 200, { level });
    }

    if (path === '/api/rooms' && req.method === 'GET') {
      const roomsCaller = await resolveCaller(req);
      if (roomsCaller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      await ensureRoomActivityIndex();
      const page = await listIndexedRoomPage(
        roomListStore,
        roomListCursor(url.searchParams.get('cursor')),
        roomListLimit(url.searchParams.get('limit')),
      );
      return sendJson(res, 200, page);
    }

    // ---------- T-59: the search behind the command bar's ⌘K field ----------
    // Rooms always; messages + tasks only when a room code is given, so every
    // request stays bounded. Hits carry deep-link ids and never credentials.
    if (path === '/api/search' && req.method === 'GET') {
      const searchCaller = await resolveCaller(req);
      if (searchCaller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const q = String(url.searchParams.get('q') ?? '').trim();
      if (q.length < SEARCH_MIN_QUERY) return sendJson(res, 200, { query: q, hits: [] });
      await ensureRoomActivityIndex();
      const page = await listIndexedRoomPage(roomListStore, 0, 100);
      const hits = searchRooms(page.rooms, q);
      const roomParam = url.searchParams.get('room');
      const roomCode = roomParam ? canonicalizeCode(roomParam) : null;
      if (roomCode) {
        try {
          // Bounded Redis transfer (T-59 review): fetch ONLY the newest search
          // window, not the whole list — the cursor anchors to the absolute
          // counter so LTRIMmed history cannot desync it.
          const total = await getMessageTotalCount(client, roomCode);
          const from = Math.max(0, total - SEARCH_MESSAGE_WINDOW);
          const [messages, board] = await Promise.all([
            listMessages(client, roomCode, from),
            getTaskBoard(roomCode),
          ]);
          hits.push(...searchMessages(messages, q, roomCode));
          hits.push(...searchTasks(board.tasks ?? [], q, roomCode));
        } catch { /* unknown/expired room: room-topic hits still return */ }
      }
      hits.sort((a, b) => b.score - a.score);
      return sendJson(res, 200, { query: q, hits });
    }

    // ---------- T-71: durable produced-work index (never window-dependent) ----------
    if (path === '/api/artifacts' && req.method === 'GET') {
      const caller = await resolveCaller(req);
      if (caller.kind === 'anonymous') return sendJson(res, 401, { error: 'Unauthorized', message: 'Sign in required.' });
      const roomParam = url.searchParams.get('room');
      const roomCode = roomParam ? canonicalizeCode(roomParam) : null;
      if (!roomCode) return sendJson(res, 400, { error: 'BadRequest', message: 'room is required.' });
      try {
        const { pending } = await ensureArtifactIndex(client, roomCode);
        if (pending) {
          // A concurrent rebuild holds the lock: the client must stay in
          // Loading — an empty list here would be a false zero (rev16).
          return sendJson(res, 200, { artifacts: [], backfillPending: true });
        }
        const artifacts = await listRoomArtifacts(client, roomCode);
        return sendJson(res, 200, { artifacts, backfillPending: false });
      } catch (e) {
        const err = e as Error;
        return sendJson(res, statusForError(err), { error: err.name, message: err.message });
      }
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
      const healthy = pong === 'PONG';
      return sendJson(res, healthy ? 200 : 500, lifecycleDiscovery(PUBLIC_ORIGIN, healthy));
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
