// P0 attachment authorization — EXECUTED against the production seam.
//
// These call `executeUpload`, the exact function `index.ts` calls, with a real
// temp blob root and the real `saveBlob` injected. Nothing here re-implements
// the effect gate, so deleting the guard in production fails these tests too.
// Identity is resolved against real hashed participant rows — no mock stands in
// for the credential logic it claims to prove.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Participant, Room } from '@agent-room/shared';
import { executeUpload, authorizePurge, selectAuthorizedRow, parseClientKind, type CallerKind } from './attachmentAuth.js';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'p0-blob-'));
process.env.WAKICHAT_BLOB_DIR = TMP_ROOT;

const CODE = 'rose-elk-wood';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const AGENT_KEY = 'mk-agent-real';
const OTHER_ROOM_KEY = 'mk-belongs-to-another-room';
const ALICE_EMAIL = 'alice@example.test';
const MALLORY_EMAIL = 'mallory@example.test';

let blobstore: typeof import('./blobstore.js');
beforeAll(async () => { blobstore = await import('./blobstore.js'); });
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

function blobTree(): string[] {
  if (!existsSync(TMP_ROOT)) return [];
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), rel);
      else out.push(rel);
    }
  };
  walk(TMP_ROOT, '');
  return out.sort();
}

const row = (o: Partial<Participant>): Participant => o as unknown as Participant;

/** Real rows with real hashes — the shapes production actually stores. */
const ALICE_WEB = row({ name: 'Alice', client: 'web', authIdHash: sha(ALICE_EMAIL) });
const AGENT_CC = row({ name: 'Agent', client: 'cc', memberKeyHash: sha(AGENT_KEY) });
const VIEWER_WEB = row({ name: 'Watcher', client: 'web', authIdHash: sha(ALICE_EMAIL), viewer: true });
const KEYLESS_CC = row({ name: 'Ghost', client: 'cc' });

function makeRoom(over: Partial<Room> = {}): Room {
  return {
    code: CODE, status: 'active',
    participants: [ALICE_WEB, AGENT_CC, VIEWER_WEB, KEYLESS_CC],
    ...(over as object),
  } as unknown as Room;
}

/** Deps wired exactly as index.ts wires them, with a spyable saveBlob. */
function deps(over: { room?: Room; throwOnGet?: boolean } = {}) {
  const saveBlob = vi.fn(() => {
    const st = blobstore.saveBlob(CODE, Buffer.from('payload'), 'text/plain');
    return { id: st.key, type: 'file', url: st.url, storageKey: `${CODE}/${st.key}`, name: 'payload.txt', size: st.size, mime: 'text/plain', uploadedAt: 1 };
  });
  return {
    saveBlob,
    getRoom: async () => {
      if (over.throwOnGet) throw Object.assign(new Error('gone'), { name: 'RoomNotFoundError' });
      return over.room ?? makeRoom();
    },
  };
}

describe('P0 upload — every denial performs zero writes', () => {
  let before: string[];
  beforeEach(() => { before = blobTree(); });

  const cases: Array<[string, Parameters<typeof executeUpload>[0], number, string, Parameters<typeof deps>[0]?]> = [
    ['anonymous caller',
      { code: CODE, name: 'Alice', clientKind: 'web', callerKind: 'anonymous' }, 401, 'Unauthorized'],
    ['invalid client kind (not coerced to web)',
      { code: CODE, name: 'Alice', clientKind: parseClientKind('desktop'), callerKind: 'user' }, 400, 'bad_request'],
    ['missing participant name',
      { code: CODE, name: '  ', clientKind: 'web', callerKind: 'user' }, 400, 'bad_request'],
    ['room does not exist',
      { code: CODE, name: 'Alice', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' },
      404, 'room_not_found', { throwOnGet: true }],
    ['room has ended',
      { code: CODE, name: 'Alice', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' },
      409, 'room_ended', { room: makeRoom({ status: 'ended' }) }],
    ['name that matches no row',
      { code: CODE, name: 'Nobody', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' }, 403, 'forbidden'],
    ['signed-in account that does not own the row',
      { code: CODE, name: 'Alice', clientKind: 'web', verifiedAuthIdHash: sha(MALLORY_EMAIL), callerKind: 'user' }, 403, 'forbidden'],
    ['agent presenting no key for a keyed row',
      { code: CODE, name: 'Agent', clientKind: 'cc', callerKind: 'user' }, 403, 'forbidden'],
    ['agent presenting a wrong key',
      { code: CODE, name: 'Agent', clientKind: 'cc', presentedKeyHash: sha('mk-wrong'), callerKind: 'user' }, 403, 'forbidden'],
    ["agent presenting another room's key",
      { code: CODE, name: 'Agent', clientKind: 'cc', presentedKeyHash: sha(OTHER_ROOM_KEY), callerKind: 'user' }, 403, 'forbidden'],
    ['viewer row',
      { code: CODE, name: 'Watcher', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' }, 403, 'forbidden'],
    ['keyless row (name-only), regardless of any compatibility flag',
      { code: CODE, name: 'Ghost', clientKind: 'cc', callerKind: 'user' }, 403, 'forbidden'],
    ['trusted local caller is still participant-bound',
      { code: CODE, name: 'Ghost', clientKind: 'cc', callerKind: 'local' }, 403, 'forbidden'],
  ];

  for (const [label, req, status, error, over] of cases) {
    it(`denies ${label} — ${status}, no file written`, async () => {
      const d = deps(over);
      const out = await executeUpload(req, d);
      expect(out.allow).toBe(false);
      expect((out as { status: number }).status).toBe(status);
      expect((out as { error: string }).error).toBe(error);
      expect(d.saveBlob).not.toHaveBeenCalled();
      expect(blobTree()).toEqual(before);
    });
  }

  it('missing and ended rooms stay distinct failures', async () => {
    const missing = await executeUpload(
      { code: CODE, name: 'Alice', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' },
      deps({ throwOnGet: true }));
    const ended = await executeUpload(
      { code: CODE, name: 'Alice', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' },
      deps({ room: makeRoom({ status: 'ended' }) }));
    expect((missing as { status: number }).status).toBe(404);
    expect((ended as { status: number }).status).toBe(409);
  });

  it('never leaks a credential hash or a filesystem path in the refusal', async () => {
    const out = await executeUpload(
      { code: CODE, name: 'Agent', clientKind: 'cc', presentedKeyHash: sha('mk-wrong'), callerKind: 'user' },
      deps());
    const s = JSON.stringify(out);
    expect(s).not.toContain(sha('mk-wrong'));
    expect(s).not.toContain(TMP_ROOT);
  });
});

describe('P0 upload — authorized participants still work, exactly once', () => {
  it('allows a verified web participant and writes exactly one file', async () => {
    const before = blobTree();
    const d = deps();
    const out = await executeUpload(
      { code: CODE, name: 'Alice', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' }, d);
    expect(out.allow).toBe(true);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
    expect(blobTree().length).toBe(before.length + 1);
  });

  it('allows an agent presenting its real member key', async () => {
    const before = blobTree();
    const d = deps();
    const out = await executeUpload(
      { code: CODE, name: 'Agent', clientKind: 'cc', presentedKeyHash: sha(AGENT_KEY), callerKind: 'user' }, d);
    expect(out.allow).toBe(true);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
    expect(blobTree().length).toBe(before.length + 1);
  });

  it('returns the row the credential matched, not merely some row', async () => {
    const out = await executeUpload(
      { code: CODE, name: 'Agent', clientKind: 'cc', presentedKeyHash: sha(AGENT_KEY), callerKind: 'user' }, deps());
    expect((out as { participant: Participant }).participant.memberKeyHash).toBe(sha(AGENT_KEY));
  });
});

describe("P0 the room's own authorization state is honoured, not just the credential", () => {
  // RS's finding: gating `viewer` alone let a host-MUTED row (canSpeak:false)
  // write a 10 MB file per request that it can never attach. A valid credential
  // is proof of identity, not permission to act.
  const MUTED_CC = row({ name: 'MutedAgent', client: 'cc', memberKeyHash: sha(AGENT_KEY), canSpeak: false });
  const PENDING_WEB = row({ name: 'Pending', client: 'web', authIdHash: sha(ALICE_EMAIL), canSpeak: false });
  const LEGACY_CC = row({ name: 'Legacy', client: 'cc', memberKeyHash: sha(AGENT_KEY) }); // canSpeak undefined

  it('a muted agent with a MATCHING credential is refused and writes nothing', async () => {
    const before = blobTree();
    const d = deps({ room: makeRoom({ participants: [MUTED_CC] } as Partial<Room>) });
    const out = await executeUpload(
      { code: CODE, name: 'MutedAgent', clientKind: 'cc', presentedKeyHash: sha(AGENT_KEY), callerKind: 'user' }, d);
    expect(out.allow).toBe(false);
    expect((out as { status: number }).status).toBe(403);
    expect((out as { message: string }).message).toMatch(/muted or awaiting approval/i);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('a pending web participant is refused and writes nothing', async () => {
    const before = blobTree();
    const d = deps({ room: makeRoom({ participants: [PENDING_WEB] } as Partial<Room>) });
    const out = await executeUpload(
      { code: CODE, name: 'Pending', clientKind: 'web', verifiedAuthIdHash: sha(ALICE_EMAIL), callerKind: 'user' }, d);
    expect(out.allow).toBe(false);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('repeated muted attempts create no files at all', async () => {
    const before = blobTree();
    const d = deps({ room: makeRoom({ participants: [MUTED_CC] } as Partial<Room>) });
    for (let i = 0; i < 5; i++) {
      await executeUpload({ code: CODE, name: 'MutedAgent', clientKind: 'cc', presentedKeyHash: sha(AGENT_KEY), callerKind: 'user' }, d);
    }
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('a legacy row with no canSpeak field is still allowed', async () => {
    // `undefined` predates the field and must not read as muted.
    const d = deps({ room: makeRoom({ participants: [LEGACY_CC] } as Partial<Room>) });
    const out = await executeUpload(
      { code: CODE, name: 'Legacy', clientKind: 'cc', presentedKeyHash: sha(AGENT_KEY), callerKind: 'user' }, d);
    expect(out.allow).toBe(true);
    expect(d.saveBlob).toHaveBeenCalledTimes(1);
  });

  it('canSpeak:true is allowed', async () => {
    const d = deps({ room: makeRoom({ participants: [row({ name: 'Ok', client: 'cc', memberKeyHash: sha(AGENT_KEY), canSpeak: true })] } as Partial<Room>) });
    const out = await executeUpload(
      { code: CODE, name: 'Ok', clientKind: 'cc', presentedKeyHash: sha(AGENT_KEY), callerKind: 'user' }, d);
    expect(out.allow).toBe(true);
  });
});

describe('P0 exact-row selection — the rows[0] fallback is gone', () => {
  // The pre-existing hole: decideSenderAuth returns only {ok, via}, so the send
  // path cast a nonexistent `row` and fell back to rows[0]. With duplicate
  // name+client rows, a credential matching row 1 authorized while viewer and
  // membership checks read row 0.
  const NON_VIEWER = row({ name: 'Dup', client: 'cc', memberKeyHash: sha('key-a') });
  const VIEWER_DUP = row({ name: 'Dup', client: 'cc', memberKeyHash: sha('key-b'), viewer: true });

  it('selects the credential-matched row even when it is not first', () => {
    const res = selectAuthorizedRow({
      participants: [NON_VIEWER, VIEWER_DUP], name: 'Dup', clientKind: 'cc',
      presentedKeyHash: sha('key-b'),
    });
    expect(res.ok).toBe(true);
    expect((res as { row: Participant }).row.viewer).toBe(true);
  });

  it('a viewer duplicate is refused even though a non-viewer shares its name', async () => {
    const before = blobTree();
    const d = deps({ room: makeRoom({ participants: [NON_VIEWER, VIEWER_DUP] } as Partial<Room>) });
    const out = await executeUpload(
      { code: CODE, name: 'Dup', clientKind: 'cc', presentedKeyHash: sha('key-b'), callerKind: 'user' }, d);
    expect(out.allow).toBe(false);
    expect((out as { message: string }).message).toMatch(/viewer/i);
    expect(d.saveBlob).not.toHaveBeenCalled();
    expect(blobTree()).toEqual(before);
  });

  it('refuses ambiguity rather than picking one', () => {
    const same = sha('shared');
    const res = selectAuthorizedRow({
      participants: [row({ name: 'Dup', client: 'cc', memberKeyHash: same }), row({ name: 'Dup', client: 'cc', memberKeyHash: same })],
      name: 'Dup', clientKind: 'cc', presentedKeyHash: same,
    });
    expect(res).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('refuses a keyless row with a dedicated reason, never a legacy allowance', () => {
    const res = selectAuthorizedRow({
      participants: [KEYLESS_CC], name: 'Ghost', clientKind: 'cc',
    });
    expect(res).toEqual({ ok: false, reason: 'name-only-refused' });
  });
});

describe('P0 client kind is validated, never coerced', () => {
  for (const bad of ['', 'web ', 'WEB', 'desktop', 'ccx']) {
    it(`rejects ${JSON.stringify(bad)}`, () => expect(parseClientKind(bad)).toBeNull());
  }
  it('accepts only the two literals', () => {
    expect(parseClientKind('web')).toBe('web');
    expect(parseClientKind('cc')).toBe('cc');
  });
});

describe('P0 purge is denied to every caller and deletes nothing', () => {
  for (const callerKind of ['anonymous', 'user', 'local'] as CallerKind[]) {
    it(`refuses a ${callerKind} caller without touching the filesystem`, () => {
      blobstore.saveBlob(CODE, Buffer.from('keep me'), 'text/plain');
      const before = blobTree();
      expect(before.length).toBeGreaterThan(0);
      const deleteSpy = vi.fn(() => 1);
      const verdict = authorizePurge({ code: CODE, callerKind });
      if ((verdict as { allow: boolean }).allow) deleteSpy();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(verdict.allow).toBe(false);
      expect(blobTree()).toEqual(before);
    });
  }

  it('returns the containment error, never a deleted count', () => {
    const v = authorizePurge({ code: CODE, callerKind: 'user' });
    expect(v.status).toBe(410);
    expect(v.error).toBe('attachment_purge_disabled');
    expect(JSON.stringify(v)).not.toContain('deleted');
  });

  it('audit carries code and caller kind but no path', () => {
    const v = authorizePurge({ code: CODE, callerKind: 'user' });
    expect(v.audit).toContain(CODE);
    expect(v.audit).toContain('user');
    expect(v.audit).not.toContain(TMP_ROOT);
  });
});
