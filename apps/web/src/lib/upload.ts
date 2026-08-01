import type { MessageAttachment } from '@agent-room/shared';

// Tunables — kept in sync with api/upload.ts on the server side. The server
// re-validates anyway; these constants exist for client-side preflight (so
// the user gets a fast, specific error instead of a generic 4xx).
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/html',
  'application/json',
  'text/csv',
  'application/zip',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export class UploadError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
  }
}

// Upload a single file attachment to /api/upload (Vercel Function backed
// by Vercel Blob). The returned MessageAttachment can be appended directly
// to a Message's `attachments` array. Validation runs on both sides — the
// client side guards mostly to give a nice toast before the round trip.
//
// `roomCode` is required: the server uses it as the blob path prefix, and
// binds the write to a participant row in that room before saving. It is NOT
// a deletion handle — ending a meeting does not remove attachments, and there
// is no client path to purge. (The prefix being code-only is exactly why a
// safe purge needs incarnation-scoped storage first.)
export async function uploadAttachment(
  file: File,
  roomCode: string,
  selfName: string,
): Promise<MessageAttachment> {
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new UploadError('mime_not_allowed', 415, `Unsupported file type: ${file.type || file.name}`);
  }
  if (file.size === 0) {
    throw new UploadError('empty_file', 400, `${file.name} is empty.`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new UploadError(
      'file_too_large',
      413,
      `Attachment too large: ${file.name} is ${formatBytes(file.size)}, limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
    );
  }

  const fd = new FormData();
  fd.append('file', file);
  fd.append('roomCode', roomCode);
  // The server binds this upload to an exact participant row before writing to
  // disk. The Access cookie rides along automatically and carries the durable
  // identity; the name selects which row in this room that identity must own.
  fd.append('name', selfName);
  fd.append('client', 'web');

  // Pre-read image dimensions so the bubble can reserve space and avoid a
  // layout flash when the <img> finally loads. SVG / unmeasurable images
  // fall through with no dims — the renderer just uses its CSS default.
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
    try {
      const dims = await readImageDimensions(file);
      if (dims.width && dims.height) {
        fd.append('width', String(dims.width));
        fd.append('height', String(dims.height));
      }
    } catch { /* non-essential */ }
  }

  const resp = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!resp.ok) {
    let body: { error?: string; message?: string } = {};
    try { body = (await resp.json()) as typeof body; } catch { /* keep empty */ }
    throw new UploadError(
      body.error ?? 'upload_failed',
      resp.status,
      body.message ?? `Upload failed (${resp.status}).`,
    );
  }
  return (await resp.json()) as MessageAttachment;
}

// The End-meeting blob purge lived here. It has been removed, not merely
// disabled: the endpoint deleted every attachment under a room code with no
// room, host, or member check, and it swallowed every failure into
// `{deleted: 0}` so an unauthorized or failed purge was indistinguishable from
// a clean one. Ending a room is not deleting its data. A real purge needs
// incarnation-scoped storage and explicit owner confirmation; until that
// exists there is deliberately no client path to attachment deletion.

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      cleanup();
    };
    image.onerror = () => {
      resolve({ width: 0, height: 0 });
      cleanup();
    };
    image.src = url;
  });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
