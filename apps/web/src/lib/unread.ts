// T-62: unread counts on the rooms screen.
//
// The read marker is stored per room, per browser, denominated in the SERVER'S
// ABSOLUTE message counter (the same counter useRoom anchors its cursor to).
// That counter survives history trimming, so `total - read` stays honest even
// after old messages are dropped — a marker counted against the retained list
// length would silently under-report.
//
// There is deliberately no server round-trip here: read state is a per-device
// reading position, and Waqas reads on both phone and desktop. Making it durable
// and cross-device means a server-side per-identity marker; that's a bigger
// change than the badge he asked for, so this stays local and we can promote it
// later without changing the call sites.

const KEY = (code: string) => `wakichat:read:${code}`;
const SELF_KEY = (code: string, selfName: string) =>
  `wakichat:self-seen:${code}:${encodeURIComponent(selfName.trim().toLocaleLowerCase())}`;

/** How many messages this device has read. null = never opened. */
export function getReadCount(code: string): number | null {
  return readMarker(code);
}

function readMarker(code: string): number | null {
  try {
    const raw = localStorage.getItem(KEY(code));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null; // private mode / storage disabled → degrade to "nothing unread"
  }
}

/** Record that the reader has seen `total` messages (the absolute counter). */
export function markRoomRead(code: string, total: number, selfName = ''): void {
  if (!code || !Number.isFinite(total) || total < 0) return;
  try {
    // Monotonic: never walk the marker backwards (a stale poll must not
    // resurrect already-read messages as unread).
    const prev = readMarker(code) ?? 0;
    if (total > prev) localStorage.setItem(KEY(code), String(total));
    // Once the absolute read marker catches up, locally-authored messages are
    // represented by that marker and no longer need a separate subtraction.
    if (selfName) localStorage.removeItem(SELF_KEY(code, selfName));
  } catch {
    /* storage unavailable — unread simply won't persist */
  }
}

function selfSeenCount(code: string, selfName: string): number {
  if (!code || !selfName.trim()) return 0;
  try {
    const value = Number(localStorage.getItem(SELF_KEY(code, selfName)));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

/** Optimistically exclude one message sent by this browser identity. */
export function markSelfMessageSeen(code: string, selfName: string): void {
  if (!code || !selfName.trim()) return;
  try {
    localStorage.setItem(SELF_KEY(code, selfName), String(selfSeenCount(code, selfName) + 1));
  } catch {
    /* storage unavailable */
  }
}

/** Roll back an optimistic self-send when posting fails. */
export function unmarkSelfMessageSeen(code: string, selfName: string): void {
  if (!code || !selfName.trim()) return;
  try {
    const next = Math.max(0, selfSeenCount(code, selfName) - 1);
    if (next === 0) localStorage.removeItem(SELF_KEY(code, selfName));
    else localStorage.setItem(SELF_KEY(code, selfName), String(next));
  } catch {
    /* storage unavailable */
  }
}

export function isSelfAuthored(
  message: { name?: string; client?: string; type?: string },
  selfName: string | undefined,
): boolean {
  return message.type !== 'sys'
    && message.client === 'web'
    && Boolean(selfName?.trim())
    && message.name?.trim().toLocaleLowerCase() === selfName!.trim().toLocaleLowerCase();
}

/** Find the first loaded, unread message that was not authored by this user. */
export function firstUnreadMessageIndex<T extends { name?: string; client?: string; type?: string }>(
  messages: T[],
  messageTotal: number,
  readCount: number,
  selfName: string | undefined,
): number {
  const loadedStart = Math.max(0, messageTotal - messages.length);
  const firstLoadedUnread = Math.max(0, readCount - loadedStart);
  return messages.findIndex((message, index) =>
    index >= firstLoadedUnread && !isSelfAuthored(message, selfName));
}

/**
 * Unread = messages the server has that this device hasn't displayed.
 *
 * A room with no marker yet is treated as fully READ (seeded, returns 0) rather
 * than fully unread. Every room predates this feature, so the honest-looking
 * alternative would greet Waqas with a false "59 unread" on rooms he has
 * actually read to the end. Seeding costs us the badge exactly once per room.
 */
export function unreadCount(code: string, messageCount: number | undefined, selfName = ''): number {
  if (typeof messageCount !== 'number' || !Number.isFinite(messageCount)) return 0;
  const marker = readMarker(code);
  if (marker === null) {
    markRoomRead(code, messageCount, selfName); // seed, don't cry wolf
    return 0;
  }
  return Math.max(0, messageCount - marker - selfSeenCount(code, selfName));
}
