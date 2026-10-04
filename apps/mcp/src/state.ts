import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { detectHarness } from './harness.js';
import type { Message } from '@agent-room/shared';

const STATE_DIR = process.env.AGENT_ROOM_STATE_DIR || join(homedir(), '.agent-room');

// The immediate PPID is only a fallback. Claude's MCP server and lifecycle hook
// can sit under different wrapper processes, so writes are also mirrored to a
// stable nearest-Claude-ancestor file below. Summoned sessions avoid inference
// entirely by receiving an explicit AGENT_ROOM_STATE_FILE.
//
// Override with AGENT_ROOM_STATE_FILE to share state across sessions on purpose
// (e.g. integration tests).
const STATE_FILE =
  process.env.AGENT_ROOM_STATE_FILE ||
  join(STATE_DIR, `state-${process.ppid ?? process.pid}.json`);

function nearestClaudeAncestorPid(): number | null {
  let pid = process.ppid;
  for (let depth = 0; pid > 1 && depth < 16; depth += 1) {
    try {
      const line = execFileSync('ps', ['-o', 'ppid=', '-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1_000,
      }).trim();
      const match = line.match(/^(\d+)\s+(.+)$/s);
      if (!match) return null;
      const parent = Number(match[1]);
      const command = match[2] ?? '';
      if (/\bclaude\b|Claude\.app/i.test(command) && !/agent-room-mcp/i.test(command)) return pid;
      pid = parent;
    } catch {
      return null;
    }
  }
  return null;
}

function currentHarnessStateFile(): string | null {
  if (process.env.AGENT_ROOM_STATE_FILE) return null;
  const kind = detectHarness().kind;
  if (kind === 'claude-code' || kind === 'claude-desktop') {
    const ancestor = nearestClaudeAncestorPid();
    return ancestor ? join(STATE_DIR, `state-harness-claude-${ancestor}.json`) : null;
  }
  if (kind !== 'cursor' && kind !== 'codex') return null;
  return join(STATE_DIR, `state-harness-${kind}.json`);
}

export interface RoomState {
  name: string;
  cursor: number;
  joinedAt: number;
  lastSentAt?: number;
  // T-48: ids prepared by this exact MCP session before append. The following
  // listen must advance across them without returning the agent's own send as a
  // duplicate, while still returning messages another participant posted in the
  // send window. Bounded below; never an unbounded transcript mirror.
  pendingOwnMessageIds?: number[];
  // Stored when this MCP session is the host of the room (room_create).
  // Required to claim the host display name on rejoin / reconnect; without
  // it, joinRoom rejects with HostNameTakenError. Plain text on disk under
  // ~/.agent-room/ — same trust level as the MCP state itself.
  hostKey?: string;
  // T-30: the server-issued, room-scoped member credential handed to this row
  // at join (wantMemberKey). REQUIRED to send/post presence when the server has
  // legacy name-auth disabled (the secure default) — without it every room_send
  // is rejected and the agent goes silently passive. Also re-presented on
  // rejoin to reclaim the same row. Plain text on disk under ~/.agent-room/,
  // same trust level as the rest of the MCP state.
  memberKey?: string;
  // One unresolved room_send intent. The exact message (including its stable
  // clientSendId and uploaded attachment references) survives transport loss
  // and MCP restarts, so a retry replays the same operation instead of minting
  // a duplicate. Cleared only after an acknowledged or authoritative failure.
  pendingSend?: {
    intentHash: string;
    message: Message;
    preparedAt: number;
  };
}

export interface AgentRoomState {
  version: 1;
  rooms: Record<string, RoomState>;
  // Number of consecutive Stop-hook blocks since the last UserPromptSubmit.
  // Used to cap autonomous chat back-and-forth so it can't loop forever
  // without the user typing.
  blockStreak?: number;
}

const EMPTY: AgentRoomState = { version: 1, rooms: {}, blockStreak: 0 };

function cloneEmpty(): AgentRoomState {
  return { ...EMPTY, rooms: {} };
}

function isValidState(parsed: AgentRoomState): boolean {
  return parsed.version === 1 && typeof parsed.rooms === 'object' && parsed.rooms !== null;
}

async function readStateFile(file: string): Promise<AgentRoomState> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as AgentRoomState;
    if (!isValidState(parsed)) return cloneEmpty();
    return parsed;
  } catch {
    return cloneEmpty();
  }
}

export async function readState(): Promise<AgentRoomState> {
  return readStateFile(STATE_FILE);
}

export function mergeStates(states: AgentRoomState[]): AgentRoomState {
  const merged = cloneEmpty();

  for (const state of states) {
    merged.blockStreak = Math.max(merged.blockStreak ?? 0, state.blockStreak ?? 0);

    for (const [code, room] of Object.entries(state.rooms)) {
      const existing = merged.rooms[code];
      if (!existing) {
        merged.rooms[code] = { ...room };
        continue;
      }

      const newest = room.joinedAt >= existing.joinedAt ? room : existing;
      const pendingOwnMessageIds = Array.from(new Set([
        ...(existing.pendingOwnMessageIds ?? []),
        ...(room.pendingOwnMessageIds ?? []),
      ])).slice(-50);
      const hostKey = newest.hostKey ?? room.hostKey ?? existing.hostKey;
      const memberKey = newest.memberKey ?? room.memberKey ?? existing.memberKey;
      const pendingSend = [existing.pendingSend, room.pendingSend]
        .filter((row): row is NonNullable<RoomState['pendingSend']> => Boolean(row))
        .sort((a, b) => b.preparedAt - a.preparedAt)[0];
      merged.rooms[code] = {
        ...newest,
        cursor: Math.max(existing.cursor, room.cursor),
        joinedAt: newest.joinedAt,
        lastSentAt: Math.max(existing.lastSentAt ?? 0, room.lastSentAt ?? 0) || undefined,
        ...(pendingOwnMessageIds.length ? { pendingOwnMessageIds } : {}),
        // T-27: credentials survive from EITHER side. `newest.x ?? existing.x`
        // silently dropped a key whenever the newest entry was the keyless one
        // (its own `existing` fallback resolves to itself), so a room re-entered
        // under a fresh ppid file lost the credential written by the older
        // session — the real cause of room_leave stranding ghost rows despite
        // T-11: the key was on disk, and the merge threw it away.
        ...(hostKey ? { hostKey } : {}),
        ...(memberKey ? { memberKey } : {}),
        ...(pendingSend ? { pendingSend } : {}),
      };
      if (!merged.rooms[code]!.lastSentAt) delete merged.rooms[code]!.lastSentAt;
    }
  }

  return merged;
}

async function listStateFiles(): Promise<string[]> {
  if (process.env.AGENT_ROOM_STATE_FILE) return [STATE_FILE];

  let files: string[] = [];
  try {
    const entries = await fs.readdir(STATE_DIR);
    files = entries
      .filter((name) => /^state-(?:\d+|harness-[a-z-]+(?:-\d+)?)\.json$/.test(name))
      .map((name) => join(STATE_DIR, name));
  } catch {
    files = [];
  }

  return Array.from(new Set([...files, STATE_FILE, currentHarnessStateFile()].filter(Boolean) as string[]));
}

export async function readMergedState(): Promise<AgentRoomState> {
  const files = await listStateFiles();
  const states = await Promise.all(files.map(readStateFile));
  return mergeStates(states);
}

export async function readRoomStateForJoin(code: string, desiredName: string): Promise<RoomState | undefined> {
  const current = (await readState()).rooms[code];
  if (current) return current;

  const files = await listStateFiles();
  const states = await Promise.all(files.map(readStateFile));
  return states
    .map((state) => state.rooms[code])
    .filter((room): room is RoomState => Boolean(room && room.name === desiredName))
    .sort((a, b) => b.joinedAt - a.joinedAt)[0];
}

export async function readHarnessStateOrMerged(): Promise<AgentRoomState> {
  const harnessFile = currentHarnessStateFile();
  if (harnessFile) {
    const harnessState = await readStateFile(harnessFile);
    if (Object.keys(harnessState.rooms).length > 0) return harnessState;
  }
  return readMergedState();
}

async function writeStateFile(file: string, state: AgentRoomState): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function writeState(state: AgentRoomState): Promise<void> {
  await writeStateFile(STATE_FILE, state);
  const harnessFile = currentHarnessStateFile();
  if (harnessFile) await writeStateFile(harnessFile, state);
}

export async function setRoom(code: string, room: RoomState): Promise<void> {
  const state = await readState();
  state.rooms[code] = room;
  await writeState(state);
}

export async function removeRoom(code: string): Promise<void> {
  const state = await readState();
  if (code in state.rooms) {
    delete state.rooms[code];
    await writeState(state);
  }
}

export async function updateCursor(code: string, cursor: number): Promise<void> {
  const state = await readState();
  const room = state.rooms[code];
  if (!room) return;
  if (cursor <= room.cursor) return;
  room.cursor = cursor;
  await writeState(state);
}

export async function updateCursorEverywhere(code: string, cursor: number): Promise<void> {
  const files = await listStateFiles();
  await Promise.all(files.map(async (file) => {
    const state = await readStateFile(file);
    const room = state.rooms[code];
    if (!room || cursor <= room.cursor) return;
    room.cursor = cursor;
    await writeStateFile(file, state);
  }));
}

export async function markSent(code: string, at: number): Promise<void> {
  const state = await readState();
  const room = state.rooms[code];
  if (!room) return;
  room.lastSentAt = at;
  await writeState(state);
}

// Serialize the new send/listen state transitions inside one MCP process. The
// earlier read→write helpers can race when a listen resolves during room_send;
// these two transitions must be atomic with respect to each other or a pending
// own-message id can be lost before the listener filters it.
let sendListenMutation = Promise.resolve();

async function mutateSendListenState<T>(mutator: (state: AgentRoomState) => T): Promise<T> {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  sendListenMutation = sendListenMutation.catch(() => undefined).then(async () => {
    try {
      const state = await readState();
      const value = mutator(state);
      await writeState(state);
      resolveValue(value);
    } catch (error) {
      rejectValue(error);
    }
  });
  await sendListenMutation;
  return result;
}

/** Capture the last cursor the agent actually consumed BEFORE append and register
 * the exact own-message id the next listen should suppress. */
export async function prepareSend(code: string, messageId: number): Promise<number> {
  return mutateSendListenState((state) => {
    const room = state.rooms[code];
    if (!room) return 0;
    room.pendingOwnMessageIds = Array.from(new Set([
      ...(room.pendingOwnMessageIds ?? []),
      messageId,
    ])).slice(-50);
    return room.cursor;
  });
}

/** Finish a prepared send. A failed/swallowed append removes the suppression id;
 * a real append keeps it until the next listen observes that row. */
export async function finishPreparedSend(
  code: string,
  messageId: number,
  appended: boolean,
  at: number,
): Promise<void> {
  await mutateSendListenState((state) => {
    const room = state.rooms[code];
    if (!room) return;
    if (appended) {
      room.lastSentAt = at;
    } else {
      room.pendingOwnMessageIds = (room.pendingOwnMessageIds ?? []).filter(id => id !== messageId);
    }
  });
}

export async function readPendingSend(code: string): Promise<RoomState['pendingSend'] | undefined> {
  return (await readState()).rooms[code]?.pendingSend;
}

export async function prepareDurableSend(
  code: string,
  intentHash: string,
  message: Message,
): Promise<void> {
  await mutateSendListenState((state) => {
    const room = state.rooms[code];
    if (!room) return;
    room.pendingSend = { intentHash, message, preparedAt: Date.now() };
  });
}

export async function clearDurableSend(code: string, clientSendId: string): Promise<void> {
  await mutateSendListenState((state) => {
    const room = state.rooms[code];
    if (room?.pendingSend?.message.metadata?.clientSendId !== clientSendId) return;
    delete room.pendingSend;
  });
}

/** Advance one delivered batch and atomically consume only this session's own
 * prepared ids. Returns the ids to suppress from the visible listen payload. */
export async function advanceListenAndConsumeOwn(
  code: string,
  cursor: number,
  observedOwnIds: number[],
): Promise<Set<number>> {
  const consumed = await mutateSendListenState((state) => {
    const room = state.rooms[code];
    if (!room) return [] as number[];
    const pending = new Set(room.pendingOwnMessageIds ?? []);
    const matched = observedOwnIds.filter(id => pending.has(id));
    const matchedSet = new Set(matched);
    room.pendingOwnMessageIds = (room.pendingOwnMessageIds ?? []).filter(id => !matchedSet.has(id));
    if (cursor > room.cursor) room.cursor = cursor;
    return matched;
  });
  return new Set(consumed);
}

export async function bumpBlockStreak(): Promise<number> {
  const state = await readState();
  state.blockStreak = (state.blockStreak ?? 0) + 1;
  await writeState(state);
  return state.blockStreak;
}

export async function bumpBlockStreakEverywhere(): Promise<number> {
  const next = ((await readMergedState()).blockStreak ?? 0) + 1;
  const files = await listStateFiles();
  await Promise.all(files.map(async (file) => {
    const state = await readStateFile(file);
    state.blockStreak = next;
    await writeStateFile(file, state);
  }));
  return next;
}

export async function resetBlockStreak(): Promise<void> {
  const state = await readState();
  if (!state.blockStreak) return;
  state.blockStreak = 0;
  await writeState(state);
}

export async function resetBlockStreakEverywhere(): Promise<void> {
  const files = await listStateFiles();
  await Promise.all(files.map(async (file) => {
    const state = await readStateFile(file);
    if (!state.blockStreak) return;
    state.blockStreak = 0;
    await writeStateFile(file, state);
  }));
}

export async function removeRoomEverywhere(code: string): Promise<void> {
  const files = await listStateFiles();
  await Promise.all(files.map(async (file) => {
    const state = await readStateFile(file);
    if (!(code in state.rooms)) return;
    delete state.rooms[code];
    await writeStateFile(file, state);
  }));
}
