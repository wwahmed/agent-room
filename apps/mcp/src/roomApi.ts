// HTTP client for the agent-room server API (`POST /api/room`).
//
// The MCP server used to talk to Upstash Redis directly, which meant the
// Redis REST token had to live in the environment of every machine running
// the npm package. agent-room is a single hosted backend, so that token is
// effectively a shared master credential — it must never leave the server.
// This module routes every room operation through the same `/api/room`
// endpoint the web client uses; the token now lives only in the Vercel
// deployment's server env.
//
// Base URL is overridable via AGENT_ROOM_BASE_URL (same env var
// uploadAttachment.ts already uses) so self-hosters can point at their own
// deploy.

import type {
  Message,
  Participant,
  RemovalRecord,
  ReplyMode,
  ReplyModeConfig,
  Room,
  RoomQuestion,
  RoomQuestionMode,
  RoomReport,
} from '@agent-room/shared';
import type { AppendResult, TurnState, TurnSpokenEntry } from '@agent-room/upstash-client';

// Errors reconstructed from the API response body. The server serializes
// thrown errors as `{ error: <ErrorName>, message }`; we re-hydrate the few
// the MCP tool handlers branch on so existing `instanceof` checks keep
// working after the transport swap.
export class RoomApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RoomApiError';
    this.status = status;
  }
}
export class RoomNotFoundError extends Error { constructor(m: string) { super(m); this.name = 'RoomNotFoundError'; } }
export class HostNameTakenError extends Error { constructor(m: string) { super(m); this.name = 'HostNameTakenError'; } }
export class InterviewRoomBusyError extends Error { constructor(m: string) { super(m); this.name = 'InterviewRoomBusyError'; } }
export class MutedError extends Error { constructor(m: string) { super(m); this.name = 'MutedError'; } }
export class ViewerError extends Error { constructor(m: string) { super(m); this.name = 'ViewerError'; } }
export class NotYourTurnError extends Error { constructor(m: string) { super(m); this.name = 'NotYourTurnError'; } }
export class NotHostError extends Error { constructor(m: string) { super(m); this.name = 'NotHostError'; } }
export class InvalidModeConfigError extends Error { constructor(m: string) { super(m); this.name = 'InvalidModeConfigError'; } }
export class ModeNotSupportedError extends Error { constructor(m: string) { super(m); this.name = 'ModeNotSupportedError'; } }

function errorFromBody(error: string | undefined, message: string, status: number): Error {
  switch (error) {
    case 'RoomNotFoundError': return new RoomNotFoundError(message);
    case 'HostNameTakenError': return new HostNameTakenError(message);
    case 'InterviewRoomBusyError': return new InterviewRoomBusyError(message);
    case 'MutedError': return new MutedError(message);
    case 'ViewerError': return new ViewerError(message);
    case 'NotYourTurnError': return new NotYourTurnError(message);
    case 'NotHostError': return new NotHostError(message);
    case 'InvalidModeConfigError': return new InvalidModeConfigError(message);
    case 'ModeNotSupportedError': return new ModeNotSupportedError(message);
    default: return new RoomApiError(message, status);
  }
}

function apiEndpoint(): string {
  const base = (process.env.AGENT_ROOM_BASE_URL ?? 'https://www.agent-room.com').replace(/\/$/, '');
  return `${base}/api/room`;
}

export interface RoomApiClient {
  post<T>(payload: Record<string, unknown>): Promise<T>;
}

export function createRoomApiClient(): RoomApiClient {
  const endpoint = apiEndpoint();
  return {
    async post<T>(payload: Record<string, unknown>): Promise<T> {
      let resp: Response;
      try {
        resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'network failure';
        throw new RoomApiError(`POST ${endpoint} failed: ${msg}`, 0);
      }
      const body = (await resp.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        [k: string]: unknown;
      };
      if (!resp.ok) {
        throw errorFromBody(body.error, body.message ?? `Room API failed (${resp.status})`, resp.status);
      }
      return body as T;
    },
  };
}

export async function createRoom(
  client: RoomApiClient,
  input: { topic: string; createdBy: string },
): Promise<Room & { hostKey: string }> {
  const body = await client.post<{ room: Room & { hostKey: string }; hostKey: string }>({
    action: 'create',
    topic: input.topic,
    createdBy: input.createdBy,
  });
  return { ...body.room, hostKey: body.hostKey };
}

export async function getRoom(client: RoomApiClient, code: string): Promise<Room> {
  const body = await client.post<{ room: Room }>({ action: 'get', code });
  return body.room;
}

export async function joinRoom(
  client: RoomApiClient,
  code: string,
  participant: Participant,
  options: {
    hostKey?: string;
    priorIdentity?: { name: string; client: 'web' | 'cc' };
    // T-30: request a member credential for this row (server issues one and
    // returns it as `memberKey`). Without it, sends are rejected once the
    // server disables legacy name-auth.
    wantMemberKey?: boolean;
    // T-25: a member key we already hold, presented to reclaim the same row on
    // rejoin instead of being suffixed into a new "(2)" one.
    reclaimMemberKey?: string;
  } = {},
): Promise<Room & { participant: Participant; memberKey?: string; removalNotice?: RemovalRecord & { name: string } }> {
  const body = await client.post<{
    room: Room;
    participant: Participant;
    // T-30: the freshly issued member credential (present when wantMemberKey).
    memberKey?: string;
    // T-32: why this identity's previous row was removed (delivered once).
    removalNotice?: RemovalRecord & { name: string };
  }>({
    action: 'join',
    code,
    participant,
    hostKey: options.hostKey,
    priorIdentity: options.priorIdentity,
    ...(options.wantMemberKey ? { wantMemberKey: true } : {}),
    ...(options.reclaimMemberKey ? { memberKey: options.reclaimMemberKey } : {}),
  });
  return {
    ...body.room,
    participant: body.participant,
    ...(body.memberKey ? { memberKey: body.memberKey } : {}),
    ...(body.removalNotice ? { removalNotice: body.removalNotice } : {}),
  };
}

// ---- Evidence-gated task board (server actions taskBoard/Create/Claim/
// Submit/Verify). The board is passed through to the agent as-is; it is loosely
// typed here because the authoritative BoardTask shape lives server-side. ----
export interface BoardTaskView {
  id: string; title: string; state: 'todo' | 'in_progress' | 'awaiting_review' | 'done' | 'rejected';
  owner?: string; verifier?: string; dod?: string;
  evidence?: { fileListing: string; fileExcerpt: string; runOutput: string; exitCode: number };
  verdict?: string; note?: string; [k: string]: unknown;
}
export interface TaskBoardView { tasks: BoardTaskView[]; [k: string]: unknown }

export async function getTaskBoard(client: RoomApiClient, code: string): Promise<TaskBoardView> {
  const body = await client.post<{ board: TaskBoardView }>({ action: 'taskBoard', code });
  return body.board;
}
export async function createTask(client: RoomApiClient, code: string, requesterName: string, fields: {
  title: string; id?: string; owner?: string; ownerClient?: 'web' | 'cc';
  verifier?: string; verifierClient?: 'web' | 'cc'; dod?: string;
}): Promise<{ board: TaskBoardView; task: BoardTaskView }> {
  return client.post({ action: 'taskCreate', code, requesterName, ...fields });
}
export async function claimTask(client: RoomApiClient, code: string, id: string, name: string, clientKind: 'web' | 'cc'): Promise<{ board: TaskBoardView; task: BoardTaskView }> {
  return client.post({ action: 'taskClaim', code, id, name, client: clientKind });
}
export async function submitTask(client: RoomApiClient, code: string, id: string, name: string, evidence: {
  fileListing: string; fileExcerpt: string; runOutput: string; exitCode: number;
}): Promise<{ board: TaskBoardView; task: BoardTaskView }> {
  return client.post({ action: 'taskSubmit', code, id, name, evidence });
}
export async function verifyTask(client: RoomApiClient, code: string, id: string, name: string, verdict: 'done' | 'rejected', note?: string): Promise<{ board: TaskBoardView; task: BoardTaskView }> {
  return client.post({ action: 'taskVerify', code, id, name, verdict, ...(note ? { note } : {}) });
}

export async function listMessages(client: RoomApiClient, code: string, since: number): Promise<Message[]> {
  const body = await client.post<{ messages: Message[] }>({ action: 'messages', code, cursor: since });
  return body.messages;
}

// Trigger the server-side turn-timeout sweep and return the current room.
// Replaces the MCP-side getRoom + sweepTimeouts pair: the server runs the
// sweep and emits any timeout / fallback system messages itself.
export async function sweepRoom(client: RoomApiClient, code: string): Promise<Room> {
  const body = await client.post<{ room: Room }>({ action: 'sweep', code });
  return body.room;
}

export async function appendMessage(
  client: RoomApiClient,
  code: string,
  message: Message,
  hostKey?: string,
  kind: 'message' | 'status' = 'message',
  memberKey?: string,
): Promise<AppendResult> {
  const body = await client.post<{ result: AppendResult }>({
    action: 'send', code, message, hostKey, kind,
    ...(memberKey ? { memberKey } : {}),
  });
  return body.result;
}

export async function appendSystemMessage(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  hostKey: string | undefined,
  message: Message,
): Promise<void> {
  await client.post({ action: 'systemMessage', code, requesterName, hostKey, message });
}

export async function setListenUntil(
  client: RoomApiClient,
  code: string,
  name: string,
  until: number,
  memberKey?: string,
): Promise<void> {
  await client.post({ action: 'presence', code, name, until, ...(memberKey ? { memberKey } : {}) });
}

export async function getTurnState(client: RoomApiClient, code: string): Promise<TurnState | null> {
  const body = await client.post<{ turnState: TurnState | null }>({ action: 'turnState', code });
  return body.turnState;
}

export async function removeParticipant(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  targetName: string,
  targetClient: 'web' | 'cc',
  hostKey?: string,
): Promise<Room> {
  const body = await client.post<{ room: Room }>({
    action: 'removeParticipant',
    code,
    requesterName,
    targetName,
    targetClient,
    hostKey,
  });
  return body.room;
}

export async function endRoom(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  hostKey: string | undefined,
): Promise<Room> {
  const body = await client.post<{ room: Room }>({ action: 'end', code, requesterName, hostKey });
  return body.room;
}

export async function reactivateRoom(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  hostKey: string | undefined,
): Promise<Room> {
  const body = await client.post<{ room: Room }>({ action: 'reactivate', code, requesterName, hostKey });
  return body.room;
}

export async function createRoomReport(client: RoomApiClient, code: string): Promise<RoomReport> {
  const body = await client.post<{ report: RoomReport }>({ action: 'createReport', code });
  return body.report;
}

export async function setReplyMode(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  hostKey: string | undefined,
  mode: ReplyMode,
  config: ReplyModeConfig | undefined,
): Promise<Room> {
  const body = await client.post<{ room: Room }>({
    action: 'setReplyMode',
    code,
    requesterName,
    hostKey,
    mode,
    config,
  });
  return body.room;
}

export async function directInvoke(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  hostKey: string | undefined,
  target: { name: string; client: 'web' | 'cc' },
  source: 'host' | 'moderator',
): Promise<boolean> {
  const body = await client.post<{ added: boolean }>({
    action: 'directInvoke',
    code,
    requesterName,
    hostKey,
    target,
    source,
  });
  return body.added;
}

export async function hostSkipCurrent(
  client: RoomApiClient,
  code: string,
  requesterName: string,
  hostKey: string | undefined,
): Promise<TurnSpokenEntry | null> {
  const body = await client.post<{ skipped: TurnSpokenEntry | null }>({
    action: 'skipCurrent',
    code,
    requesterName,
    hostKey,
  });
  return body.skipped;
}

export async function createOwnerQuestion(
  client: RoomApiClient,
  code: string,
  name: string,
  input: { prompt: string; context?: string; mode: RoomQuestionMode; options?: string[] },
): Promise<RoomQuestion> {
  const body = await client.post<{ question: RoomQuestion }>({
    action: 'questionCreate',
    code,
    name,
    ...input,
  });
  return body.question;
}

export async function listOwnerQuestions(
  client: RoomApiClient,
  code: string,
  name: string,
): Promise<RoomQuestion[]> {
  const body = await client.post<{ questions: RoomQuestion[] }>({
    action: 'questionList',
    code,
    name,
  });
  return body.questions;
}
