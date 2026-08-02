import type { Message, MessageAttachment, MessageReplyRef } from '@agent-room/shared';

const KEY_PREFIX = 'wakichat:pending-send:v1:';
const CLIENT_SEND_ID_RE = /^[a-f0-9]{32}$/;

export interface BrowserSendIntent {
  text: string;
  attachments?: MessageAttachment[];
  replyTo?: MessageReplyRef;
  dictated: boolean;
}

export interface PendingBrowserSend {
  v: 1;
  intent: string;
  message: Message;
  savedAt: number;
}

function key(code: string, name: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(code)}:${encodeURIComponent(name)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).filter(k => row[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(row[k])}`).join(',')}}`;
  }
  return 'null';
}

export function browserSendIntent(input: BrowserSendIntent): string {
  return canonicalJson(input);
}

export function newClientSendId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function readPendingBrowserSend(code: string, name: string): PendingBrowserSend | null {
  let raw: string | null;
  try { raw = localStorage.getItem(key(code, name)); }
  catch { return null; }
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as PendingBrowserSend;
    const token = row.message?.metadata?.clientSendId;
    if (row.v !== 1 || typeof row.intent !== 'string' || !CLIENT_SEND_ID_RE.test(token ?? '')) {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

export function writePendingBrowserSend(
  code: string,
  name: string,
  intent: string,
  message: Message,
): PendingBrowserSend {
  const token = message.metadata?.clientSendId;
  if (!CLIENT_SEND_ID_RE.test(token ?? '')) {
    throw new Error('Could not create a durable send token.');
  }
  const row: PendingBrowserSend = { v: 1, intent, message, savedAt: Date.now() };
  try { localStorage.setItem(key(code, name), JSON.stringify(row)); }
  catch { throw new Error('This browser could not safely save the pending message.'); }
  return row;
}

export function clearPendingBrowserSend(code: string, name: string, clientSendId: string): void {
  const current = readPendingBrowserSend(code, name);
  if (current?.message.metadata?.clientSendId !== clientSendId) return;
  try { localStorage.removeItem(key(code, name)); }
  catch { /* A stale receipt is safe: the server remains idempotent. */ }
}
