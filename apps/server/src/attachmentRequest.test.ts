// P0 upload — request adapter, EXECUTED.
//
// This is the layer between attacker-controlled bytes and a sound decision. It
// runs `handleUploadRequest` — the exact function `index.ts` calls — against a
// real temp blob root, and asserts that every denial reaches neither the room
// lookup nor the filesystem.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Participant, Room } from '@agent-room/shared';
import { createLegacyLocalUploadBridge, handleUploadRequest, handleRawUploadRequest, handleUploadSocketRequest, MAX_IDENTITY_FIELD_BYTES, type VerifiedCaller } from './attachmentRequest.js';
import { parseMultipart } from './multipart.js';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'p0-req-'));
process.env.WAKICHAT_BLOB_DIR = TMP_ROOT;

const CODE = 'rose-elk-wood';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const shaAsync = async (s: string) => sha(s);

const ALICE_EMAIL = 'alice@example.test';
const MALLORY_EMAIL = 'mallory@example.test';
const AGENT_KEY = 'mk-agent-real';

let blobstore: typeof import('./blobstore.js');
beforeAll(async () => { blobstore = await import('./blobstore.js'); });
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

function blobTree(): string[] {
  if (!existsSync(TMP_ROOT)) return [];
  const out: string[] = [];
  const walk = (d: string, p: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = p ? `${p}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), rel); else out.push(rel);
    }
  };
  walk(TMP_ROOT, '');
  return out.sort();
}

const row = (o: Partial<Participant>): Participant => o as unknown as Participant;
const ALICE_WEB = row({ name: 'Alice', client: 'web', authIdHash: sha(ALICE_EMAIL) });
const AGENT_CC = row({ name: 'Agent', client: 'cc', memberKeyHash: sha(AGENT_KEY) });

function deps(over: { room?: Room; throwOnGet?: boolean } = {}) {
  const saveBlob = vi.fn(() => {
    const st = blobstore.saveBlob(CODE, Buffer.from('x'), 'text/plain');
    return { id: st.key, type: 'file', url: st.url, storageKey: `${CODE}/${st.key}`, name: 'x.txt', size: st.size, mime: 'text/plain', uploadedAt: 1 };
  });
  const getRoom = vi.fn(async () => {
    if (over.throwOnGet) throw Object.assign(new Error('gone'), { name: 'RoomNotFoundError' });
    return over.room ?? ({ code: CODE, status: 'active', participants: [ALICE_WEB, AGENT_CC] } as unknown as Room);
  });
  return { saveBlob, getRoom, sha256Hex: shaAsync };
}

const body = (fields: Record<string, string>, duplicateFields: string[] = []) => ({ fields, duplicateFields });
const USER: VerifiedCaller = { kind: 'user', email: ALICE_EMAIL };

describe('the adapter refuses before it looks anything up', () => {
  let before: string[];
  beforeEach(() => { before = blobTree(); });

  const early: Array<[string, VerifiedCaller, ReturnType<typeof body>, number, string]> = [
    ['an anonymous caller', { kind: 'anonymous' }, body({ name: 'Alice', client: 'web' }), 401, 'Unauthorized'],
    ['a duplicated name field', USER, body({ name: 'Alice', client: 'web' }, ['name']), 400, 'bad_request'],
    ['a duplicated memberKey field', USER, body({ name: 'Agent', client: 'cc' }, ['memberKey']), 400, 'bad_request'],
    ['an oversized name', USER, body({ name: 'A'.repeat(MAX_IDENTITY_FIELD_BYTES + 1), client: 'web' }), 400, 'bad_request'],
    ['an empty name', USER, body({ name: '   ', client: 'web' }), 400, 'bad_request'],
    ['a missing name field', USER, body({ client: 'web' }), 400, 'bad_request'],
    ['an invalid client kind', USER, body({ name: 'Alice', client: 'desktop' }), 400, 'bad_request'],
    ['a missing client field', USER, body({ name: 'Alice' }), 400, 'bad_request'],
  ];

  for (const [label, caller, b, status, error] of early) {
    it(`refuses ${label} without a room lookup or a write`, async () => {
      const d = deps();
      const out = await handleUploadRequest(caller, CODE, b, d);
      expect(out.authorized).toBe(false);
      expect(out.status).toBe(status);
      expect((out.body as { error: string }).error).toBe(error);
      expect(d.getRoom).not.toHaveBeenCalled();
      expect(d.saveBlob).not.toHaveBeenCalled();
      expect(blobTree()).toEqual(before);
    });
  }
});

describe('identity cannot be manufactured from the request body', () => {
  it('a multipart authIdHash field is ignored entirely', async () => {
    const d = deps();
    // Attacker supplies the hash of the victim's email directly.
    const out = await handleUploadRequest(
      { kind: 'user', email: MALLORY_EMAIL }, CODE,
      body({ name: 'Alice', client: 'web', authIdHash: sha(ALICE_EMAIL), verifiedAuthIdHash: sha(ALICE_EMAIL) }),
      d);
    expect(out.authorized).toBe(false);
    expect(d.saveBlob).not.toHaveBeenCalled();
  });

  it('an allowlisted account that owns no row is refused', async () => {
    const d = deps();
    const out = await handleUploadRequest(
      { kind: 'user', email: MALLORY_EMAIL }, CODE, body({ name: 'Alice', client: 'web' }), d);
    expect(out.authorized).toBe(false);
    expect(out.status).toBe(403);
    expect(d.saveBlob).not.toHaveBeenCalled();
  });

  it('a local caller gets no Access-derived identity and must present a key', async () => {
    const d = deps();
    // Same claim that succeeds for the real account fails for loopback.
    const out = await handleUploadRequest({ kind: 'local' }, CODE, body({ name: 'Alice', client: 'web' }), d);
    expect(out.authorized).toBe(false);
    expect(d.saveBlob).not.toHaveBeenCalled();
  });

  it('a web claim from a user caller authorizes only that caller\'s own row', async () => {
    const d = deps();
    const out = await handleUploadRequest(USER, CODE, body({ name: 'Alice', client: 'web' }), d);
    expect(out.authorized).toBe(true);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('an agent authorizes with its real member key and not without it', async () => {
    const withKey = deps();
    expect((await handleUploadRequest({ kind: 'local' }, CODE, body({ name: 'Agent', client: 'cc', memberKey: AGENT_KEY }), withKey)).authorized).toBe(true);
    const without = deps();
    expect((await handleUploadRequest({ kind: 'local' }, CODE, body({ name: 'Agent', client: 'cc' }), without)).authorized).toBe(false);
    expect(without.saveBlob).not.toHaveBeenCalled();
  });
});

describe('the transport matrix is closed — caller kind and client kind cannot be switched', () => {
  let before: string[];
  beforeEach(() => { before = blobTree(); });

  const matrix: Array<[string, VerifiedCaller, Record<string, string>, number]> = [
    ['user claiming cc', USER, { name: 'Agent', client: 'cc', memberKey: AGENT_KEY }, 403],
    ['user claiming cc without a key', USER, { name: 'Agent', client: 'cc' }, 403],
    ['local claiming web', { kind: 'local' }, { name: 'Alice', client: 'web' }, 403],
    ['local claiming web with a key', { kind: 'local' }, { name: 'Alice', client: 'web', memberKey: AGENT_KEY }, 403],
    ['web carrying a member credential', USER, { name: 'Alice', client: 'web', memberKey: AGENT_KEY }, 400],
    ['cc without a member credential', { kind: 'local' }, { name: 'Agent', client: 'cc' }, 403],
  ];

  for (const [label, caller, fields, status] of matrix) {
    it(`rejects ${label} before any room lookup`, async () => {
      const d = deps();
      const out = await handleUploadRequest(caller, CODE, body(fields), d);
      expect(out.authorized).toBe(false);
      expect(out.status).toBe(status);
      expect(d.getRoom).not.toHaveBeenCalled();
      expect(d.saveBlob).not.toHaveBeenCalled();
      expect(blobTree()).toEqual(before);
    });
  }

  it('an extra credential is refused, not silently ignored', async () => {
    // Dropping the key quietly would hide the attempt from the audit trail.
    const out = await handleUploadRequest(USER, CODE, body({ name: 'Alice', client: 'web', memberKey: 'sneaky' }), deps());
    expect(out.authorized).toBe(false);
    expect((out.body as { message: string }).message).toMatch(/must not carry a member credential/i);
  });

  it('the two legitimate pairings still work', async () => {
    const web = deps();
    expect((await handleUploadRequest(USER, CODE, body({ name: 'Alice', client: 'web' }), web)).authorized).toBe(true);
    const agent = deps();
    expect((await handleUploadRequest({ kind: 'local' }, CODE, body({ name: 'Agent', client: 'cc', memberKey: AGENT_KEY }), agent)).authorized).toBe(true);
  });
});

describe('room state is honoured through the adapter', () => {
  it('a missing room is 404 with no write', async () => {
    const before = blobTree();
    const d = deps({ throwOnGet: true });
    const out = await handleUploadRequest(USER, CODE, body({ name: 'Alice', client: 'web' }), d);
    expect(out.status).toBe(404);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('an ended room is 409, distinct from missing, with no write', async () => {
    const before = blobTree();
    const d = deps({ room: { code: CODE, status: 'ended', participants: [ALICE_WEB] } as unknown as Room });
    const out = await handleUploadRequest(USER, CODE, body({ name: 'Alice', client: 'web' }), d);
    expect(out.status).toBe(409);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });
});

describe('real multipart bytes flow through the adapter', () => {
  function multipart(parts: Array<[string, string]>): { fields: Record<string, string>; duplicateFields: string[] } {
    const b = 'X-BOUND';
    const chunks = parts.map(([k, v]) =>
      `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
    const raw = Buffer.from(chunks.join('') + `--${b}--\r\n`);
    const parsed = parseMultipart(raw, `multipart/form-data; boundary=${b}`);
    return { fields: parsed.fields, duplicateFields: parsed.duplicateFields };
  }

  it('the parser reports a duplicated field instead of silently keeping the last', () => {
    const parsed = multipart([['name', 'Alice'], ['name', 'Mallory'], ['client', 'web']]);
    expect(parsed.duplicateFields).toContain('name');
    // Last-wins is exactly the ambiguity the adapter must refuse.
    expect(parsed.fields.name).toBe('Mallory');
  });

  it('a duplicated identity field parsed from real bytes is refused, no write', async () => {
    const before = blobTree();
    const d = deps();
    const out = await handleUploadRequest(USER, CODE, multipart([['name', 'Alice'], ['name', 'Mallory'], ['client', 'web']]), d);
    expect(out.authorized).toBe(false);
    expect(out.status).toBe(400);
    expect(d.getRoom).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('a clean single-identity body parsed from real bytes is authorized', async () => {
    const d = deps();
    const out = await handleUploadRequest(USER, CODE, multipart([['name', 'Alice'], ['client', 'web']]), d);
    expect(out.authorized).toBe(true);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
  });
});

describe('status and body translation is stable and secret-free', () => {
  it('denials carry an error and message, never a hash or path', async () => {
    const out = await handleUploadRequest(
      { kind: 'local' }, CODE, body({ name: 'Agent', client: 'cc', memberKey: 'wrong-key' }), deps());
    const s = JSON.stringify(out.body);
    expect(s).not.toContain(sha('wrong-key'));
    expect(s).not.toContain('wrong-key');
    expect(s).not.toContain(TMP_ROOT);
  });

  it('an authorized response returns the stored blob descriptor, nothing more', async () => {
    const out = await handleUploadRequest(USER, CODE, body({ name: 'Alice', client: 'web' }), deps());
    expect(out.status).toBe(200);
    expect(Object.keys(out.body as object).sort()).toEqual(['id', 'mime', 'name', 'size', 'storageKey', 'type', 'uploadedAt', 'url']);
  });
});

describe('the raw adapter owns the whole socket→status path', () => {
  const CT = 'multipart/form-data; boundary=RAWB';
  /** Build real multipart bytes, including a file part. */
  function raw(fields: Array<[string, string]>, files: Array<[string, string, string, Buffer]> = [['file', 'a.txt', 'text/plain', Buffer.from('hello')]]) {
    const b = 'RAWB';
    const fieldParts = fields.map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const fileParts = files.map(([field, filename, ctype, data]) =>
      Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${ctype}\r\n\r\n`),
        data, Buffer.from('\r\n'),
      ]));
    return Buffer.concat([Buffer.from(fieldParts), ...fileParts, Buffer.from(`--${b}--\r\n`)]);
  }

  function rawDeps(over: { room?: Room } = {}) {
    const saveBlob = vi.fn((code: string, f: { data: Buffer; mime: string; filename: string; width?: number; height?: number }) => {
      const st = blobstore.saveBlob(code, f.data, f.mime);
      return { id: st.key, type: 'file', url: st.url, storageKey: `${code}/${st.key}`, name: f.filename, size: st.size, mime: f.mime, uploadedAt: 1,
        ...(f.width && f.height ? { width: f.width, height: f.height } : {}) };
    });
    const getRoom = vi.fn(async () => over.room ?? ({ code: CODE, status: 'active', participants: [ALICE_WEB, AGENT_CC] } as unknown as Room));
    return { saveBlob, getRoom, sha256Hex: shaAsync, isAllowedMime: (m: string) => m === 'text/plain', maxBytes: 1024 };
  }

  let before: string[];
  beforeEach(() => { before = blobTree(); });

  const denials: Array<[string, VerifiedCaller, Buffer, string, number, string]> = [
    ['a non-multipart content type', USER, Buffer.from('{}'), 'application/json', 400, 'bad_request'],
    ['a malformed multipart body', USER, Buffer.from('not multipart at all'), 'multipart/form-data', 400, 'bad_request'],
  ];
  for (const [label, caller, bytes, ct, status, error] of denials) {
    it(`rejects ${label} with no lookup or write`, async () => {
      const d = rawDeps();
      const out = await handleRawUploadRequest(caller, { contentType: ct, body: bytes }, d);
      expect(out.status).toBe(status);
      expect((out.body as { error: string }).error).toBe(error);
      expect(d.getRoom).not.toHaveBeenCalled();
      expect(d.saveBlob).not.toHaveBeenCalled();
      expect(blobTree()).toEqual(before);
    });
  }

  const bodyDenials: Array<[string, VerifiedCaller, Buffer, number, string]> = [
    ['a missing roomCode', USER, raw([['name', 'Alice'], ['client', 'web']]), 400, 'bad_request'],
    ['an unparseable roomCode', USER, raw([['roomCode', '!!!'], ['name', 'Alice'], ['client', 'web']]), 400, 'bad_request'],
    ['no file part', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']], []), 400, 'no_file'],
    ['an empty file', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']], [['file', 'e.txt', 'text/plain', Buffer.alloc(0)]]), 400, 'empty_file'],
    ['an oversized file', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']], [['file', 'b.txt', 'text/plain', Buffer.alloc(2048)]]), 413, 'file_too_large'],
    ['a disallowed MIME', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']], [['file', 'x.exe', 'application/x-msdownload', Buffer.from('MZ')]]), 415, 'mime_not_allowed'],
    ['duplicate file parts', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']], [['file', 'a.txt', 'text/plain', Buffer.from('one')], ['file', 'b.txt', 'text/plain', Buffer.from('two')]]), 400, 'bad_request'],
    ['a duplicated name field in real bytes', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['name', 'Mallory'], ['client', 'web']]), 400, 'bad_request'],
    ['a user claiming cc', USER, raw([['roomCode', CODE], ['name', 'Agent'], ['client', 'cc'], ['memberKey', AGENT_KEY]]), 403, 'forbidden'],
    ['a local caller claiming web', { kind: 'local' }, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']]), 403, 'forbidden'],
    ['a web upload carrying a memberKey', USER, raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web'], ['memberKey', AGENT_KEY]]), 400, 'bad_request'],
  ];
  for (const [label, caller, bytes, status, error] of bodyDenials) {
    it(`rejects ${label} without writing`, async () => {
      const d = rawDeps();
      const out = await handleRawUploadRequest(caller, { contentType: CT, body: bytes }, d);
      expect(out.authorized).toBe(false);
      expect(out.status).toBe(status);
      expect((out.body as { error: string }).error).toBe(error);
      expect(d.saveBlob).not.toHaveBeenCalled();
      expect(blobTree()).toEqual(before);
    });
  }

  it('anonymous is refused before the body is parsed at all', async () => {
    const d = rawDeps();
    const out = await handleRawUploadRequest({ kind: 'anonymous' }, { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']]) }, d);
    expect(out.status).toBe(401);
    expect(d.getRoom).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('a legitimate web upload succeeds end-to-end from raw bytes', async () => {
    const d = rawDeps();
    const out = await handleRawUploadRequest(USER, { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']]) }, d);
    expect(out.authorized).toBe(true);
    expect(out.status).toBe(200);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
    // The blob is written under the CANONICAL code the adapter resolved.
    expect(d.saveBlob.mock.calls[0]![0]).toBe(CODE);
    expect(blobTree().length).toBe(before.length + 1);
  });

  it('a legitimate agent upload succeeds end-to-end from raw bytes', async () => {
    const d = rawDeps();
    const out = await handleRawUploadRequest({ kind: 'local' },
      { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Agent'], ['client', 'cc'], ['memberKey', AGENT_KEY]]) }, d);
    expect(out.authorized).toBe(true);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('a success returns the COMPLETE attachment descriptor clients consume', async () => {
    const d = rawDeps();
    const out = await handleRawUploadRequest(USER, { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']]) }, d);
    expect(out.authorized).toBe(true);
    const att = out.body as Record<string, unknown>;
    // Regression guard: returning only {key,url,size} silently breaks web+MCP,
    // which read these fields off the response.
    for (const field of ['id', 'type', 'url', 'storageKey', 'name', 'size', 'mime', 'uploadedAt']) {
      expect(att[field], `missing ${field}`).toBeDefined();
    }
    expect(att.name).toBe('a.txt');
    expect(att.mime).toBe('text/plain');
    expect(String(att.storageKey)).toContain(CODE);
  });

  it('image dimensions ride through when supplied', async () => {
    const d = rawDeps();
    const out = await handleRawUploadRequest(USER,
      { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web'], ['width', '800'], ['height', '600']]) }, d);
    expect((out.body as Record<string, unknown>).width).toBe(800);
    expect((out.body as Record<string, unknown>).height).toBe(600);
  });

  const fileDenials: Array<[string, Array<[string, string, string, Buffer]>, string]> = [
    ['a second file part under a different name',
      [['file', 'a.txt', 'text/plain', Buffer.from('one')], ['extra', 'b.txt', 'text/plain', Buffer.from('two')]], 'bad_request'],
    ['a single file part with the wrong field name',
      [['attachment', 'a.txt', 'text/plain', Buffer.from('one')]], 'bad_request'],
    ['a blank filename',
      [['file', '   ', 'text/plain', Buffer.from('one')]], 'bad_request'],
    ['an over-long filename',
      [['file', 'x'.repeat(300) + '.txt', 'text/plain', Buffer.from('one')]], 'bad_request'],
  ];
  for (const [label, files, error] of fileDenials) {
    it(`rejects ${label} without writing`, async () => {
      const d = rawDeps();
      const out = await handleRawUploadRequest(USER,
        { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']], files) }, d);
      expect(out.authorized).toBe(false);
      expect((out.body as { error: string }).error).toBe(error);
      expect(d.saveBlob).not.toHaveBeenCalled();
    });
  }

  for (const field of ['roomCode', 'client', 'memberKey']) {
    it(`rejects a duplicated ${field} field from real bytes`, async () => {
      const d = rawDeps();
      const fields: Array<[string, string]> = [['roomCode', CODE], ['name', 'Alice'], ['client', 'web']];
      fields.push([field, field === 'roomCode' ? CODE : field === 'client' ? 'web' : 'k']);
      const out = await handleRawUploadRequest(USER, { contentType: CT, body: raw(fields) }, d);
      expect(out.authorized).toBe(false);
      expect(out.status).toBe(400);
      expect(d.saveBlob).not.toHaveBeenCalled();
    });
  }

  it('an ended room is refused after parsing, still with no write', async () => {
    const d = rawDeps({ room: { code: CODE, status: 'ended', participants: [ALICE_WEB] } as unknown as Room });
    const out = await handleRawUploadRequest(USER, { contentType: CT, body: raw([['roomCode', CODE], ['name', 'Alice'], ['client', 'web']]) }, d);
    expect(out.status).toBe(409);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });
});

describe('the production-called socket seam gates body reads', () => {
  it('returns 401 to anonymous callers without reading one body byte', async () => {
    const d = deps();
    const readBody = vi.fn(async () => Buffer.from('attacker payload'));
    const out = await handleUploadSocketRequest(
      { kind: 'anonymous' },
      'multipart/form-data; boundary=never-read',
      { ...d, readBody, isAllowedMime: () => true, maxBytes: 1024 },
    );

    expect(out.status).toBe(401);
    expect((out.body as { error: string }).error).toBe('Unauthorized');
    expect(readBody).not.toHaveBeenCalled();
    expect(d.getRoom).not.toHaveBeenCalled();
    expect(d.saveBlob).not.toHaveBeenCalled();
  });

  it('reads an authenticated request body exactly once', async () => {
    const d = deps();
    const readBody = vi.fn(async () => Buffer.from('malformed'));
    const out = await handleUploadSocketRequest(
      USER,
      'multipart/form-data; boundary=bad',
      { ...d, readBody, isAllowedMime: () => true, maxBytes: 1024 },
    );

    expect(out.status).toBe(400);
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(d.getRoom).not.toHaveBeenCalled();
    expect(d.saveBlob).not.toHaveBeenCalled();
  });

  it('maps a body-reader refusal to 413 without parsing or writing', async () => {
    const d = deps();
    const readBody = vi.fn(async () => { throw new Error('body too large'); });
    const out = await handleUploadSocketRequest(
      USER,
      'multipart/form-data; boundary=too-large',
      { ...d, readBody, isAllowedMime: () => true, maxBytes: 1024 },
    );

    expect(out.status).toBe(413);
    expect((out.body as { error: string }).error).toBe('file_too_large');
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(d.getRoom).not.toHaveBeenCalled();
    expect(d.saveBlob).not.toHaveBeenCalled();
  });
});

describe('the bounded legacy-local transition bridge', () => {
  const CT = 'multipart/form-data; boundary=LEGACY';
  const START = Date.parse('2026-08-01T12:00:00Z');
  const rawLegacy = (code = CODE, data = Buffer.from('png')) => Buffer.concat([
    Buffer.from(`--LEGACY\r\nContent-Disposition: form-data; name="roomCode"\r\n\r\n${code}\r\n`),
    Buffer.from('--LEGACY\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n'),
    data,
    Buffer.from('\r\n--LEGACY--\r\n'),
  ]);

  const bridge = (over: Partial<Parameters<typeof createLegacyLocalUploadBridge>[0]> = {}) =>
    createLegacyLocalUploadBridge({
      enabled: true,
      startedAtMs: START,
      expiresAtMs: START + 6 * 60 * 60 * 1000,
      now: () => START + 1,
      ...over,
    });

  function socketDeps(over: { room?: Room; legacy?: ReturnType<typeof bridge> } = {}) {
    const saveBlob = vi.fn((code: string, f: { data: Buffer; mime: string; filename: string }) => {
      const st = blobstore.saveBlob(code, f.data, f.mime);
      return { id: st.key, type: 'image', url: st.url, storageKey: `${code}/${st.key}`, name: f.filename, size: st.size, mime: f.mime, uploadedAt: 1 };
    });
    return {
      saveBlob,
      getRoom: vi.fn(async () => over.room ?? ({ code: CODE, status: 'active', participants: [AGENT_CC] } as unknown as Room)),
      sha256Hex: shaAsync,
      isAllowedMime: (m: string) => m === 'image/png',
      maxBytes: 1024,
      legacyLocalUploadBridge: over.legacy,
      readBody: vi.fn(async () => rawLegacy()),
    };
  }

  it('accepts the exact old-MCP socket shape only while explicitly enabled and marks/audits it', async () => {
    const d = socketDeps({ legacy: bridge() });
    const before = blobTree();
    const out = await handleUploadSocketRequest({ kind: 'local' }, CT, d);
    expect(out.authorized).toBe(true);
    expect(out.status).toBe(200);
    expect((out.body as Record<string, unknown>).legacyLocalUnbound).toBe(true);
    expect(out.audit).toMatch(/^legacy_local_unbound accepted/);
    expect(d.readBody).toHaveBeenCalledTimes(1);
    expect(d.getRoom).toHaveBeenCalledTimes(1);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
    expect(blobTree().length).toBe(before.length + 1);
  });

  const refusedConfigs: Array<[string, ReturnType<typeof bridge>]> = [
    ['disabled', bridge({ enabled: false })],
    ['missing expiry', bridge({ expiresAtMs: Number.NaN })],
    ['expired', bridge({ expiresAtMs: START, now: () => START + 1 })],
    ['over the 24-hour hard cap', bridge({ expiresAtMs: START + 24 * 60 * 60 * 1000 + 1 })],
  ];
  for (const [label, legacy] of refusedConfigs) {
    it(`keeps ${label} zero-write`, async () => {
      const before = blobTree();
      const d = socketDeps({ legacy });
      const out = await handleUploadSocketRequest({ kind: 'local' }, CT, d);
      expect(out.authorized).toBe(false);
      expect(d.getRoom).not.toHaveBeenCalled();
      expect(d.saveBlob).not.toHaveBeenCalled();
      expect(blobTree()).toEqual(before);
    });
  }

  it('denies public/user legacy bytes and every non-exact local scalar shape', async () => {
    const before = blobTree();
    const user = socketDeps({ legacy: bridge() });
    expect((await handleUploadSocketRequest(USER, CT, user)).authorized).toBe(false);
    expect(user.saveBlob).not.toHaveBeenCalled();

    for (const field of ['name', 'client', 'memberKey']) {
      const d = socketDeps({ legacy: bridge() });
      d.readBody = vi.fn(async () => Buffer.from(
        `--LEGACY\r\nContent-Disposition: form-data; name="roomCode"\r\n\r\n${CODE}\r\n` +
        `--LEGACY\r\nContent-Disposition: form-data; name="${field}"\r\n\r\npartial\r\n` +
        '--LEGACY\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\npng\r\n--LEGACY--\r\n'));
      expect((await handleUploadSocketRequest({ kind: 'local' }, CT, d)).authorized).toBe(false);
      expect(d.saveBlob).not.toHaveBeenCalled();
    }
    for (const field of ['width', 'unexpected']) {
      const d = socketDeps({ legacy: bridge() });
      d.readBody = vi.fn(async () => Buffer.from(
        `--LEGACY\r\nContent-Disposition: form-data; name="roomCode"\r\n\r\n${CODE}\r\n` +
        `--LEGACY\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n1\r\n` +
        '--LEGACY\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\npng\r\n--LEGACY--\r\n'));
      expect((await handleUploadSocketRequest({ kind: 'local' }, CT, d)).authorized).toBe(false);
      expect(d.saveBlob).not.toHaveBeenCalled();
    }
    expect(blobTree()).toEqual(before);
  });

  it('denies a duplicated legacy roomCode before lookup or save', async () => {
    const before = blobTree();
    const d = socketDeps({ legacy: bridge() });
    d.readBody = vi.fn(async () => Buffer.from(
      `--LEGACY\r\nContent-Disposition: form-data; name="roomCode"\r\n\r\n${CODE}\r\n` +
      `--LEGACY\r\nContent-Disposition: form-data; name="roomCode"\r\n\r\n${CODE}\r\n` +
      '--LEGACY\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\npng\r\n--LEGACY--\r\n'));
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, d)).authorized).toBe(false);
    expect(d.getRoom).not.toHaveBeenCalled();
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('denies ended rooms before reservation/save', async () => {
    const before = blobTree();
    const d = socketDeps({
      legacy: bridge(),
      room: { code: CODE, status: 'ended', participants: [AGENT_CC] } as unknown as Room,
    });
    const out = await handleUploadSocketRequest({ kind: 'local' }, CT, d);
    expect(out.status).toBe(409);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('atomically enforces count and byte budgets before save', async () => {
    const countBudget = bridge({ roomMaxFiles: 1, globalMaxFiles: 1 });
    const first = socketDeps({ legacy: countBudget });
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, first)).authorized).toBe(true);
    const second = socketDeps({ legacy: countBudget });
    const denied = await handleUploadSocketRequest({ kind: 'local' }, CT, second);
    expect(denied.status).toBe(429);
    expect(second.saveBlob).not.toHaveBeenCalled();

    const byteBudget = bridge({ roomMaxBytes: 2, globalMaxBytes: 2 });
    const bytes = socketDeps({ legacy: byteBudget });
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, bytes)).status).toBe(429);
    expect(bytes.saveBlob).not.toHaveBeenCalled();
  });

  it('releases a failed pre-save reservation so a retry can proceed', async () => {
    const one = bridge({ roomMaxFiles: 1, globalMaxFiles: 1 });
    const d = socketDeps({ legacy: one });
    d.saveBlob.mockImplementationOnce(() => { throw new Error('disk failed'); });
    await expect(handleUploadSocketRequest({ kind: 'local' }, CT, d)).rejects.toThrow('disk failed');
    const retry = socketDeps({ legacy: one });
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, retry)).authorized).toBe(true);
  });

  it('documents the process-local restart reset while the absolute expiry remains', async () => {
    const opts = { roomMaxFiles: 1, globalMaxFiles: 1 };
    const firstProcess = bridge(opts);
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, socketDeps({ legacy: firstProcess }))).authorized).toBe(true);
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, socketDeps({ legacy: firstProcess }))).status).toBe(429);
    // A new server process owns a new in-memory counter. The configured UTC
    // expiry does not move, but capacity resets; this is an explicit residual.
    const restartedProcess = bridge(opts);
    expect((await handleUploadSocketRequest({ kind: 'local' }, CT, socketDeps({ legacy: restartedProcess }))).authorized).toBe(true);
  });
});
