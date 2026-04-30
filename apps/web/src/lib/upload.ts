import type { MessageAttachment } from '@agent-room/shared';

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_INLINE_ATTACHMENT_BYTES = 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export async function uploadAttachment(file: File): Promise<MessageAttachment> {
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.type || file.name}`);
  }
  if (file.size > MAX_INLINE_ATTACHMENT_BYTES) {
    throw new Error(`Attachment too large: ${file.name}. Inline MVP limit is ${formatBytes(MAX_INLINE_ATTACHMENT_BYTES)}.`);
  }

  const url = await readAsDataUrl(file);
  const dimensions = file.type.startsWith('image/') ? await readImageDimensions(url) : {};
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    type: file.type.startsWith('image/') ? 'image' : 'file',
    url,
    storageKey: `inline:${id}`,
    name: file.name || `attachment-${Date.now()}`,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    uploadedAt: Date.now(),
    ...dimensions,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(src: string): Promise<Pick<MessageAttachment, 'width' | 'height'>> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({});
    image.src = src;
  });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
