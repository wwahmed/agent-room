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

function summary(entry: RoomIndexEntry, record: RoomIndexRecord): RoomSummary | null {
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
    return {
      code: room.code,
      topic: typeof room.topic === 'string' ? room.topic : room.code,
      status: typeof room.status === 'string' ? room.status : 'active',
      createdBy: typeof room.createdBy === 'string' ? room.createdBy : '',
      createdAt,
      participants: Array.isArray(room.participants) ? room.participants.length : 0,
      lastActivityAt: Number.isFinite(entry.score) ? entry.score : createdAt,
      messageCount: Number.isFinite(count) && count >= 0 ? count : 0,
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
      const item = summary(entry, records[i] ?? { raw: null, messageCountRaw: null });
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
