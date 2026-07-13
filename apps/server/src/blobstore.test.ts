import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the store at a throwaway dir BEFORE importing it (BLOB_ROOT is read at
// module load).
const TMP = mkdtempSync(join(tmpdir(), 'blobtest-'));
process.env.WAKICHAT_BLOB_DIR = TMP;

const store = await import('./blobstore.js');

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('T-51 blobstore', () => {
  it('save → read round-trips bytes exactly', () => {
    const data = Buffer.from([0, 1, 2, 255, 13, 10, 45, 45]);
    const saved = store.saveBlob('D64-2UJ-FNR', data, 'image/png');
    expect(saved.url).toMatch(/^\/blobs\/D64-2UJ-FNR\/[a-f0-9]{32}\.png$/);
    expect(saved.size).toBe(data.length);
    const loaded = store.readBlob('D64-2UJ-FNR', saved.key);
    expect(loaded).not.toBeNull();
    expect(loaded!.data.equals(data)).toBe(true);
    expect(loaded!.ext).toBe('png');
  });

  it('derives extension from mime, not filename', () => {
    const s = store.saveBlob('door-cat-hall', Buffer.from('%PDF'), 'application/pdf');
    expect(s.key.endsWith('.pdf')).toBe(true);
  });

  it('rejects a disallowed mime', () => {
    expect(() => store.saveBlob('D64-2UJ-FNR', Buffer.from('x'), 'application/x-sh')).toThrowError(/mime/);
  });

  it('readBlob returns null for traversal / malformed code or key', () => {
    expect(store.readBlob('../etc', 'passwd')).toBeNull();
    expect(store.readBlob('D64-2UJ-FNR', '../../etc/passwd')).toBeNull();
    expect(store.readBlob('D64-2UJ-FNR', 'not-a-key')).toBeNull();
    expect(store.readBlob('D64-2UJ-FNR', 'deadbeef.png')).toBeNull(); // wrong-length key
  });

  it('saveBlob rejects an invalid room code (path safety)', () => {
    expect(() => store.saveBlob('../evil', Buffer.from('x'), 'image/png')).toThrowError(/room code/);
  });

  it('deleteRoomBlobs removes a room dir and counts files', () => {
    store.saveBlob('gone-soon-room', Buffer.from('a'), 'text/plain');
    store.saveBlob('gone-soon-room', Buffer.from('b'), 'text/plain');
    expect(store.deleteRoomBlobs('gone-soon-room')).toBe(2);
    expect(store.deleteRoomBlobs('gone-soon-room')).toBe(0); // idempotent
  });

  it('helpers: kind + allow-list', () => {
    expect(store.attachmentKind('image/webp')).toBe('image');
    expect(store.attachmentKind('application/pdf')).toBe('file');
    expect(store.isAllowedMime('image/gif')).toBe(true);
    expect(store.isAllowedMime('application/x-msdownload')).toBe(false);
  });
});
