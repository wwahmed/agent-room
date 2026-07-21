import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  uploadAgentAttachment,
  uploadAgentAttachments,
  AttachmentUploadError,
  ALLOWED_ATTACHMENT_MIMES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from '../src/uploadAttachment.js';

const ROOM = 'ABC-DEF-GHJ';
const WORD_ROOM = 'rose-elk-wood';

function makeOkFetch(returned: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 201,
    json: async () => returned,
    text: async () => JSON.stringify(returned),
    _init: init,
  })) as unknown as typeof fetch;
}

describe('uploadAgentAttachment', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.AGENT_ROOM_BASE_URL;
    process.env.AGENT_ROOM_BASE_URL = 'https://example.test';
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.AGENT_ROOM_BASE_URL;
    else process.env.AGENT_ROOM_BASE_URL = originalEnv;
  });

  it('rejects an unsupported MIME with mime_not_allowed before any network call', async () => {
    const fetchMock = vi.fn();
    await expect(
      uploadAgentAttachment(
        { name: 'evil.exe', mime: 'application/x-msdownload', content_base64: 'AAA=' },
        ROOM,
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({ code: 'mime_not_allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty content_base64 with empty_content', async () => {
    await expect(
      uploadAgentAttachment(
        { name: 'x.pdf', mime: 'application/pdf', content_base64: '' },
        ROOM,
      ),
    ).rejects.toMatchObject({ code: 'empty_content' });
  });

  it('rejects malformed base64 before any network call', async () => {
    const fetchMock = vi.fn();
    await expect(
      uploadAgentAttachment(
        { name: 'x.pdf', mime: 'application/pdf', content_base64: 'not actually base64!' },
        ROOM,
        { fetch: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({ code: 'bad_base64' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects content that decodes to over the size limit with file_too_large', async () => {
    // Create base64 that decodes to > MAX_ATTACHMENT_BYTES.
    const oneByteOver = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0).toString('base64');
    await expect(
      uploadAgentAttachment(
        { name: 'big.pdf', mime: 'application/pdf', content_base64: oneByteOver },
        ROOM,
      ),
    ).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('rejects malformed room codes with bad_room_code', async () => {
    await expect(
      uploadAgentAttachment(
        { name: 'x.pdf', mime: 'application/pdf', content_base64: 'AAA=' },
        'not-a-code',
      ),
    ).rejects.toMatchObject({ code: 'bad_room_code' });
  });

  it('accepts and uploads to a canonical word-code room', async () => {
    const sample = {
      id: 'att-word',
      type: 'file',
      url: '/blobs/rose-elk-wood/att-word.md',
      name: 'test.md',
      size: 4,
      mime: 'text/markdown',
      uploadedAt: 1,
    };
    const fetchMock = makeOkFetch(sample);

    await expect(uploadAgentAttachment(
      { name: 'test.md', mime: 'text/markdown', content_base64: Buffer.from('test').toString('base64') },
      WORD_ROOM,
      { fetch: fetchMock },
    )).resolves.toEqual(sample);

    const init = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.body as FormData).get('roomCode')).toBe(WORD_ROOM);
  });

  it('canonicalizes word-code casing before upload', async () => {
    const fetchMock = makeOkFetch({ id: 'att-1', url: '/blobs/rose-elk-wood/att-1.md' });
    await uploadAgentAttachment(
      { name: 'test.md', mime: 'text/markdown', content_base64: Buffer.from('test').toString('base64') },
      'ROSE-ELK-WOOD',
      { fetch: fetchMock },
    );
    const init = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.body as FormData).get('roomCode')).toBe(WORD_ROOM);
  });

  it('strips data: URL prefix from content_base64', async () => {
    const sample = { id: 'att-1', type: 'file', url: 'https://r2/x', name: 'x.pdf', size: 4, mime: 'application/pdf', uploadedAt: 1 };
    const fetchMock = makeOkFetch(sample);
    const att = await uploadAgentAttachment(
      {
        name: 'x.pdf',
        mime: 'application/pdf',
        content_base64: 'data:application/pdf;base64,JVBERg==',
      },
      ROOM,
      { fetch: fetchMock },
    );
    expect(att.url).toBe('https://r2/x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // First arg is endpoint URL (resolved from AGENT_ROOM_BASE_URL).
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('https://example.test/api/upload');
  });

  it('posts to the correct endpoint with multipart body and returns the parsed attachment', async () => {
    const sample = {
      id: 'att-1',
      type: 'file',
      url: 'https://r2/x',
      name: 'report.csv',
      size: 4,
      mime: 'text/csv',
      uploadedAt: 1,
    };
    const fetchMock = makeOkFetch(sample);
    const att = await uploadAgentAttachment(
      {
        name: 'report.csv',
        mime: 'text/csv',
        content_base64: Buffer.from('a,b,\n1,2').toString('base64'),
      },
      ROOM,
      { fetch: fetchMock },
    );
    expect(att).toEqual(sample);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    // Body should be a FormData instance — Node 18+ has a global one.
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('surfaces server errors as upload_failed', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 415,
      text: async () => 'mime_not_allowed',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(
      uploadAgentAttachment(
        { name: 'x.pdf', mime: 'application/pdf', content_base64: 'JVBERg==' },
        ROOM,
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'upload_failed' });
  });

  it('treats network throws as network_error', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(
      uploadAgentAttachment(
        { name: 'x.pdf', mime: 'application/pdf', content_base64: 'JVBERg==' },
        ROOM,
        { fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('uploadAgentAttachments (batch)', () => {
  it(`rejects more than ${MAX_ATTACHMENTS_PER_MESSAGE} attachments with too_many`, async () => {
    const tooMany = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, (_, i) => ({
      name: `f${i}.pdf`,
      mime: 'application/pdf',
      content_base64: 'JVBERg==',
    }));
    await expect(
      uploadAgentAttachments(tooMany, ROOM),
    ).rejects.toMatchObject({ code: 'too_many' });
  });

  it('uploads multiple attachments to a word-code room', async () => {
    const fetchMock = makeOkFetch({ id: 'att-batch', url: '/blobs/rose-elk-wood/att-batch' });
    const attachments = [
      { name: 'notes.md', mime: 'text/markdown', content_base64: Buffer.from('# Notes').toString('base64') },
      { name: 'data.json', mime: 'application/json', content_base64: Buffer.from('{"ok":true}').toString('base64') },
    ];

    const uploaded = await uploadAgentAttachments(attachments, WORD_ROOM, { fetch: fetchMock });

    expect(uploaded).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls) {
      const init = call[1] as RequestInit;
      expect((init.body as FormData).get('roomCode')).toBe(WORD_ROOM);
    }
  });

  it('surface ALLOWED_ATTACHMENT_MIMES contains the formats Robin asked for (pdf, image, html, excel, csv)', () => {
    expect(ALLOWED_ATTACHMENT_MIMES.has('application/pdf')).toBe(true);
    expect(ALLOWED_ATTACHMENT_MIMES.has('image/png')).toBe(true);
    expect(ALLOWED_ATTACHMENT_MIMES.has('text/html')).toBe(true);
    expect(ALLOWED_ATTACHMENT_MIMES.has('application/vnd.ms-excel')).toBe(true);
    expect(ALLOWED_ATTACHMENT_MIMES.has('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(ALLOWED_ATTACHMENT_MIMES.has('text/csv')).toBe(true);
  });
});
