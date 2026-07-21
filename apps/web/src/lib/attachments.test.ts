import { describe, expect, it } from 'vitest';
import { partitionAttachments } from './attachments.js';

describe('historical attachment resilience', () => {
  it('keeps valid files and quarantines persisted upload-error objects', () => {
    const valid = {
      id: 'a.png',
      type: 'image',
      url: '/blobs/room/a.png',
      name: 'a.png',
      size: 42,
      mime: 'image/png',
    };
    const failedUpload = { error: 'bad_request', message: 'missing or invalid roomCode' };

    expect(partitionAttachments([failedUpload, valid])).toEqual({
      renderable: [valid],
      unavailableCount: 1,
    });
  });

  it('rejects partial file shapes before rendering links or metadata', () => {
    expect(partitionAttachments([
      null,
      { id: 'missing-fields' },
      { id: 'bad-size', type: 'file', url: '/x', name: 'x', mime: 'text/plain', size: Number.NaN },
    ])).toEqual({ renderable: [], unavailableCount: 3 });
  });
});
