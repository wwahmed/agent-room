// P0 attachment upload — the request adapter.
//
// `executeUpload` is only as sound as the identity handed to it. Everything
// between the socket and that call — multipart parsing, field selection, caller
// classification — is attacker-influenced, and a field misread here defeats a
// correct decision downstream. This module owns that translation so it can be
// executed in tests without a live server or Redis.
//
// The single rule: nothing a caller can type may become proof of who they are.
// `verifiedAuthIdHash` is derived ONLY from the server-verified Access identity
// on the connection; there is no code path from a multipart field to it.

import { canonicalizeCode } from '@agent-room/shared';
import type { CallerKind, ClientKind, StoredAttachment, UploadDeps, UploadOutcome } from './attachmentAuth.js';
import { executeUpload, parseClientKind } from './attachmentAuth.js';
import { parseMultipart } from './multipart.js';

/** What the server knows about the connection, independent of the body. */
export type VerifiedCaller =
  | { kind: 'anonymous' }
  | { kind: 'local' }
  | { kind: 'user'; email: string };

export interface ParsedUploadBody {
  fields: Record<string, string>;
  duplicateFields: string[];
}

export interface RequestDeps extends UploadDeps {
  /** sha256 hex. Injected so tests need no crypto stubbing of their own. */
  sha256Hex: (input: string) => Promise<string>;
}

export type RequestOutcome =
  | { status: 200; body: unknown; authorized: true; audit?: string }
  | { status: number; body: { error: string; message: string }; authorized: false; audit?: string };

export const LEGACY_LOCAL_UPLOAD_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LEGACY_LOCAL_UPLOAD_ROOM_MAX_FILES = 6;
export const LEGACY_LOCAL_UPLOAD_ROOM_MAX_BYTES = 6 * 1024 * 1024;
export const LEGACY_LOCAL_UPLOAD_GLOBAL_MAX_FILES = 24;
export const LEGACY_LOCAL_UPLOAD_GLOBAL_MAX_BYTES = 24 * 1024 * 1024;

type LegacyBridgeRefusal =
  | 'disabled' | 'missing_expiry' | 'expired' | 'window_too_long'
  | 'room_file_quota' | 'room_byte_quota' | 'global_file_quota' | 'global_byte_quota';

export interface LegacyLocalUploadBridge {
  status(): { ok: true } | { ok: false; reason: LegacyBridgeRefusal };
  reserve(code: string, bytes: number):
    | { ok: true; release: () => void }
    | { ok: false; reason: LegacyBridgeRefusal };
}

/**
 * Process-local emergency budget for pre-identity MCP uploaders.
 * Counters are synchronous pre-save reservations. They reset on restart; the
 * unchanged absolute expiry is the durable backstop for that accepted risk.
 */
export function createLegacyLocalUploadBridge(opts: {
  enabled: boolean;
  expiresAtMs: number;
  startedAtMs: number;
  now?: () => number;
  roomMaxFiles?: number;
  roomMaxBytes?: number;
  globalMaxFiles?: number;
  globalMaxBytes?: number;
}): LegacyLocalUploadBridge {
  const now = opts.now ?? Date.now;
  const limits = {
    roomFiles: opts.roomMaxFiles ?? LEGACY_LOCAL_UPLOAD_ROOM_MAX_FILES,
    roomBytes: opts.roomMaxBytes ?? LEGACY_LOCAL_UPLOAD_ROOM_MAX_BYTES,
    globalFiles: opts.globalMaxFiles ?? LEGACY_LOCAL_UPLOAD_GLOBAL_MAX_FILES,
    globalBytes: opts.globalMaxBytes ?? LEGACY_LOCAL_UPLOAD_GLOBAL_MAX_BYTES,
  };
  let globalFiles = 0;
  let globalBytes = 0;
  const rooms = new Map<string, { files: number; bytes: number }>();

  const status = (): { ok: true } | { ok: false; reason: LegacyBridgeRefusal } => {
    if (!opts.enabled) return { ok: false, reason: 'disabled' };
    if (!Number.isFinite(opts.expiresAtMs)) return { ok: false, reason: 'missing_expiry' };
    if (opts.expiresAtMs <= now()) return { ok: false, reason: 'expired' };
    if (opts.expiresAtMs - opts.startedAtMs > LEGACY_LOCAL_UPLOAD_MAX_WINDOW_MS) {
      return { ok: false, reason: 'window_too_long' };
    }
    return { ok: true };
  };

  return {
    status,
    reserve(code, bytes) {
      const available = status();
      if (!available.ok) return available;
      const room = rooms.get(code) ?? { files: 0, bytes: 0 };
      if (room.files + 1 > limits.roomFiles) return { ok: false, reason: 'room_file_quota' };
      if (room.bytes + bytes > limits.roomBytes) return { ok: false, reason: 'room_byte_quota' };
      if (globalFiles + 1 > limits.globalFiles) return { ok: false, reason: 'global_file_quota' };
      if (globalBytes + bytes > limits.globalBytes) return { ok: false, reason: 'global_byte_quota' };
      room.files += 1;
      room.bytes += bytes;
      rooms.set(code, room);
      globalFiles += 1;
      globalBytes += bytes;
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          room.files -= 1;
          room.bytes -= bytes;
          globalFiles -= 1;
          globalBytes -= bytes;
        },
      };
    },
  };
}

/** Identity fields whose duplication makes the claim ambiguous. */
const IDENTITY_FIELDS = ['name', 'client', 'memberKey', 'roomCode'] as const;

/** A display name long enough to be an attack payload rather than a name. */
export const MAX_IDENTITY_FIELD_BYTES = 256;

/**
 * Translate a parsed upload request into an authorization decision.
 *
 * Every refusal returns before `executeUpload` is called, so a denial cannot
 * reach the room lookup or the filesystem at all.
 */
export async function handleUploadRequest(
  caller: VerifiedCaller,
  code: string,
  body: ParsedUploadBody,
  deps: RequestDeps,
): Promise<RequestOutcome> {
  const deny = (status: number, error: string, message: string, audit?: string): RequestOutcome =>
    ({ status, body: { error, message }, authorized: false, ...(audit ? { audit } : {}) });

  // Anonymous is refused before anything in the body is even read.
  if (caller.kind === 'anonymous') {
    return deny(401, 'Unauthorized', 'Sign in required.');
  }

  // A duplicated identity field means two competing claims and a parser that
  // silently keeps the last. Refuse rather than pick.
  const dupes = body.duplicateFields.filter(f => (IDENTITY_FIELDS as readonly string[]).includes(f));
  if (dupes.length > 0) {
    return deny(400, 'bad_request', 'duplicate identity fields in upload',
      `upload refused on ${code}: duplicate identity field(s) ${dupes.join(',')}`);
  }

  for (const field of IDENTITY_FIELDS) {
    const value = body.fields[field];
    if (value !== undefined && Buffer.byteLength(value, 'utf8') > MAX_IDENTITY_FIELD_BYTES) {
      return deny(400, 'bad_request', 'identity field too long',
        `upload refused on ${code}: oversized ${field}`);
    }
  }

  const name = (body.fields.name ?? '').trim();
  if (!name) {
    return deny(400, 'bad_request', 'missing participant name');
  }

  const rawClient = body.fields.client ?? '';
  const clientKind: ClientKind | null = parseClientKind(rawClient);
  if (clientKind === null) {
    return deny(400, 'bad_request', 'invalid client kind',
      `upload refused on ${code}: invalid client kind`);
  }

  // CLOSED TRANSPORT MATRIX. The two ways to reach this server are not
  // interchangeable, and letting a caller pick its client kind is what makes
  // credential confusion possible:
  //   verified Access `user`  ↔ literal 'web', identity from the JWT only
  //   trusted loopback `local` ↔ literal 'cc', identity from a member key only
  // Anything else — user→cc, local→web, web carrying a memberKey — is rejected
  // here, before the room is even looked up. Extra credentials are refused
  // rather than ignored: silently dropping one hides an attempt.
  const hasBodyKey = Boolean(body.fields.memberKey);
  if (caller.kind === 'user' && clientKind !== 'web') {
    return deny(403, 'forbidden', 'A signed-in browser session can only upload as a web participant.',
      `upload refused on ${code}: user caller claimed client=${clientKind}`);
  }
  if (caller.kind === 'local' && clientKind !== 'cc') {
    return deny(403, 'forbidden', 'A local agent process can only upload as an agent participant.',
      `upload refused on ${code}: local caller claimed client=${clientKind}`);
  }
  if (clientKind === 'web' && hasBodyKey) {
    return deny(400, 'bad_request', 'A web upload must not carry a member credential.',
      `upload refused on ${code}: web upload presented a memberKey`);
  }
  if (clientKind === 'cc' && !hasBodyKey) {
    return deny(403, 'forbidden', 'An agent upload requires its member credential.',
      `upload refused on ${code}: agent upload presented no memberKey`);
  }

  // THE load-bearing line. The hash comes from `caller.email`, which
  // `resolveCaller` derived from the verified Access JWT — never from `body`.
  // A caller can choose WHICH row to attempt, never WHOSE identity to present.
  // A web claim from a local (non-Access) caller yields no auth hash, so that
  // caller must present a member credential like any agent.
  const verifiedAuthIdHash =
    caller.kind === 'user' && clientKind === 'web'
      ? await deps.sha256Hex(caller.email)
      : undefined;

  const rawKey = body.fields.memberKey ?? '';
  const presentedKeyHash = rawKey ? await deps.sha256Hex(rawKey) : undefined;

  const callerKind: CallerKind = caller.kind;
  const outcome: UploadOutcome = await executeUpload(
    { code, name, clientKind, presentedKeyHash, verifiedAuthIdHash, callerKind },
    deps,
  );

  if (!outcome.allow) {
    return { status: outcome.status, body: { error: outcome.error, message: outcome.message }, authorized: false, ...(outcome.audit ? { audit: outcome.audit } : {}) };
  }
  return { status: 200, body: outcome.stored, authorized: true };
}

/** A file part that has passed every structural check. */
export interface ValidatedFile {
  data: Buffer;
  mime: string;
  filename: string;
  width?: number;
  height?: number;
}

/** Filenames are echoed back to clients; bound them and refuse blanks. */
export const MAX_FILENAME_BYTES = 255;

export interface RawUploadRequest {
  contentType: string;
  /** Already read from the socket; the caller owns the size limit on the read. */
  body: Buffer;
}

export interface RawRequestDeps extends Omit<RequestDeps, 'saveBlob'> {
  /** Receives the canonical code and the validated file and returns the FULL
   *  attachment descriptor clients consume — not just the stored blob. */
  saveBlob: (code: string, file: ValidatedFile) => StoredAttachment;
  isAllowedMime: (mime: string) => boolean;
  maxBytes: number;
  legacyLocalUploadBridge?: LegacyLocalUploadBridge;
}

/**
 * Dependencies owned by the HTTP route. Keeping the socket reader inside this
 * production-called seam makes the cheapest authorization boundary executable:
 * an anonymous caller must be rejected before a single request-body byte is
 * consumed.
 */
export interface SocketRequestDeps extends RawRequestDeps {
  readBody: () => Promise<Buffer>;
}

/**
 * The HTTP-facing upload seam. `index.ts` calls this exact function and injects
 * its socket reader; tests inject a spy. The anonymous branch therefore proves
 * zero body reads by execution rather than by source ordering.
 */
export async function handleUploadSocketRequest(
  caller: VerifiedCaller,
  contentType: string,
  deps: SocketRequestDeps,
): Promise<RequestOutcome> {
  if (caller.kind === 'anonymous') {
    return { status: 401, body: { error: 'Unauthorized', message: 'Sign in required.' }, authorized: false };
  }

  let body: Buffer;
  try {
    body = await deps.readBody();
  } catch {
    return {
      status: 413,
      body: { error: 'file_too_large', message: 'Upload exceeds the size limit.' },
      authorized: false,
    };
  }

  return handleRawUploadRequest(caller, { contentType, body }, deps);
}

/**
 * The full socket→status path: parse, validate the room code and the file,
 * then authorize. Tests drive this with raw multipart bytes, so parsing and
 * status translation are executed rather than assumed.
 *
 * Every refusal here happens before `getRoom` and before any byte is stored.
 */
export async function handleRawUploadRequest(
  caller: VerifiedCaller,
  raw: RawUploadRequest,
  deps: RawRequestDeps,
): Promise<RequestOutcome> {
  const deny = (status: number, error: string, message: string, audit?: string): RequestOutcome =>
    ({ status, body: { error, message }, authorized: false, ...(audit ? { audit } : {}) });

  if (caller.kind === 'anonymous') return deny(401, 'Unauthorized', 'Sign in required.');
  if (!/multipart\/form-data/i.test(raw.contentType)) {
    return deny(400, 'bad_request', 'expected multipart/form-data');
  }

  let parsed;
  try {
    parsed = parseMultipart(raw.body, raw.contentType);
  } catch {
    return deny(400, 'bad_request', 'malformed multipart body');
  }

  const code = canonicalizeCode(String(parsed.fields.roomCode || ''));
  if (!code) return deny(400, 'bad_request', 'missing or invalid roomCode');

  // EXACTLY ONE file part, under the literal field name `file`. The old route
  // took `files.find(field==='file') ?? files[0]`, so a second differently
  // named part rode along invisibly and a mis-named single part was silently
  // accepted. Ambiguous input is refused, never resolved by position.
  if (parsed.files.length > 1) {
    return deny(400, 'bad_request', 'exactly one file part is allowed',
      `upload refused on ${code}: ${parsed.files.length} file parts`);
  }
  const file = parsed.files[0];
  if (!file) return deny(400, 'no_file', 'no file part in upload');
  if (file.field !== 'file') {
    return deny(400, 'bad_request', 'the file part must be named "file"',
      `upload refused on ${code}: file part named "${file.field}"`);
  }
  const filename = (file.filename || '').trim();
  if (!filename) return deny(400, 'bad_request', 'the file part needs a filename');
  if (Buffer.byteLength(filename, 'utf8') > MAX_FILENAME_BYTES) {
    return deny(400, 'bad_request', 'filename too long');
  }
  if (file.data.length === 0) return deny(400, 'empty_file', 'the file is empty');
  if (file.data.length > deps.maxBytes) {
    return deny(413, 'file_too_large', 'Attachment exceeds the 10 MB limit.');
  }
  const numeric = (raw: string | undefined): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const width = numeric(parsed.fields.width);
  const height = numeric(parsed.fields.height);

  const mime = (file.contentType.split(';')[0] || '').trim().toLowerCase();
  if (!deps.isAllowedMime(mime)) {
    return deny(415, 'mime_not_allowed', `Unsupported file type: ${mime || file.filename}`);
  }

  // Exact legacy MCP shape: roomCode + one validated file, and no identity
  // fields. This can create only a quota-bounded orphan; message publication
  // remains independently speaker/memberKey-gated by room_send.
  const duplicateIdentity = parsed.duplicateFields.filter(
    field => (IDENTITY_FIELDS as readonly string[]).includes(field),
  );
  if (duplicateIdentity.length > 0) {
    return deny(400, 'bad_request', 'duplicate identity fields in upload',
      `upload refused on ${code}: duplicate identity field(s) ${duplicateIdentity.join(',')}`);
  }
  const scalarFields = Object.keys(parsed.fields);
  const hasExactLegacyFields = scalarFields.length === 1 && scalarFields[0] === 'roomCode';
  if (caller.kind === 'local' && hasExactLegacyFields) {
    const bridge = deps.legacyLocalUploadBridge;
    const bridgeStatus = bridge?.status() ?? { ok: false as const, reason: 'disabled' as const };
    if (!bridgeStatus.ok) {
      return deny(403, 'legacy_upload_disabled', 'Legacy local uploads are disabled.',
        `legacy_local_unbound refused on ${code}: ${bridgeStatus.reason}`);
    }
    let room;
    try {
      room = await deps.getRoom(code);
    } catch {
      return deny(404, 'room_not_found', 'That room does not exist.',
        `legacy_local_unbound refused on ${code}: room_not_found`);
    }
    if (room.status !== 'active') {
      return deny(409, 'room_ended', 'This room has ended. Attachments can only be added to an active room.',
        `legacy_local_unbound refused on ${code}: room_ended`);
    }
    const reservation = bridge!.reserve(code, file.data.length);
    if (!reservation.ok) {
      return deny(429, 'legacy_upload_quota_exceeded', 'Temporary legacy upload quota exceeded.',
        `legacy_local_unbound refused on ${code}: ${reservation.reason}`);
    }
    try {
      const stored = deps.saveBlob(code, { data: file.data, mime, filename: file.filename, width, height });
      return {
        status: 200,
        body: { ...stored, legacyLocalUnbound: true },
        authorized: true,
        audit: `legacy_local_unbound accepted on ${code}: bytes=${file.data.length}`,
      };
    } catch (error) {
      reservation.release();
      throw error;
    }
  }

  return handleUploadRequest(
    caller, code,
    { fields: parsed.fields, duplicateFields: parsed.duplicateFields },
    { ...deps, saveBlob: () => deps.saveBlob(code, { data: file.data, mime, filename: file.filename, width, height }) },
  );
}
