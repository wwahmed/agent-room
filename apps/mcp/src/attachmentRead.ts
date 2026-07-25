// room_attachment_read — text extraction on top of our secure download.
//
// Complements room_attachment_download (raw bytes): this returns the EXTRACTED
// TEXT of an attachment so the model can actually read a PDF / Word doc / text
// file inline. PDF via unpdf, DOCX via mammoth, text-like decoded as UTF-8,
// images handed back as a URL for a vision step. Bytes are fetched through the
// same memberKey-authorized path as the download tool; the credential is never
// surfaced to the model.
import type { RoomApiClient } from './roomApi.js';
import { downloadRoomAttachment } from './attachmentDownloadTool.js';

const DEFAULT_MAX_CHARS = 12000;

export interface AttachmentReadArgs {
  code: string;
  name: string;               // caller's display name — for authorization
  memberKey?: string;
  attachmentId?: string;
  attachmentName?: string;
  url?: string;
  maxChars?: number;
}

export interface AttachmentReadResult {
  ok: boolean;
  id?: string;
  name?: string;
  mime?: string;
  text?: string;
  truncated?: boolean;
  note?: string;
  error?: string;
}

export async function readRoomAttachmentText(
  client: RoomApiClient,
  args: AttachmentReadArgs,
): Promise<AttachmentReadResult> {
  const dl = await downloadRoomAttachment(client, {
    code: args.code, name: args.name, memberKey: args.memberKey,
    attachmentId: args.attachmentId, attachmentName: args.attachmentName, url: args.url,
  });
  const cap = Math.min(30000, Math.max(1000, args.maxChars ?? DEFAULT_MAX_CHARS));
  const mime = dl.detectedMime || dl.declaredMime || '';
  const fname = dl.name || '';

  // Resolve bytes: inline base64, or fetch the short-lived signed URL.
  let buf: Buffer;
  if (dl.contentBase64) {
    buf = Buffer.from(dl.contentBase64, 'base64');
  } else if (dl.signedUrl) {
    const base = (process.env.AGENT_ROOM_BASE_URL ?? 'https://www.agent-room.com').replace(/\/$/, '');
    const u = dl.signedUrl.startsWith('http') ? dl.signedUrl : base + dl.signedUrl;
    const r = await fetch(u);
    if (!r.ok) return { ok: false, id: dl.id, name: fname, mime, error: `fetch_failed_${r.status}` };
    buf = Buffer.from(await r.arrayBuffer());
  } else {
    return { ok: false, id: dl.id, name: fname, mime, error: 'no_content' };
  }

  const clip = (t: string): { text: string; truncated: boolean } =>
    t.length > cap ? { text: t.slice(0, cap), truncated: true } : { text: t, truncated: false };

  // Images: hand back the URL for a vision-capable step.
  if (/^image\//.test(mime)) {
    return {
      ok: true, id: dl.id, name: fname, mime,
      note: 'Image attachment — pass the URL to a vision-capable step to actually see it.',
      text: dl.signedUrl || '',
    };
  }
  // PDF
  if (/pdf/.test(mime) || /\.pdf$/i.test(fname)) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return { ok: true, id: dl.id, name: fname, mime, ...clip(String(text || '')) };
  }
  // DOCX
  if (/wordprocessingml/.test(mime) || /\.docx$/i.test(fname)) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { ok: true, id: dl.id, name: fname, mime, ...clip(String(value || '')) };
  }
  // Text-like
  if (/^text\/|json|csv|html|markdown|xml|ya?ml/.test(mime) || /\.(txt|md|csv|json|html?|xml|ya?ml|log)$/i.test(fname)) {
    return { ok: true, id: dl.id, name: fname, mime, ...clip(buf.toString('utf8')) };
  }
  return {
    ok: false, id: dl.id, name: fname, mime, error: 'unsupported_type',
    note: `Can't extract text from ${mime || 'this type'}. Use room_attachment_download for the raw bytes.`,
  };
}
