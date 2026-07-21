// T-59: the search behind the command bar's ⌘K field. Pure ranking/shaping
// logic lives here so match, rank, and bound behavior is unit-tested; the
// HTTP route in index.ts only gathers inputs and hands them over. Hits carry
// the room code plus a message id or task id so the client can deep-link
// (/r/CODE, jump-to-message, ?panel=project). Nothing credential-shaped ever
// enters a hit: topics, message text snippets, sender names, task titles only.

export interface SearchHit {
  type: 'room' | 'message' | 'task';
  roomCode: string;
  /** Room topic, message sender, or task title. */
  title: string;
  /** Message hits: the matched text around the query. */
  snippet?: string;
  messageId?: number;
  taskId?: string;
  score: number;
}

export const SEARCH_MIN_QUERY = 2;
export const SEARCH_ROOM_HITS = 5;
export const SEARCH_MESSAGE_HITS = 10;
export const SEARCH_TASK_HITS = 5;
/** Only the newest messages are searched — bounded work per request. */
export const SEARCH_MESSAGE_WINDOW = 500;

function norm(s: string): string {
  return s.toLowerCase();
}

/** 0 = no match; higher is better. Exact-prefix beats word-prefix beats substring. */
export function matchScore(text: string, query: string): number {
  const t = norm(text);
  const q = norm(query);
  if (!q || !t.includes(q)) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(` ${q}`)) return 60;
  return 40;
}

/** Snippet centered on the first match, single line, bounded length. */
export function snippetAround(text: string, query: string, span = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = norm(flat).indexOf(norm(query));
  if (at < 0) return flat.slice(0, span);
  const start = Math.max(0, at - Math.floor((span - query.length) / 2));
  const cut = flat.slice(start, start + span);
  return `${start > 0 ? '…' : ''}${cut}${start + span < flat.length ? '…' : ''}`;
}

export function searchRooms(
  rooms: Array<{ code: string; topic: string; lastActivityAt?: number }>,
  query: string,
): SearchHit[] {
  return rooms
    .map(room => ({ room, score: matchScore(room.topic, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.room.lastActivityAt ?? 0) - (a.room.lastActivityAt ?? 0))
    .slice(0, SEARCH_ROOM_HITS)
    .map(({ room, score }) => ({ type: 'room' as const, roomCode: room.code, title: room.topic, score }));
}

export function searchMessages(
  messages: Array<{ id: number; type?: string; name: string; text?: string; time: number }>,
  query: string,
  roomCode: string,
): SearchHit[] {
  const window = messages.slice(-SEARCH_MESSAGE_WINDOW);
  const newestTime = window.length ? window[window.length - 1]!.time : 0;
  return window
    .filter(m => (m.type ?? 'msg') === 'msg')
    .map(m => {
      const text = m.text ?? '';
      const score = Math.max(matchScore(text, query), matchScore(m.name, query));
      if (score === 0) return null;
      // Recency bonus: up to +20 for the newest message, fading over ~2 days.
      const ageMs = Math.max(0, newestTime - m.time);
      const recency = Math.max(0, 20 - Math.floor(ageMs / (2 * 60 * 60 * 1000)));
      return {
        type: 'message' as const,
        roomCode,
        title: m.name,
        snippet: snippetAround(text, query),
        messageId: m.id,
        score: score + recency,
      };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_MESSAGE_HITS);
}

export function searchTasks(
  tasks: Array<{ id: string; title: string; state?: string }>,
  query: string,
  roomCode: string,
): SearchHit[] {
  return tasks
    .map(task => ({ task, score: Math.max(matchScore(task.title, query), matchScore(task.id, query)) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_TASK_HITS)
    .map(({ task, score }) => ({
      type: 'task' as const,
      roomCode,
      title: `${task.id} ${task.title}`,
      taskId: task.id,
      score,
    }));
}
