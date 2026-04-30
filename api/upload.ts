// Vercel Function: receives a multipart upload, validates size + mime,
// stores in Vercel Blob under `rooms/{code}/{uuid}/{filename}`, returns the
// MessageAttachment shape Codex's web composer can drop straight into a
// Message's `attachments` array.
//
// Authorization: anyone with the room code can upload (matches the read
// model — anyone with the code can join). The roomCode prefix in the blob
// path lets us batch-delete by room when the meeting ends or TTLs out.

import { put } from '@vercel/blob';

const MAX_BYTES = 10 * 1024 * 1024;     // 10 MB per file
const ALLOWED_MIMES = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
]);

export const config = { runtime: 'nodejs' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonError(405, `method_not_allowed`, `Use POST.`);
  }

  // The blob token is auto-injected by Vercel when a Blob store is connected
  // to the project. Without it, we can't talk to Blob — bail with a clear
  // message so the operator knows to provision the store.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return jsonError(503, 'blob_not_configured', 'Vercel Blob store not connected. Owner: open the project in Vercel → Storage → Create → Blob, then redeploy.');
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(400, 'invalid_multipart', 'Body must be multipart/form-data.');
  }

  const file = formData.get('file');
  const roomCode = formData.get('roomCode');
  const widthRaw = formData.get('width');
  const heightRaw = formData.get('height');

  if (!(file instanceof File)) {
    return jsonError(400, 'missing_file', 'No file field in form data.');
  }
  if (typeof roomCode !== 'string' || !/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(roomCode)) {
    return jsonError(400, 'bad_room_code', 'Missing or malformed roomCode.');
  }

  if (file.size === 0) {
    return jsonError(400, 'empty_file', 'File is empty.');
  }
  if (file.size > MAX_BYTES) {
    return jsonError(413, 'file_too_large', `File exceeds ${MAX_BYTES} bytes (10 MB).`);
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return jsonError(415, 'mime_not_allowed', `Unsupported MIME type: ${file.type}`);
  }

  // Stable, opaque attachment id. Used by clients as the React key, by the
  // delete path to remove the right blob, and (eventually) by a cron sweep
  // that lists blobs and matches them to live rooms.
  const id = crypto.randomUUID();

  // Sanitize filename: keep extension, strip path parts. Blob names are not
  // user-facing — the original name comes back on the MessageAttachment.
  const safeName = file.name.replace(/[/\\]/g, '_').slice(0, 200) || 'file';
  const path = `rooms/${roomCode}/${id}/${safeName}`;

  let blob: { url: string };
  try {
    blob = await put(path, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return jsonError(500, 'blob_put_failed', `Blob upload failed: ${msg}`);
  }

  const isImage = file.type.startsWith('image/');
  const widthNum = typeof widthRaw === 'string' ? Number(widthRaw) : NaN;
  const heightNum = typeof heightRaw === 'string' ? Number(heightRaw) : NaN;

  const attachment = {
    id,
    type: isImage ? ('image' as const) : ('file' as const),
    url: blob.url,
    // Echo the blob path so callers (e.g. UI delete buttons) have a stable
    // handle independent of the public URL.
    storageKey: path,
    name: file.name,
    size: file.size,
    mime: file.type,
    uploadedAt: Date.now(),
    ...(isImage && Number.isFinite(widthNum) && widthNum > 0 ? { width: widthNum } : {}),
    ...(isImage && Number.isFinite(heightNum) && heightNum > 0 ? { height: heightNum } : {}),
  };

  return Response.json(attachment, { status: 201 });
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}
