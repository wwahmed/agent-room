import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const STATE_DIR = join(homedir(), '.ai-room');

// Scope state per Claude Code session. The MCP server and the hook command are
// both spawned directly by Claude Code, so they share a parent PID. Two parallel
// sessions on the same machine end up with distinct files — without this, the
// later writer's `name` would clobber the earlier one's, and each session's
// hook would filter the *other* agent's messages as "own" by mistake.
//
// Override with AI_ROOM_STATE_FILE to share state across sessions on purpose
// (e.g. integration tests).
const STATE_FILE =
  process.env.AI_ROOM_STATE_FILE ||
  join(STATE_DIR, `state-${process.ppid ?? process.pid}.json`);

export interface RoomState {
  name: string;
  cursor: number;
  joinedAt: number;
  lastSentAt?: number;
}

export interface AiRoomState {
  version: 1;
  rooms: Record<string, RoomState>;
  // Number of consecutive Stop-hook blocks since the last UserPromptSubmit.
  // Used to cap autonomous chat back-and-forth so it can't loop forever
  // without the user typing.
  blockStreak?: number;
}

const EMPTY: AiRoomState = { version: 1, rooms: {}, blockStreak: 0 };

export async function readState(): Promise<AiRoomState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as AiRoomState;
    if (parsed.version !== 1 || typeof parsed.rooms !== 'object' || parsed.rooms === null) {
      return { ...EMPTY };
    }
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(state: AiRoomState): Promise<void> {
  await fs.mkdir(dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, STATE_FILE);
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

export async function markSent(code: string, at: number): Promise<void> {
  const state = await readState();
  const room = state.rooms[code];
  if (!room) return;
  room.lastSentAt = at;
  await writeState(state);
}

export async function bumpBlockStreak(): Promise<number> {
  const state = await readState();
  state.blockStreak = (state.blockStreak ?? 0) + 1;
  await writeState(state);
  return state.blockStreak;
}

export async function resetBlockStreak(): Promise<void> {
  const state = await readState();
  if (!state.blockStreak) return;
  state.blockStreak = 0;
  await writeState(state);
}
