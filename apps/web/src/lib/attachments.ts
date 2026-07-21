import type { MessageAttachment } from '@agent-room/shared';

/** Historical clients could persist upload-error objects in attachments[]. */
export function isRenderableAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as Partial<MessageAttachment>;
  return typeof attachment.id === 'string' && attachment.id.length > 0
    && typeof attachment.name === 'string' && attachment.name.length > 0
    && typeof attachment.mime === 'string' && attachment.mime.length > 0
    && typeof attachment.url === 'string' && attachment.url.length > 0
    && typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size >= 0
    && (attachment.type === 'image' || attachment.type === 'file');
}

export function partitionAttachments(values: readonly unknown[]): {
  renderable: MessageAttachment[];
  unavailableCount: number;
} {
  const renderable = values.filter(isRenderableAttachment);
  return { renderable, unavailableCount: values.length - renderable.length };
}
