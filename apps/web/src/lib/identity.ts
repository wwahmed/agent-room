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

export async function fetchRooms(): Promise<RoomSummary[]> {
  try {
    const resp = await fetch('/api/rooms', { cache: 'no-store' });
    if (!resp.ok) return [];
    const body = (await resp.json()) as { rooms: RoomSummary[] };
    return body.rooms ?? [];
  } catch {
    return [];
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
