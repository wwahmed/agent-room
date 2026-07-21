// T-26/T-27 room-list sorting. Pure comparators over the already-fetched
// list: sorting is applied at render time on the merged pages, so the chosen
// order survives T-15 paging by construction (a newly merged page re-sorts
// with everything already loaded). Kept free of DOM/state so the virtualized
// pager can consume the same functions.

export type RoomSort = 'activity-desc' | 'activity-asc' | 'created-desc' | 'created-asc';

export const ROOM_SORT_DEFAULT: RoomSort = 'activity-desc';
export const ROOM_SORT_STORAGE_KEY = 'wakichat:room-sort';

export const ROOM_SORTS: { value: RoomSort; label: string }[] = [
  { value: 'activity-desc', label: 'Latest activity' },
  { value: 'activity-asc', label: 'Quietest first' },
  { value: 'created-desc', label: 'Newest created' },
  { value: 'created-asc', label: 'Oldest created' },
];

export function isRoomSort(v: unknown): v is RoomSort {
  return v === 'activity-desc' || v === 'activity-asc' || v === 'created-desc' || v === 'created-asc';
}

export function resolveRoomSort(stored: string | null): RoomSort {
  return isRoomSort(stored) ? stored : ROOM_SORT_DEFAULT;
}

interface Sortable {
  code: string;
  createdAt: number;
  lastActivityAt?: number | null;
}

/** Activity falls back to createdAt — a room nobody has spoken in yet is as
 *  fresh as its creation, never "no activity, sink to the bottom". */
function activityOf(r: Sortable): number {
  return r.lastActivityAt ?? r.createdAt;
}

export function sortRooms<T extends Sortable>(rooms: T[], sort: RoomSort): T[] {
  const keyed = rooms.map((room, index) => ({ room, index }));
  const key = sort.startsWith('activity') ? activityOf : (r: Sortable) => r.createdAt;
  const dir = sort.endsWith('desc') ? -1 : 1;
  keyed.sort((a, b) => {
    const diff = (key(a.room) - key(b.room)) * dir;
    if (diff !== 0) return diff;
    // Stable, deterministic tiebreak: incoming order, then code.
    return a.index - b.index || a.room.code.localeCompare(b.room.code);
  });
  return keyed.map(k => k.room);
}
