// T-51: local-disk blob storage for attachments on the self-hosted deployment
// (upstream used Vercel Blob, which does not exist here). Files live under a
// server-owned data dir, one subdir per room, and are served back through an
// Access-gated route. All path components are strictly validated so a request
// can never escape the blob root.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors the web client
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

// mime -> canonical extension. The stored file's extension is derived from the
// (allow-listed) mime, never the user-supplied filename, so a hostile filename
// can't smuggle an unexpected extension onto disk.
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'application/json': 'json',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export function isAllowedMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_EXT, mime);
}

export function extFor(mime: string): string {
  return MIME_EXT[mime] ?? 'bin';
}

// Reverse map for serving: pick a canonical mime for a stored extension.
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeForExt(ext: string): string {
  return EXT_MIME[ext] ?? 'application/octet-stream';
}

export function attachmentKind(mime: string): 'image' | 'file' {
  return mime.startsWith('image/') ? 'image' : 'file';
}

const BLOB_ROOT = process.env.WAKICHAT_BLOB_DIR || join(homedir(), '.wakichat', 'blobs');

// A room dir component: canonical codes are [A-Za-z0-9-]; nothing else is ever
// used as a path segment. Rejects '/', '..', empty, over-long.
const SAFE_CODE = /^[A-Za-z0-9-]{1,64}$/;
// A stored blob file name: <32-hex>.<ext>. The key is server-generated; the ext
// is from the allow-list. Validated again on read to block traversal.
const SAFE_BLOB = /^[a-f0-9]{32}\.[a-z0-9]{1,5}$/;

function roomDir(code: string): string {
  if (!SAFE_CODE.test(code)) throw new Error('blobstore: invalid room code');
  return join(BLOB_ROOT, code);
}

export interface StoredBlob {
  key: string; // "<hex>.<ext>", the on-disk file name and URL leaf
  url: string; // "/blobs/<code>/<key>"
  size: number;
}

export function saveBlob(code: string, data: Buffer, mime: string): StoredBlob {
  if (!isAllowedMime(mime)) throw new Error('blobstore: mime not allowed');
  const dir = roomDir(code);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = `${randomBytes(16).toString('hex')}.${extFor(mime)}`;
  writeFileSync(join(dir, key), data, { mode: 0o600 });
  return { key, url: `/blobs/${code}/${key}`, size: data.length };
}

export interface LoadedBlob {
  data: Buffer;
  ext: string;
}

// Read a stored blob, or null if the code/key is malformed or the file is
// absent. Never throws on a bad request path — callers turn null into a 404.
export function readBlob(code: string, key: string): LoadedBlob | null {
  if (!SAFE_CODE.test(code) || !SAFE_BLOB.test(key)) return null;
  const file = join(roomDir(code), key);
  if (!file.startsWith(join(BLOB_ROOT, code) + '/') && file !== join(BLOB_ROOT, code, key)) return null;
  if (!existsSync(file)) return null;
  return { data: readFileSync(file), ext: key.slice(key.lastIndexOf('.') + 1) };
}

// Remove every blob for a room (meeting-end cleanup). Returns the count removed.
export function deleteRoomBlobs(code: string): number {
  if (!SAFE_CODE.test(code)) return 0;
  const dir = join(BLOB_ROOT, code);
  if (!existsSync(dir)) return 0;
  const n = readdirSync(dir).length;
  rmSync(dir, { recursive: true, force: true });
  return n;
}
