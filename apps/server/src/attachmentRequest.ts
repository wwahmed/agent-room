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
  | { status: 200; body: unknown; authorized: true }
  | { status: number; body: { error: string; message: string }; authorized: false; audit?: string };

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

  return handleUploadRequest(
    caller, code,
    { fields: parsed.fields, duplicateFields: parsed.duplicateFields },
    { ...deps, saveBlob: () => deps.saveBlob(code, { data: file.data, mime, filename: file.filename, width, height }) },
  );
}
