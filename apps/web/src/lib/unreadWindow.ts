// T-18/T-20: refine a room card's counter-based unread badge by actually
// looking at the unread window. The absolute counters (T-62/T-16) cannot know
// which unread messages are heartbeat noise or mention this viewer — only the
// messages themselves can say. One bounded, cached fetch per (room, marker,
// total) answers both questions:
//   - unread: unread messages that are neither self-authored nor status pings
//   - mentions: unread messages from others that @mention the viewer
// Windows past WINDOW_CAP are approximated: the un-fetched remainder counts as
// ordinary unread (never silently dropped).

import { createClient, listMessages } from './api.js';
import { getReadCount, isSelfAuthored, isStatusPing, unreadCount } from './unread.js';
import { textMentionsSelf } from './mentions.js';

export interface UnreadWindowStats {
  unread: number;
  mentions: number;
}

export const WINDOW_CAP = 80;

/** Pure classification over a fetched window. Exported for tests. Structural
 *  typing on purpose — accepts real Messages and minimal test literals alike. */
export function windowStats(
  fetched: Array<{ name?: string; client?: string; type?: string; text?: string; metadata?: unknown }>,
  span: number,
  selfName: string,
): UnreadWindowStats {
  const noise = fetched.filter(m => isSelfAuthored(m, selfName) || isStatusPing(m)).length;
  const mentions = fetched.filter(m =>
    !isSelfAuthored(m, selfName) && !isStatusPing(m) && textMentionsSelf(m.text ?? '', selfName)).length;
  return { unread: Math.max(0, span - noise), mentions };
}

const cache = new Map<string, UnreadWindowStats>();
const inflight = new Map<string, Promise<UnreadWindowStats | null>>();
const client = createClient();

/**
 * Stats for one room's unread window, or null when the fetch failed (caller
 * falls back to the raw counter badge). Cached per (code, marker, total,
 * viewer) — a new message or a read both change the key naturally.
 */
export function unreadWindowStats(
  code: string,
  messageCount: number | undefined,
  selfName: string,
): Promise<UnreadWindowStats | null> {
  const raw = unreadCount(code, messageCount, selfName);
  if (raw <= 0 || typeof messageCount !== 'number') return Promise.resolve({ unread: raw, mentions: 0 });
  const marker = getReadCount(code) ?? messageCount;
  const span = Math.max(0, messageCount - marker);
  if (span <= 0) return Promise.resolve({ unread: raw, mentions: 0 });
  const key = `${code}:${marker}:${messageCount}:${selfName.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    try {
      const fetched = await listMessages(client, code, marker, Math.min(span, WINDOW_CAP));
      const stats = windowStats(fetched, span, selfName);
      cache.set(key, stats);
      return stats;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
