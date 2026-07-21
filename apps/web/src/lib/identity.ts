// Self-host identity: the server derives who you are from the Cloudflare
// Access header (see apps/server /api/me). Anonymous contexts (localhost,
// no Access session) get identity null and every flow behaves as before.

export interface WhoAmI {
  email: string;
  name: string;
  role: string;
}

export interface RoomSummary {
  code: string;
  topic: string;
  status: string;
  createdBy: string;
  createdAt: number;
  participants: number;
  /** Time of the newest message (falls back to createdAt server-side). The room
   *  list aged off createdAt before T-62, which reported the room's birthday
   *  instead of its last update. */
  lastActivityAt?: number;
  /** Server's absolute message counter — the currency the unread badge uses. */
  messageCount?: number;
  /** T-25: agent (cc) participants and the server's health verdict over them. */
  agentCount?: number;
  agentsAllHealthy?: boolean;
  /** T-34: per-agent faces (healthy-first, capped server-side) + stale count
   *  so the facepile can word severity, not just color it. */
  agentStaleCount?: number;
  agents?: Array<{ name: string; color: string; initials: string; harness?: string; state: 'listening' | 'online' | 'stale' | 'disconnected' }>;
}

export interface RoomPage {
  rooms: RoomSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

const LAST_ROLE_KEY = 'agentroom:lastRole';

export async function fetchIdentity(): Promise<WhoAmI | null> {
  try {
    const resp = await fetch('/api/me', { cache: 'no-store' });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { identity: WhoAmI | null };
    return body.identity ?? null;
  } catch {
    return null;
  }
}

export function roomsUrl(cursor?: string | null, limit = 30): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return `/api/rooms?${params.toString()}`;
}

export function mergeRoomPages(current: RoomSummary[], incoming: RoomSummary[]): RoomSummary[] {
  const byCode = new Map(current.map(room => [room.code, room]));
  for (const room of incoming) byCode.set(room.code, room);
  return [...byCode.values()].sort((a, b) =>
    Number(b.lastActivityAt ?? b.createdAt) - Number(a.lastActivityAt ?? a.createdAt)
      || b.createdAt - a.createdAt);
}

export async function fetchRooms(cursor?: string | null, limit = 30): Promise<RoomPage> {
  try {
    const resp = await fetch(roomsUrl(cursor, limit), { cache: 'no-store' });
    if (!resp.ok) return { rooms: [], nextCursor: null, hasMore: false };
    const body = (await resp.json()) as Partial<RoomPage>;
    return {
      rooms: body.rooms ?? [],
      nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
      hasMore: body.hasMore === true,
    };
  } catch {
    return { rooms: [], nextCursor: null, hasMore: false };
  }
}

export function rememberRole(role: string): void {
  try {
    if (role.trim()) localStorage.setItem(LAST_ROLE_KEY, role.trim());
  } catch { /* private mode */ }
}

export function lastRole(): string {
  try {
    return localStorage.getItem(LAST_ROLE_KEY) ?? '';
  } catch {
    return '';
  }
}
