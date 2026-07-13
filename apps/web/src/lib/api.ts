import type {
  ClientKind,
  Message,
  Participant,
  ReplyMode,
  ReplyModeConfig,
  RoleInTurn,
  Room,
  RoomReport,
} from '@agent-room/shared';

// T-12: the browser's ONLY data channel. Every room/message/report
// operation is a JSON POST to same-origin /api/room; the server owns
// Redis and enforces the Cloudflare Access identity on every call. No
// Redis client, protocol, or credential exists in this bundle — the old
// @agent-room/upstash-client import is banned from apps/web (the server
// still uses it, on the other side of the auth boundary).
//
// Function names and shapes intentionally mirror the old upstash-client
// surface so the screens/hooks swapped over with an import change plus
// a handful of host-auth params.

export interface ApiClient {
  readonly kind: 'same-origin';
}

/** Kept for call-site compatibility; carries no credential or config. */
export function createClient(): ApiClient {
  return { kind: 'same-origin' };
}

export class RoomNotFoundError extends Error {
  constructor(message = 'Room not found') {
    super(message);
    this.name = 'RoomNotFoundError';
  }
}

export class HostNameTakenError extends Error {
  constructor(message = 'That name belongs to the host.') {
    super(message);
    this.name = 'HostNameTakenError';
  }
}

export class ApiError extends Error {
  constructor(name: string, message: string, readonly status: number) {
    super(message);
    this.name = name || 'ApiError';
  }
}

// Mirrors packages/upstash-client/src/turnState.ts. Copied (not imported)
// so the web bundle keeps zero dependency on the Redis client package.
export interface TurnQueueEntry {
  name: string;
  client: ClientKind;
  role: RoleInTurn;
}

export interface TurnSpokenEntry {
  name: string;
  client: ClientKind;
  role: RoleInTurn;
  status: string;
  at: number;
}

export interface TurnState {
  turnId: number;
  mode: ReplyMode;
  leadName?: string;
  leadClient?: ClientKind;
  moderatorName?: string;
  moderatorClient?: ClientKind;
  currentName?: string;
  currentClient?: ClientKind;
  currentRole?: RoleInTurn;
  deadline?: number;
  leadGraceUntil?: number;
  queue: TurnQueueEntry[];
  spoken: TurnSpokenEntry[];
  hostDirected?: Array<{
    name: string;
    client: ClientKind;
    addedAt: number;
    source?: 'host' | 'moderator';
  }>;
}

export interface AppendResult {
  appended: boolean;
  reason?: string;
  metadata?: Message['metadata'];
}

interface HostAuth {
  requesterName?: string;
  hostKey?: string | null;
}

function storedHostKey(code: string): string | undefined {
  try {
    return (
      localStorage.getItem(`room:${code}:hostKey`) ??
      sessionStorage.getItem(`room:${code}:hostKey`) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

// T-30 (F2): the one-time member credential the server issues at join. Kept
// per-tab in sessionStorage; presented on every send/presence so a display
// name alone cannot authenticate.
function storedMemberKey(code: string): string | undefined {
  try {
    return sessionStorage.getItem(`room:${code}:memberKey`) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeMemberKey(code: string, key: string | undefined): void {
  try {
    if (key) sessionStorage.setItem(`room:${code}:memberKey`, key);
  } catch { /* private mode */ }
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  let body: { error?: string; message?: string } & Record<string, unknown> = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // non-JSON error body; fall through to the status-based error
  }
  if (!res.ok) {
    const name = String(body.error || '');
    const message = String(body.message || body.error || `Request failed (${res.status})`);
    if (name === 'RoomNotFoundError') throw new RoomNotFoundError(message);
    if (name === 'HostNameTakenError') throw new HostNameTakenError(message);
    throw new ApiError(name, message, res.status);
  }
  return body as T;
}

// ---------- T-37: self-healing member credential ----------
//
// Both send and updatePresence present the per-tab memberKey. That key can go
// stale (a new tab with empty sessionStorage, a reload after the row was
// re-keyed, or the strict-auth cutover invalidating a pre-cutover key), and the
// server then answers MemberAuthError. Previously the presence heartbeat
// swallowed that (`.catch(()=>{})`) so a keyed user silently showed offline.
//
// Recovery: on a MemberAuthError, re-join WITH priorIdentity (which reclaims the
// same row without a "(2)" suffix and re-issues a fresh memberKey), store the
// new key, and retry the call once. The self participant captured at join time
// is what lets us re-mint without threading identity through every caller.
// The plaintext key is never logged or thrown — only stored.

function storedSelf(code: string): Participant | undefined {
  try {
    const raw = sessionStorage.getItem(`room:${code}:self`);
    return raw ? (JSON.parse(raw) as Participant) : undefined;
  } catch {
    return undefined;
  }
}

function storeSelf(code: string, participant: Participant): void {
  try {
    sessionStorage.setItem(`room:${code}:self`, JSON.stringify(participant));
  } catch { /* private mode */ }
}

function isMemberAuthError(e: unknown): boolean {
  return e instanceof ApiError && e.name === 'MemberAuthError';
}

// Dedupe concurrent recovery: 18 heartbeats failing at once must trigger ONE
// re-mint, not 18 re-joins.
const reminting = new Map<string, Promise<boolean>>();

function remintMemberKey(code: string): Promise<boolean> {
  const inflight = reminting.get(code);
  if (inflight) return inflight;
  const p = (async () => {
    const self = storedSelf(code);
    if (!self) return false; // no captured identity → can't re-mint; fail closed
    try {
      const out = await call<{ memberKey?: string }>({
        action: 'join',
        code,
        participant: self,
        // reclaim THIS row (no suffix) and re-issue the credential
        priorIdentity: { name: self.name, client: self.client },
        wantMemberKey: true,
      });
      if (out.memberKey) {
        storeMemberKey(code, out.memberKey);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  })();
  reminting.set(code, p);
  return p.finally(() => reminting.delete(code));
}

// Run a keyed request; on MemberAuthError, re-mint the credential once and retry
// with the fresh key. `build` is re-invoked so the retry reads the NEW key.
async function keyedCall<T>(build: (memberKey: string | undefined) => Record<string, unknown>, code: string): Promise<T> {
  try {
    return await call<T>(build(storedMemberKey(code)));
  } catch (e) {
    if (!isMemberAuthError(e)) throw e;
    const recovered = await remintMemberKey(code);
    if (!recovered) throw e; // fail closed — surface the auth error
    return await call<T>(build(storedMemberKey(code)));
  }
}

// ---------- rooms ----------

export interface CreateRoomInput {
  /** Ignored: the server allocates the room code. Kept for shape parity. */
  code?: string;
  topic: string;
  createdBy: string;
  /** T-18: registry project id; required by the web create form. */
  projectId?: string;
}

export async function createRoom(
  _client: ApiClient,
  input: CreateRoomInput,
): Promise<Room & { hostKey: string }> {
  const out = await call<{ room: Room; hostKey: string }>({
    action: 'create',
    topic: input.topic,
    createdBy: input.createdBy,
    projectId: input.projectId,
  });
  return { ...out.room, hostKey: out.hostKey };
}

export async function getRoom(_client: ApiClient, code: string): Promise<Room> {
  return (await call<{ room: Room }>({ action: 'get', code })).room;
}

export interface JoinRoomOptions {
  priorIdentity?: { name: string; client: ClientKind };
  hostKey?: string;
}

export async function joinRoom(
  _client: ApiClient,
  code: string,
  participant: Participant,
  options: JoinRoomOptions = {},
): Promise<{ participant: Participant } & Omit<Room, never>> {
  const out = await call<{ room: Room; participant: Participant; memberKey?: string }>({
    action: 'join',
    code,
    participant,
    priorIdentity: options.priorIdentity,
    hostKey: options.hostKey ?? storedHostKey(code),
    // T-30 (F2): ask the origin to mint a member credential for this row.
    wantMemberKey: true,
  });
  storeMemberKey(code, out.memberKey);
  // T-37: remember the final (possibly suffixed) row identity so a later
  // credential re-mint can reclaim THIS row via priorIdentity.
  storeSelf(code, out.participant);
  return { ...out.room, participant: out.participant };
}

export async function verifyHostKey(
  _client: ApiClient,
  code: string,
  hostKey: string | undefined,
): Promise<void> {
  await call({ action: 'verifyHostKey', code, hostKey });
}

export async function setMuted(
  _client: ApiClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: ClientKind,
  muted: boolean,
): Promise<Room> {
  const out = await call<{ room: Room }>({
    action: 'setMuted',
    code,
    requesterName,
    targetName,
    targetClient,
    muted,
  });
  return out.room;
}

export async function setReplyMode(
  _client: ApiClient,
  code: string,
  requesterName: string,
  mode: ReplyMode,
  config?: ReplyModeConfig,
): Promise<Room> {
  const out = await call<{ room: Room }>({
    action: 'setReplyMode',
    code,
    requesterName,
    hostKey: storedHostKey(code),
    mode,
    config,
  });
  return out.room;
}

export async function removeParticipant(
  _client: ApiClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: ClientKind,
): Promise<Room> {
  const out = await call<{ room: Room }>({
    action: 'removeParticipant',
    code,
    requesterName,
    targetName,
    targetClient,
  });
  return out.room;
}

export async function endRoom(_client: ApiClient, code: string, auth: HostAuth = {}): Promise<Room> {
  const out = await call<{ room: Room }>({
    action: 'end',
    code,
    requesterName: auth.requesterName,
    hostKey: auth.hostKey ?? storedHostKey(code),
  });
  return out.room;
}

export async function reactivateRoom(
  _client: ApiClient,
  code: string,
  auth: HostAuth = {},
): Promise<Room> {
  const out = await call<{ room: Room }>({
    action: 'reactivate',
    code,
    requesterName: auth.requesterName,
    hostKey: auth.hostKey ?? storedHostKey(code),
  });
  return out.room;
}

export async function updatePresence(
  _client: ApiClient,
  code: string,
  name: string,
  at: number,
): Promise<void> {
  // T-37: presents the current memberKey and self-heals a stale/absent one.
  await keyedCall(mk => ({ action: 'updatePresence', code, name, at, memberKey: mk }), code);
}

// ---------- messages ----------

export async function listMessages(
  _client: ApiClient,
  code: string,
  fromIndex: number,
): Promise<Message[]> {
  return (await call<{ messages: Message[] }>({ action: 'messages', code, cursor: fromIndex })).messages;
}

export async function getMessageTotalCount(
  _client: ApiClient,
  code: string,
): Promise<number | null> {
  return (await call<{ total: number | null }>({ action: 'messageCount', code })).total;
}

export async function appendMessage(
  _client: ApiClient,
  code: string,
  message: Message,
): Promise<AppendResult> {
  // T-30 (F2): present the member credential; a name alone no longer sends.
  // T-37: same self-healing recovery as presence, so a send never fails on a
  // recoverable stale key.
  return (await keyedCall<{ result: AppendResult }>(mk => ({ action: 'send', code, message, memberKey: mk }), code)).result;
}

export async function appendSystemMessage(
  _client: ApiClient,
  code: string,
  message: Message,
): Promise<void> {
  await call({ action: 'systemMessage', code, message });
}

// ---------- turn state ----------

export async function getTurnState(_client: ApiClient, code: string): Promise<TurnState | null> {
  return (await call<{ turnState: TurnState | null }>({ action: 'turnState', code })).turnState;
}

export async function hostSkipCurrent(
  _client: ApiClient,
  code: string,
  _room: Room,
  auth: HostAuth = {},
): Promise<TurnSpokenEntry | null> {
  const out = await call<{ skipped: TurnSpokenEntry | null }>({
    action: 'skipCurrent',
    code,
    requesterName: auth.requesterName,
    hostKey: auth.hostKey ?? storedHostKey(code),
  });
  return out.skipped;
}

export async function directInvoke(
  _client: ApiClient,
  code: string,
  target: { name: string; client: ClientKind },
  source: 'host' | 'moderator' = 'host',
  auth: HostAuth = {},
): Promise<boolean> {
  const out = await call<{ added: boolean }>({
    action: 'directInvoke',
    code,
    target,
    source,
    requesterName: auth.requesterName,
    hostKey: auth.hostKey ?? storedHostKey(code),
  });
  return out.added;
}

// ---------- reports ----------

export async function createRoomReport(
  _client: ApiClient,
  room: Room,
  _messages: Message[],
): Promise<RoomReport> {
  return (await call<{ report: RoomReport }>({ action: 'createReport', code: room.code })).report;
}

export async function getRoomReport(
  _client: ApiClient,
  code: string,
): Promise<RoomReport | null> {
  return (await call<{ report: RoomReport | null }>({ action: 'getReport', code })).report;
}

// ---------- projects (T-18) ----------

export interface ProjectSummary {
  id: string;
  name: string;
  docs: string[];
}

export interface BoardTask {
  id: string;
  title: string;
  state: 'todo' | 'in_progress' | 'awaiting_review' | 'done' | 'rejected';
  createdBy: string;
  owner?: string;
  ownerClient?: ClientKind;
  verifier?: string;
  dod?: string;
  note?: string;
  verifiedBy?: string;
  createdAt?: number;
  submittedAt?: number;
  verifiedAt?: number;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/projects', { credentials: 'same-origin' });
  if (!res.ok) return [];
  return ((await res.json()) as { projects?: ProjectSummary[] }).projects ?? [];
}

export interface ProjectCandidate {
  key: string; // server-issued opaque token
  dirName: string;
  suggestedId: string;
}

/** Git repos discovered under the server's scan roots — the safe creation path. */
export async function listProjectCandidates(): Promise<ProjectCandidate[]> {
  const res = await fetch('/api/project/candidates', { credentials: 'same-origin' });
  if (!res.ok) return [];
  return ((await res.json()) as { candidates?: ProjectCandidate[] }).candidates ?? [];
}

export async function createProject(key: string, id?: string, name?: string): Promise<ProjectSummary> {
  const res = await fetch('/api/project/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ key, id, name }),
  });
  const body = (await res.json().catch(() => ({}))) as { project?: ProjectSummary; error?: string; message?: string };
  if (!res.ok || !body.project) {
    throw new ApiError(String(body.error || 'ApiError'), String(body.message || `Create failed (${res.status})`), res.status);
  }
  return body.project;
}

export async function readProjectDoc(
  id: string,
  role: string,
): Promise<{ role: string; rel: string; content: string; truncated: boolean } | null> {
  const res = await fetch(`/api/project/doc?id=${encodeURIComponent(id)}&role=${encodeURIComponent(role)}`, { credentials: 'same-origin' });
  if (!res.ok) return null;
  return (await res.json()) as { role: string; rel: string; content: string; truncated: boolean };
}

export async function getTaskBoard(_client: ApiClient, code: string): Promise<{ tasks: BoardTask[] }> {
  return (await call<{ board: { tasks: BoardTask[] } }>({ action: 'taskBoard', code })).board;
}

export async function attachProject(
  _client: ApiClient,
  code: string,
  projectId: string,
  auth: HostAuth = {},
): Promise<{ room: Room; resumed: number }> {
  return await call<{ room: Room; resumed: number }>({
    action: 'attachProject',
    code,
    projectId,
    requesterName: auth.requesterName,
    hostKey: auth.hostKey ?? storedHostKey(code),
  });
}
