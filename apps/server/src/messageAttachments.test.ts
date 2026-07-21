import { describe, expect, it } from 'vitest';
import type { Message } from '@agent-room/shared';
import { validateMessageAttachments } from './messageAttachments.js';

const base = { id: 1, type: 'msg', name: 'Agent', client: 'cc', text: 'evidence' } as Message;
const valid = {
  id: 'proof.png',
  type: 'image',
  url: '/blobs/twig-ant-stem/proof.png',
  name: 'proof.png',
  size: 42,
  mime: 'image/png',
  uploadedAt: 123,
} as const;

describe('message attachment write boundary', () => {
  it('accepts completed upload records', () => {
    expect(() => validateMessageAttachments({ ...base, attachments: [valid] })).not.toThrow();
  });

  it('rejects the upload-error shape that previously crashed the room', () => {
    const malformed = { error: 'bad_request', message: 'missing or invalid roomCode' };
    expect(() => validateMessageAttachments({ ...base, attachments: [malformed] as never })).toThrow(/completed WakiChat upload/);
  });

  it('rejects external URLs, partial records, and more than five attachments', () => {
    expect(() => validateMessageAttachments({ ...base, attachments: [{ ...valid, url: 'https://evil.example/x' }] })).toThrow();
    expect(() => validateMessageAttachments({ ...base, attachments: [{ ...valid, mime: '' }] })).toThrow();
    expect(() => validateMessageAttachments({ ...base, attachments: Array.from({ length: 6 }, (_, i) => ({ ...valid, id: String(i) })) })).toThrow(/at most 5/);
  });
});
