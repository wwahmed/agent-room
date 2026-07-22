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

export interface StoredSubscription extends PushSubscription { addedAt: number }

export interface SubscriptionStore {
  read(email: string): Promise<StoredSubscription[]>;
  write(email: string, subs: StoredSubscription[]): Promise<void>;
}

export function upsertSubscription(subs: StoredSubscription[], incoming: PushSubscription, now: number): StoredSubscription[] {
  const rest = subs.filter(s => s.endpoint !== incoming.endpoint);
  return [...rest, { ...incoming, addedAt: now }];
}

/** Send a payload to every device of the given account; prune dead endpoints. */
export async function sendToAccount(
  store: SubscriptionStore,
  email: string,
  payload: { title: string; body: string; url: string; tag?: string },
): Promise<{ sent: number; pruned: number }> {
  if (!configured) return { sent: 0, pruned: 0 };
  const subs = await store.read(email);
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) dead.push(sub.endpoint);
      // other failures (transient) leave the subscription in place
    }
  }));
  if (dead.length) await store.write(email, subs.filter(s => !dead.includes(s.endpoint)));
  return { sent, pruned: dead.length };
}
