import type { Participant } from '@agent-room/shared';
import { presenceState } from './health.js';

export const ROOM_LIST_DEFAULT_LIMIT = 30;
export const ROOM_LIST_MAX_LIMIT = 100;

export interface RoomSummary {
  code: string;
  topic: string;
  status: string;
  createdBy: string;
  createdAt: number;
  participants: number;
  lastActivityAt: number;
  messageCount: number;
  /** T-25: agent (cc) participants attached to the room, and whether every one
   *  of them is currently listening/online per the server health verdicts. */
  agentCount: number;
  agentsAllHealthy: boolean;
}

export interface RoomIndexEntry {
  code: string;
  score: number;
}

export interface RoomIndexRecord {
  raw: string | null;
  messageCountRaw: string | number | null;
}

export interface RoomListStore {
  count(): Promise<number>;
  range(start: number, stop: number): Promise<RoomIndexEntry[]>;
  read(entries: RoomIndexEntry[]): Promise<RoomIndexRecord[]>;
  remove(codes: string[]): Promise<void>;
}

export function roomListLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return ROOM_LIST_DEFAULT_LIMIT;
  return Math.min(ROOM_LIST_MAX_LIMIT, Math.floor(value));
}

export function roomListCursor(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function summary(entry: RoomIndexEntry, record: RoomIndexRecord, now: number): RoomSummary | null {
  if (!record.raw) return null;
  try {
    const room = JSON.parse(record.raw) as {
      code?: unknown;
      topic?: unknown;
      status?: unknown;
      createdBy?: unknown;
      createdAt?: unknown;
      participants?: unknown;
    };
    if (typeof room.code !== 'string' || room.code !== entry.code) return null;
    const createdAt = Number(room.createdAt);
    if (!Number.isFinite(createdAt)) return null;
    const count = Number(record.messageCountRaw);
    // T-25: derive agent health server-side from the SAME presence rules the
    // People panel uses — the list must never invent its own health verdicts.
    // The raw room JSON is already in hand, so this costs no extra reads.
    const participants = Array.isArray(room.participants) ? (room.participants as Participant[]) : [];
    const agents = participants.filter(p => p?.client === 'cc');
    const agentsAllHealthy = agents.every(p => {
      const state = presenceState(p, now);
      return state === 'listening' || state === 'online';
    });
    return {
      code: room.code,
      topic: typeof room.topic === 'string' ? room.topic : room.code,
      status: typeof room.status === 'string' ? room.status : 'active',
      createdBy: typeof room.createdBy === 'string' ? room.createdBy : '',
      createdAt,
      participants: participants.length,
      lastActivityAt: Number.isFinite(entry.score) ? entry.score : createdAt,
      messageCount: Number.isFinite(count) && count >= 0 ? count : 0,
      agentCount: agents.length,
      agentsAllHealthy,
    };
  } catch {
    return null;
  }
}

/**
 * Read one bounded page from the recent-activity index. Missing/expired room
 * members are removed and skipped without returning short pages when newer
 * valid entries remain. The cursor is the next index position examined.
 */
export async function listIndexedRoomPage(
  store: RoomListStore,
  cursor: number,
  limit: number,
): Promise<{ rooms: RoomSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const total = await store.count();
  const now = Date.now();
  let position = Math.min(Math.max(0, cursor), total);
  const rooms: RoomSummary[] = [];
  const stale: string[] = [];

  while (rooms.length < limit && position < total) {
    const remaining = limit - rooms.length;
    const entries = await store.range(position, Math.min(total - 1, position + remaining - 1));
    if (entries.length === 0) break;
    const records = await store.read(entries);
    for (let i = 0; i < entries.length && rooms.length < limit; i++) {
      const entry = entries[i]!;
      const item = summary(entry, records[i] ?? { raw: null, messageCountRaw: null }, now);
      position += 1;
      if (item) rooms.push(item);
      else stale.push(entry.code);
    }
  }

  if (stale.length > 0) await store.remove(stale);
  // Removing examined stale members shifts every later ZSET offset left. Keep
  // the returned cursor aligned with the compacted index or the next page would
  // skip exactly `stale.length` valid rooms.
  const nextPosition = position - stale.length;
  const remainingTotal = total - stale.length;
  const hasMore = nextPosition < remainingTotal;
  return { rooms, nextCursor: hasMore ? String(nextPosition) : null, hasMore };
}
