import type { Message, MessageAttachment } from '@agent-room/shared';

const MAX_MESSAGE_ATTACHMENTS = 5;

function isAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MessageAttachment>;
  return typeof item.id === 'string' && item.id.length > 0
    && (item.type === 'file' || item.type === 'image')
    && typeof item.url === 'string' && item.url.startsWith('/blobs/')
    && typeof item.name === 'string' && item.name.length > 0
    && typeof item.mime === 'string' && item.mime.length > 0
    && typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0
    && typeof item.uploadedAt === 'number' && Number.isFinite(item.uploadedAt);
}

/** Prevent upload-error/partial objects from ever entering the message ledger. */
export function validateMessageAttachments(message: Message): void {
  if (message.attachments === undefined) return;
  if (!Array.isArray(message.attachments)) throw badRequest('message.attachments must be an array.');
  if (message.attachments.length > MAX_MESSAGE_ATTACHMENTS) {
    throw badRequest(`A message can contain at most ${MAX_MESSAGE_ATTACHMENTS} attachments.`);
  }
  if (!message.attachments.every(isAttachment)) {
    throw badRequest('Every attachment must be a completed WakiChat upload. Retry failed uploads before sending.');
  }
}

function badRequest(message: string): Error {
  const error = new Error(message);
  error.name = 'BadRequestError';
  return error;
}
