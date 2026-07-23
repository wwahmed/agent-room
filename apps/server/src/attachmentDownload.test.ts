import { describe, it, expect } from 'vitest';
import type { Message, MessageAttachment } from '@agent-room/shared';
import {
  selectAttachment, storageKeyFor, sniffMime, sha256Hex, verifyIntegrity,
  signDownloadToken, verifyDownloadToken, AttachmentDownloadError,
  MAX_DOWNLOAD_BYTES,
} from './attachmentDownload.js';

const att = (over: Partial<MessageAttachment> = {}): MessageAttachment => ({
  id: 'att-1', type: 'file', url: '/blobs/twig-ant-stem/deadbeef.zip',
  storageKey: 'twig-ant-stem/deadbeef.zip', name: 'bundle.zip', size: 4,
  mime: 'application/zip', uploadedAt: 1000, ...over,
});
const msg = (id: number, atts: MessageAttachment[]): Message => ({
  id, type: 'msg', name: 'Waqas', initials: 'WA', color: '#EC4899', role: '',
  text: 'here', client: 'web', time: id, attachments: atts,
});

describe('T-123 selectAttachment — room-scoped resolve', () => {
  const messages = [msg(1, [att({ id: 'a', name: 'old.zip', url: '/blobs/r/1.zip' })]), msg(2, [att({ id: 'b', name: 'new.zip', url: '/blobs/r/2.zip' })])];
  it('resolves by id', () => { expect(selectAttachment(messages, { id: 'b' })?.attachment.name).toBe('new.zip'); });
  it('resolves by name, newest wins', () => {
    const dup = [...messages, msg(3, [att({ id: 'c', name: 'new.zip', url: '/blobs/r/3.zip' })])];
    expect(selectAttachment(dup, { name: 'new.zip' })?.attachment.id).toBe('c');
  });
  it('resolves by relative or absolute url (origin-agnostic)', () => {
    expect(selectAttachment(messages, { url: '/blobs/r/2.zip' })?.attachment.id).toBe('b');
    expect(selectAttachment(messages, { url: 'https://chat.wakilabs.dev/blobs/r/2.zip?x=1' })?.attachment.id).toBe('b');
  });
  it('returns null for an unknown selector and for no selector', () => {
    expect(selectAttachment(messages, { id: 'zzz' })).toBeNull();
    expect(selectAttachment(messages, {})).toBeNull();
  });
  it('carries the uploader message id + upload time', () => {
    const r = selectAttachment(messages, { id: 'b' })!;
    expect(r.uploaderMessageId).toBe(2);
    expect(r.uploadedAt).toBe(1000);
  });
});

describe('T-123 storageKeyFor — never trusts a caller key', () => {
  it('prefers the storageKey leaf', () => { expect(storageKeyFor(att())).toBe('deadbeef.zip'); });
  it('falls back to the url leaf', () => { expect(storageKeyFor(att({ storageKey: undefined }))).toBe('deadbeef.zip'); });
  it('rejects a url that is not a /blobs/ path', () => { expect(storageKeyFor(att({ storageKey: undefined, url: '/etc/passwd' }))).toBeNull(); });
});

describe('T-123 sniffMime — detect from magic bytes', () => {
  it('detects png/jpeg/pdf/zip/gzip', () => {
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe('application/zip');
    expect(sniffMime(Buffer.from([0x1f, 0x8b, 0x08]))).toBe('application/gzip');
  });
  it('detects text vs binary heuristically', () => {
    expect(sniffMime(Buffer.from('hello world, plain text\n'))).toBe('text/plain');
    expect(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0x00, 0x00]))).toBe('application/octet-stream');
  });
});

describe('T-123 verifyIntegrity — fail closed on tamper/oversize', () => {
  it('passes a matching payload and returns digest + detected mime', () => {
    const data = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const r = verifyIntegrity(data, att({ size: 4 }));
    expect(r.bytes).toBe(4);
    expect(r.sha256).toBe(sha256Hex(data));
    expect(r.detectedMime).toBe('application/zip');
  });
  it('throws integrity_mismatch when stored size disagrees (truncation/tamper)', () => {
    try { verifyIntegrity(Buffer.from([1, 2, 3]), att({ size: 4 })); expect.unreachable(); }
    catch (e) { expect((e as AttachmentDownloadError).code).toBe('integrity_mismatch'); }
  });
  it('throws too_large above the ceiling', () => {
    const big = Buffer.alloc(MAX_DOWNLOAD_BYTES + 1);
    try { verifyIntegrity(big, att({ size: big.length })); expect.unreachable(); }
    catch (e) { expect((e as AttachmentDownloadError).code).toBe('too_large'); }
  });
});

describe('T-123 signed download tokens — HMAC, expiry, tamper, one-time-shape', () => {
  const secret = 'test-signing-secret';
  const claims = { code: 'twig-ant-stem', attachmentId: 'att-1', storageKey: 'deadbeef.zip', participant: 'Codex|cc', op: 'download' as const, exp: 2000, nonce: 'n1' };
  it('round-trips a valid, unexpired token', () => {
    const tok = signDownloadToken(secret, claims);
    expect(verifyDownloadToken(secret, tok, 1500)).toMatchObject({ attachmentId: 'att-1', nonce: 'n1' });
  });
  it('rejects an expired token', () => {
    const tok = signDownloadToken(secret, claims);
    try { verifyDownloadToken(secret, tok, 2500); expect.unreachable(); }
    catch (e) { expect((e as AttachmentDownloadError).code).toBe('expired'); }
  });
  it('rejects a tampered payload (constant-time MAC mismatch)', () => {
    const tok = signDownloadToken(secret, claims);
    const forged = tok.replace(/^[^.]+/, b => b.slice(0, -1) + (b.slice(-1) === 'A' ? 'B' : 'A'));
    try { verifyDownloadToken(secret, forged, 1500); expect.unreachable(); }
    catch (e) { expect((e as AttachmentDownloadError).code).toBe('bad_request'); }
  });
  it('rejects a token signed with a different secret (key rotation safety)', () => {
    const tok = signDownloadToken('old-secret', claims);
    try { verifyDownloadToken(secret, tok, 1500); expect.unreachable(); }
    catch (e) { expect((e as AttachmentDownloadError).code).toBe('bad_request'); }
  });
});
