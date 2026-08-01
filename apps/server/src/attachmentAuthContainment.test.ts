// P0 attachment containment — SUPPLEMENTAL source gates.
//
// The authorization decisions themselves are executed against a real temp blob
// root in attachmentAuth.test.ts. This file covers only what a behavioural test
// cannot: that no production code path still reaches the destructive helper,
// and that the routes remain wired to the decision seam. These are regression
// tripwires, not evidence of authorization behaviour.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const repoRoot = join(here, '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const serverIndex = read('apps/server/src/index.ts');
const webUpload = read('apps/web/src/lib/upload.ts');
const webRoom = read('apps/web/src/screens/Room.tsx');
const mcpUpload = read('apps/mcp/src/uploadAttachment.ts');
const mcpTools = read('apps/mcp/src/tools.ts');

describe('the destructive helper is unreachable from the server route module', () => {
  it('index.ts does not import deleteRoomBlobs at all', () => {
    // Out of scope means no future edit in this 3000-line module can call it.
    expect(serverIndex).not.toMatch(/^\s*deleteRoomBlobs,$/m);
  });

  it('index.ts contains no call to deleteRoomBlobs', () => {
    expect(serverIndex).not.toContain('deleteRoomBlobs(');
  });

  it('both routes delegate to the production seams', () => {
    expect(serverIndex).toContain('handleUploadSocketRequest(');
    expect(serverIndex).toContain('authorizePurge(');
  });

  it('the route owns no effect gate of its own — saveBlob is injected', () => {
    // The gate lives inside executeUpload, reached via handleUploadRequest;
    // both are called directly by the temp-root matrices. The route must not
    // hold a second, mirrorable copy.
    const routeAt = serverIndex.indexOf('handleUploadSocketRequest(');
    expect(routeAt).toBeGreaterThan(-1);
    const block = serverIndex.slice(routeAt, routeAt + 2200);
    expect(block).toContain('saveBlob: (roomCode, f) =>');
    // The route must build the COMPLETE descriptor clients consume, not pass
    // the bare stored blob through.
    expect(block).toContain('storageKey:');
    expect(block).toContain('uploadedAt:');
    expect(block).toContain('uploadOutcome.body');
  });

  it('identity reaches the adapter from the verified caller, not the body', () => {
    const routeAt = serverIndex.indexOf('handleUploadSocketRequest(');
    const block = serverIndex.slice(routeAt, routeAt + 900);
    // The caller object is built from resolveCaller's verdict; the body is
    // passed separately as untrusted fields.
    expect(block).toContain("caller.kind === 'user'");
    expect(block).toContain('email: caller.email');
    expect(block).toContain("String(req.headers['content-type']");
    expect(block).toContain('readBody: () => readRawBody(req)');
    // No hand-rolled coercion left in the route.
    expect(block).not.toContain("=== 'cc' ? 'cc' : 'web'");
  });
});

describe('the bounded legacy-local bridge is wired into the production upload route', () => {
  it('constructs one env-backed singleton with the exact release controls', () => {
    const constructionAt = serverIndex.indexOf(
      'const LEGACY_LOCAL_UPLOAD_BRIDGE = createLegacyLocalUploadBridge({',
    );
    expect(constructionAt).toBeGreaterThan(-1);
    const construction = serverIndex.slice(constructionAt, constructionAt + 500);
    expect(construction).toContain(
      "enabled: process.env.WAKICHAT_LEGACY_LOCAL_UPLOAD_ENABLED === '1'",
    );
    expect(construction).toContain(
      "expiresAtMs: Date.parse(process.env.WAKICHAT_LEGACY_LOCAL_UPLOAD_EXPIRES_AT ?? '')",
    );
    expect(construction).toContain('startedAtMs: LEGACY_LOCAL_UPLOAD_STARTED_AT');
  });

  it('injects that exact singleton into the live /api/upload socket seam', () => {
    const routeAt = serverIndex.indexOf("if (path === '/api/upload' && req.method === 'POST')");
    expect(routeAt).toBeGreaterThan(-1);
    const route = serverIndex.slice(routeAt, routeAt + 2600);
    expect(route).toContain('handleUploadSocketRequest(');
    expect(route).toContain('legacyLocalUploadBridge: LEGACY_LOCAL_UPLOAD_BRIDGE');
  });
});

describe('no production client can reach the purge route', () => {
  it('the web upload lib no longer exports a deleteRoomBlobs helper', () => {
    expect(webUpload).not.toContain('export async function deleteRoomBlobs');
  });

  it('no production source posts to /api/delete-room-blobs', () => {
    for (const [name, src] of [['web upload lib', webUpload], ['Room screen', webRoom]] as const) {
      expect(src, `${name} still references the delete endpoint`).not.toContain('/api/delete-room-blobs');
    }
  });

  it('ending a meeting performs no purge and promises no cleanup', () => {
    const start = webRoom.indexOf('const endRoomState = useEndRoom(');
    expect(start).toBeGreaterThan(-1);
    const body = webRoom.slice(start, start + 1400);
    expect(body).not.toContain('deleteRoomBlobs');
    expect(body).not.toMatch(/attachments (are|were) (deleted|removed)/i);
  });
});

describe('End truthfulness lives in ONE shared implementation', () => {
  // Behaviour is executed in EndRoomControl.dom.test.tsx. These prove there is
  // no second copy in Room.tsx to drift back into `catch { setEnded(true) }`.
  const endControl = read('apps/web/src/components/EndRoomControl.tsx');

  it('the shared hook gates the transition on the decision', () => {
    expect(endControl).toContain('endOutcome(');
    expect(endControl).toContain('if (outcome.ended)');
    expect(endControl).not.toMatch(/catch[^{]*\{\s*opts\.onEnded\(\)/);
  });

  it('the in-flight guard is a ref, not React state', () => {
    // setBusy does not apply until re-render, so a state guard lets two
    // same-tick clicks both through. (A DOM test caught exactly this.)
    expect(endControl).toContain('const inFlight = useRef(false)');
    expect(endControl).toContain("if (inFlight.current) return 'ignored' as const;");
    expect(endControl).not.toContain('if (busy) return;');
  });

  it('Room holds no competing End logic of its own', () => {
    expect(webRoom).toContain('useEndRoom({');
    // The old per-surface implementation is gone.
    expect(webRoom).not.toContain('setEndError(');
    expect(webRoom).not.toContain('endInFlight');
    // The remaining setEnded(true) sites are legitimate: the server-status
    // effect, and the hook's onEnded callback which fires only on authoritative
    // success. What must not exist is a local try/catch around the end call.
    expect(webRoom).not.toContain('await endRoomApi(client, code');
    const hookAt = webRoom.indexOf('const endRoomState = useEndRoom(');
    const hookBody = webRoom.slice(hookAt, hookAt + 900);
    expect(hookBody).not.toContain('catch');
  });

  it('one persistent shared alert precedes both tab-specific panes', () => {
    // Per-control errors alone left header and Settings failures silent. The
    // real alert must be a Room child before both the non-Chat and Chat panes.
    const alertAt = webRoom.indexOf('<EndRoomAlert state={endRoomState}');
    const nonChatAt = webRoom.indexOf("{mainTab !== 'chat' && (", alertAt);
    const chatAt = webRoom.indexOf("mainTab === 'chat' ? 'flex' : 'hidden'", alertAt);
    expect(alertAt).toBeGreaterThan(-1);
    expect(alertAt).toBeLessThan(nonChatAt);
    expect(alertAt).toBeLessThan(chatAt);
    expect(endControl).toContain('data-room-persistent-end-alert=""');
    expect(endControl).toContain('role="alert"');
    expect(endControl).toContain('flex-shrink-0');
    expect(endControl).toContain('mt-[96px] sm:mt-0');
    // Both controls defer to it so the alert is not duplicated.
    expect((webRoom.match(/hideError/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('every End surface renders the one shared control or its handler', () => {
    // Two button surfaces use the component; the header takes the handler.
    expect((webRoom.match(/<EndRoomControl/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The header now takes the shared STATE, not a callback + boolean shadow,
    // so it can disable and show pending like every other surface.
    expect(webRoom).toContain('endRoom={{ ...endRoomState');
    expect(webRoom).not.toContain('canEndRoom=');
  });

  it('the hook runs before every early return in Room', () => {
    // A conditional hook crashes the screen; Room.hookOrder.dom.test.tsx is the
    // executable guard, this pins the ordering that satisfies it.
    const hookAt = webRoom.indexOf('const endRoomState = useEndRoom(');
    const firstReturn = webRoom.indexOf('  if (error) {');
    expect(hookAt).toBeGreaterThan(-1);
    expect(hookAt).toBeLessThan(firstReturn);
  });
});

describe('upload clients transmit the identity the server now requires', () => {
  it('the web client sends its participant name and client kind', () => {
    expect(webUpload).toContain("fd.append('name', selfName)");
    expect(webUpload).toContain("fd.append('client', 'web')");
  });

  it('both web call sites pass identity through', () => {
    const calls = webRoom.match(/uploadAttachment\(job\.file, code[^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('self?.name');
  });

  it('the agent client sends name, client kind, and member key', () => {
    expect(mcpUpload).toContain("fd.append('name', sender.name)");
    expect(mcpUpload).toContain("fd.append('client', 'cc')");
    expect(mcpUpload).toContain("fd.append('memberKey', sender.memberKey)");
  });

  it('room_send threads the stored member credential into the upload', () => {
    expect(mcpTools).toContain('memberKey: await readMemberKey(a.code)');
  });
});
