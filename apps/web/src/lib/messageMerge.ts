import type { Message } from '@agent-room/shared';

// T-105: ORDER-PRESERVING message merge.
//
// The feed previously grew by blind append: `[...existing, ...dedupedFresh]`.
// That is correct only when every fetch resolves in causal order — and the
// visibility/focus handlers race: returning to a backgrounded tab fires BOTH
// forceRefresh (replaces the window with the newest page) and the
// focus-debounced pullMessages (still holding the pre-background cursor). If
// the stale pull resolves last, rows OLDER than the live tail get appended
// AFTER it — the host's screenshot: a day-old message rendered as the end of
// chat, with Reply binding to it.
//
// Message ids are server-stamped epoch-ms (T-113), so id order IS timeline
// order. Merging by id and sorting makes the feed's order independent of
// fetch arrival order: any interleaving of pages, reconnect catch-ups, and
// optimistic sends converges to the same timeline, with no loss and no
// duplication.
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<number, Message>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) {
    // Fresher fetches win for the same id (e.g. a reaction snapshot patch
    // applied upstream stays if the incoming row is identical; a server
    // re-fetch of an optimistic send replaces the local copy).
    byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
