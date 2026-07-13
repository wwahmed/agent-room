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
  const out = await call<{ room: Room; participant: Participant }>({
    action: 'join',
    code,
    participant,
    priorIdentity: options.priorIdentity,
    hostKey: options.hostKey ?? storedHostKey(code),
  });
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
  await call({ action: 'updatePresence', code, name, at });
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
  return (await call<{ result: AppendResult }>({ action: 'send', code, message })).result;
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
