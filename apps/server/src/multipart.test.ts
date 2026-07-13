import { describe, it, expect } from 'vitest';
import { parseMultipart, parseBoundary } from './multipart.js';

const BOUNDARY = '----WebKitFormBoundaryTEST123';

// Build a browser-style multipart body from parts (Buffers for file data).
function buildBody(
  parts: Array<
    | { name: string; value: string }
    | { name: string; filename: string; contentType: string; data: Buffer }
  >,
): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ('filename' in p) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
            `Content-Type: ${p.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(p.data);
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`));
      chunks.push(Buffer.from(p.value));
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

const CT = `multipart/form-data; boundary=${BOUNDARY}`;

describe('parseBoundary', () => {
  it('extracts the boundary token', () => {
    expect(parseBoundary(CT)).toBe(BOUNDARY);
    expect(parseBoundary(`multipart/form-data; boundary="${BOUNDARY}"`)).toBe(BOUNDARY);
    expect(parseBoundary('application/json')).toBeNull();
  });
});

describe('parseMultipart', () => {
  it('parses fields and a text file together', () => {
    const body = buildBody([
      { name: 'roomCode', value: 'D64-2UJ-FNR' },
      { name: 'file', filename: 'note.txt', contentType: 'text/plain', data: Buffer.from('hello world') },
    ]);
    const { fields, files } = parseMultipart(body, CT);
    expect(fields.roomCode).toBe('D64-2UJ-FNR');
    expect(files).toHaveLength(1);
    expect(files[0].field).toBe('file');
    expect(files[0].filename).toBe('note.txt');
    expect(files[0].contentType).toBe('text/plain');
    expect(files[0].data.toString()).toBe('hello world');
  });

  it('is binary-safe — bytes with CRLF and boundary-like runs survive intact', () => {
    // 256 bytes of every value, plus embedded CRLFs and a near-boundary run.
    const raw = Buffer.concat([
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
      Buffer.from('\r\n\r\n--not-the-boundary\r\n'),
      Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x2d, 0x2d]),
    ]);
    const body = buildBody([
      { name: 'roomCode', value: 'door-cat-hall' },
      { name: 'file', filename: 'blob.bin', contentType: 'application/octet-stream', data: raw },
    ]);
    const { files } = parseMultipart(body, CT);
    expect(files).toHaveLength(1);
    expect(files[0].data.length).toBe(raw.length);
    expect(files[0].data.equals(raw)).toBe(true); // byte-for-byte, no corruption
  });

  it('handles multiple files', () => {
    const body = buildBody([
      { name: 'file', filename: 'a.txt', contentType: 'text/plain', data: Buffer.from('A') },
      { name: 'file', filename: 'b.txt', contentType: 'text/plain', data: Buffer.from('B') },
    ]);
    const { files } = parseMultipart(body, CT);
    expect(files.map((f) => f.data.toString())).toEqual(['A', 'B']);
  });

  it('carries optional dimension fields', () => {
    const body = buildBody([
      { name: 'width', value: '800' },
      { name: 'height', value: '600' },
      { name: 'file', filename: 'p.png', contentType: 'image/png', data: Buffer.from([0x89, 0x50]) },
    ]);
    const { fields } = parseMultipart(body, CT);
    expect(fields.width).toBe('800');
    expect(fields.height).toBe('600');
  });

  it('throws on a missing boundary', () => {
    expect(() => parseMultipart(Buffer.from('x'), 'application/json')).toThrowError(/boundary/);
  });
});
