// T-26/T-27 room-list sorting. Pure comparators over the already-fetched
// list: sorting is applied at render time on the merged pages, so the chosen
// order survives T-15 paging by construction (a newly merged page re-sorts
// with everything already loaded). Kept free of DOM/state so the virtualized
// pager can consume the same functions.

export type RoomSort = 'activity-desc' | 'activity-asc' | 'created-desc' | 'created-asc' | 'name-asc';

export const ROOM_SORT_DEFAULT: RoomSort = 'activity-desc';
export const ROOM_SORT_STORAGE_KEY = 'wakichat:room-sort';

export const ROOM_SORTS: { value: RoomSort; label: string }[] = [
  { value: 'activity-desc', label: 'Latest activity' },
  { value: 'activity-asc', label: 'Quietest first' },
  { value: 'created-desc', label: 'Newest created' },
  { value: 'created-asc', label: 'Oldest created' },
  // T-38: the only order that HOLDS STILL. Every option above is time-keyed, so
  // all of them reshuffle as rooms get busy — which is what made the host type
  // into the wrong room three times in one afternoon ("sometimes I start typing
  // in the wrong room because room position changes"). A name order changes only
  // when a room is created or renamed.
  { value: 'name-asc', label: 'Name (A–Z)' },
];

export function isRoomSort(v: unknown): v is RoomSort {
  return v === 'activity-desc' || v === 'activity-asc' || v === 'created-desc'
    || v === 'created-asc' || v === 'name-asc';
}

// T-38: the preference is shared by Home and the desktop rail, so changing it in
// one must move the other — otherwise "fixed order" holds in one surface while the
// other keeps shuffling. localStorage alone does not notify the same tab, so the
// write also emits an event both surfaces subscribe to.
export const ROOM_SORT_EVENT = 'wakichat:room-sort';

export function saveRoomSort(sort: RoomSort): void {
  try { localStorage.setItem(ROOM_SORT_STORAGE_KEY, sort); } catch { /* private mode: session-only */ }
  try { window.dispatchEvent(new CustomEvent(ROOM_SORT_EVENT, { detail: sort })); } catch { /* no window */ }
}

/** Subscribe to preference changes from this tab (custom event) AND other tabs
 *  (storage event). Returns an unsubscribe. */
export function subscribeRoomSort(onChange: (sort: RoomSort) => void): () => void {
  const local = (e: Event) => onChange(resolveRoomSort(String((e as CustomEvent).detail ?? '')));
  const cross = (e: StorageEvent) => {
    if (e.key === ROOM_SORT_STORAGE_KEY) onChange(resolveRoomSort(e.newValue));
  };
  window.addEventListener(ROOM_SORT_EVENT, local);
  window.addEventListener('storage', cross);
  return () => {
    window.removeEventListener(ROOM_SORT_EVENT, local);
    window.removeEventListener('storage', cross);
  };
}

export function resolveRoomSort(stored: string | null): RoomSort {
  return isRoomSort(stored) ? stored : ROOM_SORT_DEFAULT;
}

interface Sortable {
  code: string;
  // T-38: optional because the desktop rail's summary payload omits it on some
  // rows. A missing timestamp must degrade to "oldest known", never crash the
  // sort or throw the rail away.
  createdAt?: number;
  lastActivityAt?: number | null;
  /** T-38: only the name order reads this; time orders ignore it. */
  topic?: string;
}

/** Activity falls back to createdAt — a room nobody has spoken in yet is as
 *  fresh as its creation, never "no activity, sink to the bottom". */
function activityOf(r: Sortable): number {
  return r.lastActivityAt ?? r.createdAt ?? 0;
}

export function sortRooms<T extends Sortable>(rooms: T[], sort: RoomSort): T[] {
  // T-38: locale-aware, case-insensitive, digit-aware ("Room 2" before "Room 10"),
  // with the room CODE as the final tiebreak. That tiebreak is the whole point:
  // two rooms sharing a topic must not swap places between renders, or a "fixed"
  // order still moves under the cursor.
  if (sort === 'name-asc') {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    return [...rooms].sort((a, b) =>
      collator.compare(a.topic ?? '', b.topic ?? '') || collator.compare(a.code, b.code));
  }
  const keyed = rooms.map((room, index) => ({ room, index }));
  const key = sort.startsWith('activity') ? activityOf : (r: Sortable) => r.createdAt ?? 0;
  const dir = sort.endsWith('desc') ? -1 : 1;
  keyed.sort((a, b) => {
    const diff = (key(a.room) - key(b.room)) * dir;
    if (diff !== 0) return diff;
    // Stable, deterministic tiebreak: incoming order, then code.
    return a.index - b.index || a.room.code.localeCompare(b.room.code);
  });
  return keyed.map(k => k.room);
}

/**
 * T-45: hold an order still while the user is actually using the list.
 *
 * Even with presence noise removed (T-43) and a fixed-order option available
 * (T-38), REAL activity still reorders an activity-sorted rail — and it does it
 * while the host is reaching for a room. His instruction: "never let the currently
 * selected room reading pane be swapped with someone else's even if its order in
 * the list (rail) changes." The reading pane itself never swaps, but a row moving
 * out from under a click produces the same outcome: a message sent to the wrong
 * room. It happened to him repeatedly today.
 *
 * So while the pointer or focus is inside the rail, the order is frozen to the
 * snapshot taken on entry. Rooms that vanish are dropped; rooms that appear are
 * APPENDED rather than inserted, so nothing already on screen shifts position.
 * Releasing the freeze (pointer out / blur) lets the live order settle.
 */
export function applyFrozenOrder<T extends { code: string }>(rooms: readonly T[], frozen: readonly string[] | null): T[] {
  if (!frozen || frozen.length === 0) return [...rooms];
  const byCode = new Map(rooms.map(r => [r.code, r]));
  const held: T[] = [];
  for (const code of frozen) {
    const room = byCode.get(code);
    if (room) { held.push(room); byCode.delete(code); }
  }
  // Anything new goes at the end: inserting it in its "correct" place is exactly
  // the shift this exists to prevent.
  return [...held, ...byCode.values()];
}
