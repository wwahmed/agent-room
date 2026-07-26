import type { ParticipantHealth } from './presence.js';
import type {
  ClientKind,
  Message,
  Participant,
  ReplyMode,
  ReplyModeConfig,
  RoleInTurn,
  Room,
  RoomQuestion,
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

function storeHostKey(code: string, key: string): void {
  try {
    localStorage.setItem(`room:${code}:hostKey`, key);
  } catch {
    /* private mode: recovery still succeeds server-side this session */
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
  /** Local workspace path this room is based in; summoned agents inherit it. */
  workspace?: string;
  /** Room-template id (shared registry) — persisted on the room record so
   *  every joiner, human or agent, can read the room's type. */
  templateId?: string;
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
    workspace: input.workspace,
    templateId: input.templateId,
  });
  return { ...out.room, hostKey: out.hostKey };
}

/** Set (or clear with '') the room's type — host-only. Converting an existing
 *  room is just retagging it; the server announces the change in-room. */
export async function setRoomTemplateAction(_client: ApiClient, code: string, templateId: string, auth: HostAuth = {}): Promise<Room> {
  return (await call<{ room: Room }>({
    action: 'setTemplate', code, templateId, hostKey: auth.hostKey ?? storedHostKey(code),
  })).room;
}

/** Bind (or clear) the room's workspace — the source of truth agents inherit. */
export async function setRoomWorkspaceAction(_client: ApiClient, code: string, workspace: string, auth: HostAuth = {}): Promise<Room> {
  return (await call<{ room: Room }>({
    action: 'setWorkspace', code, workspace, hostKey: auth.hostKey ?? storedHostKey(code),
  })).room;
}

export async function getRoom(_client: ApiClient, code: string): Promise<Room> {
  return (await call<{ room: Room }>({ action: 'get', code })).room;
}

export async function renameRoom(_client: ApiClient, code: string, topic: string): Promise<Room> {
  const out = await call<{ room: Room }>({
    action: 'renameRoom',
    code,
    topic,
    hostKey: storedHostKey(code),
  });
  return out.room;
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
    // T-25 handshake: present the stored per-tab memberKey (if any) so the
    // server can reclaim THIS row by memberKeyHash on rejoin instead of
    // suffixing a duplicate. Forward-compatible — the pre-T-25 server ignores
    // this field; T-25's reclaim branch (a) matches it. Undefined on a fresh
    // tab, where the server falls back to the authenticated-identity anchor.
    memberKey: storedMemberKey(code),
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

// T-45 / T-36: one-tap host recovery. The armed server migrates the orphaned
// host identity onto Waqas's authenticated + keyed web session (the Access
// cookie proves who he is; the memberKey binds his live session). keyedCall
// self-heals a stale memberKey (T-37) and retries once. The returned hostKey is
// stored where storedHostKey() reads it and is NEVER returned to the caller or
// surfaced in the UI — we hand back only the count of migrated bindings.
export async function recoverHost(_client: ApiClient, code: string): Promise<{ migrated: number }> {
  const out = await keyedCall<{ recovered?: boolean; migrated?: string[]; hostKey?: string }>(
    (mk) => ({ action: 'recoverHost', code, memberKey: mk }),
    code,
  );
  if (out.hostKey) storeHostKey(code, out.hostKey);
  return { migrated: out.migrated?.length ?? 0 };
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
  // Host removal requires the room's host proof; self-removal requires the
  // caller's member proof. Send both through the keyed path so either branch
  // authenticates correctly and a stale self credential is repaired once.
  const out = await keyedCall<{ room: Room }>((memberKey) => ({
    action: 'removeParticipant',
    code,
    requesterName,
    targetName,
    targetClient,
    hostKey: storedHostKey(code),
    memberKey,
  }), code);
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
  limit?: number,
): Promise<Message[]> {
  // T-04: `limit` bounds the page for history paging; omitted = cursor-to-end.
  return (await call<{ messages: Message[] }>({ action: 'messages', code, cursor: fromIndex, ...(limit ? { limit } : {}) })).messages;
}

export async function getMessageTotalCount(
  _client: ApiClient,
  code: string,
): Promise<number | null> {
  return (await call<{ total: number | null }>({ action: 'messageCount', code })).total;
}

// T-68: the server's listen-loop health verdict (T-66). The web deliberately does
// NOT re-derive these states — one definition of "dead", server-side.
export async function fetchHealth(_client: ApiClient, code: string): Promise<ParticipantHealth[]> {
  const out = await call<{ health: ParticipantHealth[] }>({ action: 'health', code });
  return out.health ?? [];
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

// T-121: toggle an acknowledge/reject reaction. Same credential bar and
// self-healing retry as send. Returns the target's full post-change reaction
// list so the caller can patch the rendered message immediately (the sys
// event row confirms it for everyone else on the next poll).
export async function reactToMessage(
  _client: ApiClient,
  code: string,
  messageId: number,
  kind: 'ack' | 'reject',
  name: string,
): Promise<{ added: boolean; reactions: import('@agent-room/shared').MessageReaction[] }> {
  return (await keyedCall<{ result: { added: boolean; reactions: import('@agent-room/shared').MessageReaction[] } }>(
    mk => ({ action: 'react', code, messageId, kind, name, client: 'web', memberKey: mk }),
    code,
  )).result;
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

// ---------- owner questions ----------

export async function listOwnerQuestions(_client: ApiClient, code: string): Promise<RoomQuestion[]> {
  const out = await call<{ questions: RoomQuestion[] }>({
    action: 'questionList',
    code,
    hostKey: storedHostKey(code),
  });
  return out.questions;
}

export async function answerOwnerQuestion(
  _client: ApiClient,
  code: string,
  id: string,
  value: string | string[],
): Promise<RoomQuestion> {
  const out = await call<{ question: RoomQuestion }>({
    action: 'questionAnswer',
    code,
    id,
    value,
    hostKey: storedHostKey(code),
  });
  return out.question;
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

// T-71: the durable produced-work index — room-wide, independent of the
// loaded transcript window.
export async function getRoomArtifacts(_client: ApiClient, code: string): Promise<{ artifacts: import('@agent-room/shared').RoomArtifact[]; backfillPending?: boolean }> {
  const res = await fetch(`/api/artifacts?room=${encodeURIComponent(code)}`);
  if (!res.ok) throw new Error(`artifacts fetch failed (${res.status})`);
  return await res.json() as { artifacts: import('@agent-room/shared').RoomArtifact[]; backfillPending?: boolean };
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

// ---------- Summon Agent (proxied to the agent-summoner service) ----------
export interface SummonModelOption { id: string; label: string }
export interface SummonProvider {
  id: string; label: string; cli: string; available: boolean;
  defaultModel: string; note?: string; models: SummonModelOption[]; allowCustomModel?: boolean;
  account?: { loggedIn: boolean; email: string };
  accountReady?: boolean;
  setupCmd?: string;
}
export interface SummonWorkspaceItem { name: string; path: string; git: boolean; pkg: boolean }
export interface SummonWorkspaceGroup { group: string; items: SummonWorkspaceItem[] }
export interface SummonedAgent {
  agentId: string; name: string; role: string; provider: string; model: string;
  workspace: string; room: string; mode: string; status: string; health: string;
  tmuxSession: string; access: string[]; createdAt: number;
  account?: string; sessionId?: string; dismissedAt?: number; persistent?: boolean;
  /** Permission level (chat|edit|build) + a human label — what the agent can do. */
  accessLevel?: string; accessLabel?: string; native?: boolean;
}

/** All summoner records for a room, incl. dismissed (for join/leave history). */
export async function listRoomAgentHistory(code: string): Promise<SummonedAgent[]> {
  return (await listSummonedAgents()).filter((a) => a.room === code);
}

export async function summonProviders(refresh = false): Promise<SummonProvider[]> {
  const res = await fetch(`/api/summon/providers${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin' });
  if (!res.ok) return [];
  return ((await res.json()) as { providers?: SummonProvider[] }).providers ?? [];
}

export async function summonWorkspaces(): Promise<SummonWorkspaceGroup[]> {
  const res = await fetch('/api/summon/workspaces', { credentials: 'same-origin' });
  if (!res.ok) return [];
  return ((await res.json()) as { groups?: SummonWorkspaceGroup[] }).groups ?? [];
}

export async function listSummonedAgents(): Promise<SummonedAgent[]> {
  const res = await fetch('/api/summon/agents', { credentials: 'same-origin' });
  if (!res.ok) return [];
  return ((await res.json()) as { agents?: SummonedAgent[] }).agents ?? [];
}

export async function summonAgent(body: {
  room: string; provider: string; model: string; workspace: string; name: string; role: string; mode: string; persistent: boolean;
}): Promise<SummonedAgent> {
  const res = await fetch('/api/summon', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as { agent?: SummonedAgent; error?: string; message?: string };
  if (!res.ok || !j.agent) {
    throw new ApiError(String(j.error || 'ApiError'), String(j.message || `Summon failed (${res.status})`), res.status);
  }
  return j.agent;
}

// One-step "bring the agents back": re-summon every agent that was in this room
// (newest config per name), skipping any still alive. Returns the per-agent
// outcome so the caller can toast a summary.
export async function resummonRoomAgents(room: string): Promise<{ name: string; status: string }[]> {
  const res = await fetch('/api/summon/resummon', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ room }),
  });
  const j = (await res.json().catch(() => ({}))) as { agents?: { name: string; status: string }[]; error?: string; message?: string };
  if (!res.ok) throw new ApiError(String(j.error || 'ApiError'), String(j.message || `Resummon failed (${res.status})`), res.status);
  return j.agents ?? [];
}

// Change a summoned agent's permission level. Levels map to launch flags, so
// the summoner relaunches the agent (dismiss + summon, same config) at the
// new level; it drops from the room and returns within a few seconds.
export async function relaunchAgentWithMode(agentId: string, mode: 'chat' | 'edit' | 'build'): Promise<SummonedAgent> {
  const res = await fetch('/api/summon/relaunch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ agentId, mode }),
  });
  const j = (await res.json().catch(() => ({}))) as { agent?: SummonedAgent; error?: string; message?: string };
  if (!res.ok || !j.agent) {
    throw new ApiError(String(j.error || 'ApiError'), String(j.message || `Relaunch failed (${res.status})`), res.status);
  }
  return j.agent;
}

// The unified "Remove from room" verb: stop the summoner process when we
// manage one, then free the participant row. Either half alone is what used to
// confuse the host (× left the process running; Dismiss left a ghost row).
// Row removal is a silent server-side no-op when the row is already gone (the
// summoner's own leave() may have raced us), so double-removal is safe.
export interface RemoveAgentOutcome { dismissed: boolean; removedRow: boolean }
export async function removeAgentFromRoom(opts: {
  code: string;
  requesterName: string;
  targetName: string;
  targetClient: ClientKind;
  agentId?: string | null;
}): Promise<RemoveAgentOutcome> {
  let dismissed = false;
  if (opts.agentId) {
    // Summoner down ≠ abort: still free the row so the People pane is honest.
    try { await dismissSummonedAgent(opts.agentId); dismissed = true; } catch { /* best-effort */ }
  }
  let removedRow = false;
  try {
    await removeParticipant(createClient(), opts.code, opts.requesterName, opts.targetName, opts.targetClient);
    removedRow = true;
  } catch { /* row may already be gone or auth failed; caller reports outcome */ }
  return { dismissed, removedRow };
}

export async function dismissSummonedAgent(agentId: string, archived = false): Promise<void> {
  const res = await fetch('/api/summon/dismiss', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ agentId, archived }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(String(j.error || 'ApiError'), String(j.message || `Dismiss failed (${res.status})`), res.status);
  }
}

// ---------- Archive a room (reversible) ----------
export async function archiveRoomAction(_client: ApiClient, code: string, auth: HostAuth = {}): Promise<Room> {
  return (await call<{ room: Room }>({
    action: 'archiveRoom', code, hostKey: auth.hostKey ?? storedHostKey(code),
  })).room;
}

export async function unarchiveRoomAction(_client: ApiClient, code: string, auth: HostAuth = {}): Promise<Room> {
  return (await call<{ room: Room }>({
    action: 'unarchiveRoom', code, hostKey: auth.hostKey ?? storedHostKey(code),
  })).room;
}

// ---------- Transcription model selector (Settings) ----------
export interface TranscribeModelOption {
  id: string; label: string; note: string; sizeMB: number; downloaded: boolean;
}
export async function getTranscribeModel(): Promise<{ current: string; available: TranscribeModelOption[] }> {
  const res = await fetch('/api/transcribe/model', { credentials: 'same-origin' });
  if (!res.ok) return { current: '', available: [] };
  return (await res.json()) as { current: string; available: TranscribeModelOption[] };
}
export async function setTranscribeModel(model: string): Promise<void> {
  const res = await fetch('/api/transcribe/model', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(String(j.error || 'ApiError'), String(j.message || `Failed (${res.status})`), res.status);
  }
}
