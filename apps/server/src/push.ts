import webpush, { type PushSubscription } from 'web-push';
import type { Message } from '@agent-room/shared';

// T-118: the owner notification channel. Web Push (VAPID) subscriptions are
// stored per account in KV; when a message @mentions the owner or a question
// is addressed to them, every registered device gets a real push. Scoped to
// the owner first — agents do not need pushes.

export interface PushEnv {
  publicKey: string;
  privateKey: string;
  subject: string;
  ownerEmail: string;
  ownerNames: string[];
}

export function readPushEnv(env: NodeJS.ProcessEnv = process.env): PushEnv | null {
  const publicKey = env.VAPID_PUBLIC_KEY || '';
  const privateKey = env.VAPID_PRIVATE_KEY || '';
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT || 'mailto:owner@localhost',
    ownerEmail: env.OWNER_EMAIL || 'wwahmed@gmail.com',
    ownerNames: (env.OWNER_NOTIFY_NAMES || 'Waqas').split(',').map(s => s.trim()).filter(Boolean),
  };
}

let configured: PushEnv | null = null;
export function initPush(env: PushEnv | null): void {
  configured = env;
  if (env) webpush.setVapidDetails(env.subject, env.publicKey, env.privateKey);
}
export function pushEnabled(): boolean { return configured !== null; }
export function vapidPublicKey(): string { return configured?.publicKey ?? ''; }
export function ownerEmail(): string { return configured?.ownerEmail ?? ''; }

/**
 * A message deserves an owner push when its text mentions one of the owner's
 * names (with or without the @ sigil, case-insensitive, word-bounded) or it
 * is a question artifact addressed to the owner.
 */
export function shouldNotifyOwner(message: Pick<Message, 'text' | 'name' | 'metadata'>, ownerNames: string[] = configured?.ownerNames ?? []): boolean {
  if (message.metadata?.eventType === 'question_created') return true;
  const text = typeof message.text === 'string' ? message.text : '';
  if (!text) return false;
  // The owner's own messages never ping the owner.
  if (ownerNames.some(n => n.toLowerCase() === String(message.name || '').toLowerCase())) return false;
  return ownerNames.some(name => new RegExp(`(^|[^\\w])@?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(text));
}

// ---------- notify level (T-118 follow-up: "All messages" mode) ----------
//
// Per-account preference for how chatty the push channel is:
//   'mentions' (default) — @mentions of the owner and owner questions only.
//   'all'                — every teammate chat message also pushes, unless the
//                          owner is demonstrably reading the room right now.
// Stored in redis under push:prefs:<email> as JSON { level }. Anything
// unrecognized normalizes to 'mentions' so a corrupt value can never spam.

export type NotifyLevel = 'mentions' | 'all';

export function normalizeNotifyLevel(raw: unknown): NotifyLevel {
  return raw === 'all' ? 'all' : 'mentions';
}

export function parseNotifyPrefs(raw: string | null): NotifyLevel {
  if (!raw) return 'mentions';
  try { return normalizeNotifyLevel((JSON.parse(raw) as { level?: unknown }).level); } catch { return 'mentions'; }
}

/**
 * 'all'-level candidate: an ordinary teammate chat message. Status rows and
 * the owner's own messages never qualify; mention/question traffic is handled
 * by shouldNotifyOwner and must not double-fire through this predicate.
 */
export function isTeammateMessage(
  message: Pick<Message, 'text' | 'name' | 'metadata'>,
  ownerNames: string[] = configured?.ownerNames ?? [],
): boolean {
  if ((message.metadata as { kind?: string } | undefined)?.kind === 'status') return false;
  const text = typeof message.text === 'string' ? message.text : '';
  if (!text.trim()) return false;
  if (ownerNames.some(n => n.toLowerCase() === String(message.name || '').toLowerCase())) return false;
  return true;
}

/** How recently the owner's read marker must have moved to count as "reading". */
export const READING_WINDOW_MS = 90_000;

/**
 * Suppress an 'all'-level push when the owner is demonstrably reading the
 * room: their read marker covers every message before this one AND it moved
 * within the reading window. Missing data (no marker, no timestamp, unknown
 * total) always delivers — suppression must be earned, never assumed.
 * Mentions/questions bypass this entirely (they use shouldNotifyOwner).
 */
export function shouldSuppressAllPush(opts: {
  markerCount: number | null;
  markerMovedAt: number | null;
  totalAfterAppend: number | null;
  now: number;
  windowMs?: number;
}): boolean {
  const { markerCount, markerMovedAt, totalAfterAppend, now } = opts;
  const windowMs = opts.windowMs ?? READING_WINDOW_MS;
  if (markerCount === null || markerMovedAt === null || totalAfterAppend === null) return false;
  if (markerCount < totalAfterAppend - 1) return false; // not caught up
  return now - markerMovedAt <= windowMs;
}

export interface StoredSubscription extends PushSubscription { addedAt: number }

export interface SubscriptionStore {
  read(email: string): Promise<StoredSubscription[]>;
  write(email: string, subs: StoredSubscription[]): Promise<void>;
}

export function upsertSubscription(subs: StoredSubscription[], incoming: PushSubscription, now: number): StoredSubscription[] {
  const rest = subs.filter(s => s.endpoint !== incoming.endpoint);
  return [...rest, { ...incoming, addedAt: now }];
}

/**
 * Send a payload to every device of the given account; prune dead endpoints.
 * `agent` is test-injection only: web-push always speaks TLS, so the
 * integration test hands in an https.Agent trusting its local fixture cert.
 */
export async function sendToAccount(
  store: SubscriptionStore,
  email: string,
  payload: { title: string; body: string; url: string; tag?: string },
  agent?: unknown,
): Promise<{ sent: number; pruned: number; lastError: string | null }> {
  if (!configured) return { sent: 0, pruned: 0, lastError: null };
  const subs = await store.read(email);
  let sent = 0;
  let lastError: string | null = null;
  const dead: string[] = [];
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, ...(agent ? { agent: agent as never } : {}) });
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      lastError = `${status ?? ''} ${(err as Error).message}`.trim().slice(0, 160);
      if (status === 404 || status === 410) dead.push(sub.endpoint);
      // other failures (transient) leave the subscription in place
    }
  }));
  if (dead.length) await store.write(email, subs.filter(s => !dead.includes(s.endpoint)));
  return { sent, pruned: dead.length, lastError };
}
