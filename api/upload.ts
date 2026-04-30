// Vercel Function: receives a multipart upload, validates size + mime,
// stores in Vercel Blob under `rooms/{code}/{uuid}/{filename}`, returns the
// MessageAttachment shape Codex's web composer can drop straight into a
// Message's `attachments` array.
//
// Authorization: anyone with the room code can upload (matches the read
// model — anyone with the code can join). The roomCode prefix in the blob
// path lets us batch-delete by room when the meeting ends or TTLs out.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// Disable Vercel's default body parser so we can read raw multipart.
// `req` then carries the raw stream; we buffer it ourselves and parse
// with a tiny multipart reader. Avoids pulling in `busboy`/`formidable`
// for a single-file-per-request endpoint.
export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(503).json({
      error: 'blob_not_configured',
      message: 'Vercel Blob store not connected. Owner: open the project in Vercel → Storage → Create → Blob, then redeploy.',
    });
    return;
  }

  const contentType = String(req.headers['content-type'] ?? '');
  const boundaryMatch = /boundary=("?)([^";]+)\1/.exec(contentType);
  if (!boundaryMatch) {
    res.status(400).json({ error: 'invalid_multipart', message: 'Body must be multipart/form-data with a boundary.' });
    return;
  }
  const boundary = boundaryMatch[2]!;

  // Buffer the raw body. Hard cap at MAX_BYTES + a small headroom for
  // multipart envelope overhead so a malicious or malformed upload can't
  // OOM the function.
  let body: Buffer;
  try {
    body = await readRequestBody(req, MAX_BYTES + 1 * 1024 * 1024);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'read failed';
    res.status(413).json({ error: 'body_too_large', message: msg });
    return;
  }

  let parts: ParsedPart[];
  try {
    parts = parseMultipart(body, boundary);
  } catch (e) {
    res.status(400).json({ error: 'invalid_multipart', message: e instanceof Error ? e.message : 'parse failed' });
    return;
  }

  const filePart = parts.find(p => p.name === 'file' && p.filename !== undefined);
  const roomCodePart = parts.find(p => p.name === 'roomCode');
  const widthPart = parts.find(p => p.name === 'width');
  const heightPart = parts.find(p => p.name === 'height');

  if (!filePart) {
    res.status(400).json({ error: 'missing_file', message: 'No file field in form data.' });
    return;
  }
  const roomCode = roomCodePart ? roomCodePart.data.toString('utf8') : '';
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(roomCode)) {
    res.status(400).json({ error: 'bad_room_code', message: 'Missing or malformed roomCode.' });
    return;
  }

  if (filePart.data.length === 0) {
    res.status(400).json({ error: 'empty_file', message: 'File is empty.' });
    return;
  }
  if (filePart.data.length > MAX_BYTES) {
    res.status(413).json({ error: 'file_too_large', message: `File exceeds ${MAX_BYTES} bytes (10 MB).` });
    return;
  }
  const mime = filePart.contentType ?? 'application/octet-stream';
  if (!ALLOWED_MIMES.has(mime)) {
    res.status(415).json({ error: 'mime_not_allowed', message: `Unsupported MIME type: ${mime}` });
    return;
  }

  const id = randomUUID();
  const safeName = (filePart.filename ?? 'file').replace(/[/\\]/g, '_').slice(0, 200) || 'file';
  const path = `rooms/${roomCode}/${id}/${safeName}`;

  let blob: { url: string };
  try {
    blob = await put(path, filePart.data, {
      access: 'public',
      contentType: mime,
      addRandomSuffix: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    res.status(500).json({ error: 'blob_put_failed', message: `Blob upload failed: ${msg}` });
    return;
  }

  const isImage = mime.startsWith('image/');
  const widthNum = widthPart ? Number(widthPart.data.toString('utf8')) : NaN;
  const heightNum = heightPart ? Number(heightPart.data.toString('utf8')) : NaN;

  const attachment = {
    id,
    type: isImage ? 'image' : 'file',
    url: blob.url,
    storageKey: path,
    name: filePart.filename ?? 'file',
    size: filePart.data.length,
    mime,
    uploadedAt: Date.now(),
    ...(isImage && Number.isFinite(widthNum) && widthNum > 0 ? { width: widthNum } : {}),
    ...(isImage && Number.isFinite(heightNum) && heightNum > 0 ? { height: heightNum } : {}),
  };

  res.status(201).json(attachment);
}

// --- Multipart helpers ---

function readRequestBody(req: VercelRequest, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error(`Request body too large (${total} bytes > ${maxBytes}).`));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

interface ParsedPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

// Minimal multipart/form-data parser. Spec compliant for the common case
// (CRLF line endings, single-level multipart, no nested mixed parts).
// Robust enough for browser-driven uploads from our own composer.
function parseMultipart(body: Buffer, boundary: string): ParsedPart[] {
  const dashBoundary = Buffer.from(`--${boundary}`);
  const parts: ParsedPart[] = [];

  let i = body.indexOf(dashBoundary);
  if (i < 0) throw new Error('Boundary not found in body.');
  i += dashBoundary.length;
  // Skip CRLF after first boundary
  if (body[i] === 0x0d && body[i + 1] === 0x0a) i += 2;

  while (i < body.length) {
    // Find next boundary
    const next = body.indexOf(dashBoundary, i);
    if (next < 0) throw new Error('Truncated multipart body.');

    // headers \r\n\r\n body
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), i);
    if (headerEnd < 0 || headerEnd > next) throw new Error('Malformed part headers.');
    const headersRaw = body.slice(i, headerEnd).toString('utf8');
    let dataEnd = next - 2; // strip trailing CRLF before boundary
    if (dataEnd < headerEnd + 4) dataEnd = headerEnd + 4;
    const data = body.slice(headerEnd + 4, dataEnd);

    const part: ParsedPart = { name: '', data };
    for (const line of headersRaw.split('\r\n')) {
      const lower = line.toLowerCase();
      if (lower.startsWith('content-disposition:')) {
        const nameMatch = /name="([^"]*)"/.exec(line);
        const fileMatch = /filename="([^"]*)"/.exec(line);
        if (nameMatch) part.name = nameMatch[1]!;
        if (fileMatch) part.filename = fileMatch[1]!;
      } else if (lower.startsWith('content-type:')) {
        part.contentType = line.slice(line.indexOf(':') + 1).trim();
      }
    }
    parts.push(part);

    i = next + dashBoundary.length;
    // Trailing "--" means end of body
    if (body[i] === 0x2d && body[i + 1] === 0x2d) break;
    if (body[i] === 0x0d && body[i + 1] === 0x0a) i += 2;
  }

  return parts;
}
