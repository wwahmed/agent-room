import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { Message, MessageAttachment } from '@agent-room/shared';

// T-123: secure, agent-native attachment download. A joined participant (proven
// by its member credential, NOT a browser cookie) can retrieve the exact bytes
// of a file already shared in its room — including formats the text-extraction
// reader reports as `unsupported` (ZIP, etc.). Pure logic lives here so the
// authorization matrix and integrity checks are unit-testable without booting
// the HTTP server.

// Files up to this size are returned inline as base64 (MCP embedded-resource
// friendly). Between INLINE and MAX we hand back a one-time signed URL instead
// of copying large payloads through the tool channel. Above MAX is refused.
export const INLINE_MAX_BYTES = 6 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // mirrors the upload cap
// A signed download URL is single-use and dies fast: it authorizes exactly one
// retrieval of one attachment by one participant.
export const SIGNED_URL_TTL_MS = 60 * 1000;

export type AttachmentDownloadCode =
  | 'not_found'
  | 'not_a_participant'
  | 'permission_revoked'
  | 'expired'
  | 'replayed'
  | 'too_large'
  | 'integrity_mismatch'
  | 'bad_request';

export class AttachmentDownloadError extends Error {
  readonly code: AttachmentDownloadCode;
  constructor(code: AttachmentDownloadCode, message: string) {
    super(message);
    this.name = 'AttachmentDownloadError';
    this.code = code;
  }
}

export interface AttachmentSelector {
  id?: string;
  name?: string;
  url?: string;
}

export interface ResolvedAttachment {
  attachment: MessageAttachment;
  uploaderMessageId: number;
  uploadedAt: number;
}

/**
 * Find the single attachment in a room's message history matching exactly one
 * selector (id | name | url). Returns the attachment plus the message that
 * carried it, or null when nothing matches. A room-scoped resolve is the
 * authorization boundary: an attachment from another room is simply not found
 * here, so cross-room access is structurally impossible.
 */
export function selectAttachment(messages: Message[], selector: AttachmentSelector): ResolvedAttachment | null {
  const wantId = typeof selector.id === 'string' && selector.id ? selector.id : null;
  const wantName = typeof selector.name === 'string' && selector.name ? selector.name : null;
  // Match a URL by its trailing "/blobs/<code>/<key>" path, ignoring origin so
  // the transcript's relative URL and an absolute one both resolve.
  const wantUrl = typeof selector.url === 'string' && selector.url ? normalizeBlobPath(selector.url) : null;
  if (!wantId && !wantName && !wantUrl) return null;

  // Newest-first so a re-uploaded name resolves to the latest copy.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const atts = Array.isArray(m?.attachments) ? m!.attachments : [];
    for (const a of atts) {
      if (wantId && a.id !== wantId) continue;
      if (wantName && a.name !== wantName) continue;
      if (wantUrl && normalizeBlobPath(a.url) !== wantUrl) continue;
      return { attachment: a, uploaderMessageId: m!.id, uploadedAt: a.uploadedAt ?? m!.time };
    }
  }
  return null;
}

function normalizeBlobPath(u: string): string {
  // Strip origin/query/fragment; keep the /blobs/<code>/<key> path only.
  try {
    const path = u.startsWith('http') ? new URL(u).pathname : u.split('?')[0].split('#')[0];
    return path;
  } catch {
    return u;
  }
}

/**
 * The on-disk storage key for an attachment. Uploads set `storageKey`; older
 * rows only have the URL, whose leaf is the key. Never trust a caller-supplied
 * key — this is derived from the resolved (in-room, authorized) attachment.
 */
export function storageKeyFor(attachment: MessageAttachment): string | null {
  if (attachment.storageKey && attachment.storageKey.includes('/')) {
    // storageKey is "<code>/<key>"; return the key leaf.
    return attachment.storageKey.slice(attachment.storageKey.lastIndexOf('/') + 1);
  }
  const path = normalizeBlobPath(attachment.url);
  const parts = path.split('/').filter(Boolean); // ["blobs", code, key]
  return parts.length >= 3 && parts[0] === 'blobs' ? parts[parts.length - 1] : null;
}

// Magic-byte MIME sniff — detect from content, never trust the extension or the
// upload-declared type alone. Falls back to a text/binary heuristic.
export function sniffMime(buf: Buffer): string {
  const b = buf;
  const starts = (sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts([0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06])) return 'application/zip'; // PK.. (also docx/xlsx containers)
  if (starts([0x1f, 0x8b])) return 'application/gzip';
  if (starts([0x52, 0x49, 0x46, 0x46])) return 'application/octet-stream'; // RIFF (wav/webp) — declared type disambiguates
  // Heuristic: mostly-printable prefix reads as text.
  const sample = b.subarray(0, Math.min(b.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e) || byte >= 0x80) printable++;
  }
  if (sample.length > 0 && printable / sample.length > 0.9) return 'text/plain';
  return 'application/octet-stream';
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface IntegrityCheckResult {
  bytes: number;
  sha256: string;
  detectedMime: string;
}

/**
 * Validate a loaded payload against its recorded size and, when the attachment
 * carries one, its SHA-256. A mismatch means the stored object was truncated or
 * tampered — refuse it, return no bytes. Also enforces the hard size ceiling.
 */
export function verifyIntegrity(data: Buffer, attachment: MessageAttachment): IntegrityCheckResult {
  if (data.length > MAX_DOWNLOAD_BYTES) {
    throw new AttachmentDownloadError('too_large', `Attachment is ${data.length} bytes, over the ${MAX_DOWNLOAD_BYTES}-byte download limit.`);
  }
  if (typeof attachment.size === 'number' && attachment.size >= 0 && data.length !== attachment.size) {
    throw new AttachmentDownloadError('integrity_mismatch', `Stored object size (${data.length}) does not match the recorded size (${attachment.size}).`);
  }
  const digest = sha256Hex(data);
  // storageKey MAY embed a recorded digest in the future; today the message row
  // does not carry one, so size is the primary integrity anchor. Digest is
  // always returned so the caller can pin it.
  return { bytes: data.length, sha256: digest, detectedMime: sniffMime(data) };
}

// ---- one-time signed download URLs (large-file path) --------------------------

export interface SignedTokenClaims {
  code: string;
  attachmentId: string;
  storageKey: string;
  participant: string;   // "<name>|<client>"
  op: 'download';
  exp: number;           // epoch ms
  nonce: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** HMAC-sign a claims blob into a compact, URL-safe token. */
export function signDownloadToken(secret: string, claims: SignedTokenClaims): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const mac = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${mac}`;
}

/**
 * Verify a token: constant-time MAC comparison, expiry, and shape. Returns the
 * claims or throws a typed error. Single-use (replay) is enforced by the caller
 * tracking consumed nonces — this function is pure.
 */
export function verifyDownloadToken(secret: string, token: string, now: number): SignedTokenClaims {
  const dot = token.indexOf('.');
  if (dot <= 0) throw new AttachmentDownloadError('bad_request', 'Malformed download token.');
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AttachmentDownloadError('bad_request', 'Download token signature is invalid.');
  }
  let claims: SignedTokenClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString('utf8')) as SignedTokenClaims;
  } catch {
    throw new AttachmentDownloadError('bad_request', 'Download token payload is unreadable.');
  }
  if (claims.op !== 'download' || !claims.code || !claims.attachmentId || !claims.storageKey || typeof claims.exp !== 'number') {
    throw new AttachmentDownloadError('bad_request', 'Download token is missing required claims.');
  }
  if (now > claims.exp) {
    throw new AttachmentDownloadError('expired', 'Download token has expired.');
  }
  return claims;
}
