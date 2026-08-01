// P0 attachment authorization seam.
//
// `/api/upload` and `/api/delete-room-blobs` previously decided inline inside
// the monolithic request handler, where nothing could execute them. The
// decisions AND the effect gate now live here, and `index.ts` calls
// `executeUpload` directly — so removing the guard breaks production and the
// tests together, rather than only a source tripwire.
//
// Three things this deliberately does NOT do:
//   - it never re-fetches the room. One snapshot is loaded, status is checked
//     against it, and identity is resolved against that same snapshot's rows.
//     Two reads let a room end or be recreated between the two checks.
//   - it never consults ALLOW_LEGACY_NAME_AUTH. A containment boundary that
//     depends on the current value of a compatibility env var is not a
//     boundary. Name-only rows are refused here, always.
//   - it never falls back to "the first row with this name". The credential
//     selects exactly one row, and that row is the one every later check
//     (viewer, membership) is applied to.

import type { Participant, Room } from '@agent-room/shared';

export type CallerKind = 'local' | 'user' | 'anonymous';

/** Literal client kinds. Anything else is rejected, never coerced. */
export type ClientKind = 'web' | 'cc';
export function parseClientKind(raw: string): ClientKind | null {
  return raw === 'web' || raw === 'cc' ? raw : null;
}

export type StrictAuthRefusal =
  | 'no-row' | 'wrong-auth-id' | 'need-key' | 'bad-key' | 'ambiguous' | 'name-only-refused';

export interface StrictAuthInput {
  /** Rows already loaded from the single room snapshot. */
  participants: Participant[];
  name: string;
  clientKind: ClientKind;
  /** sha256 of the presented member credential, if any. */
  presentedKeyHash?: string;
  /** sha256 of the verified Access email — web callers only. */
  verifiedAuthIdHash?: string;
}

export type StrictAuthResult =
  | { ok: true; row: Participant }
  | { ok: false; reason: StrictAuthRefusal };

/**
 * Resolve exactly one participant row from a credential.
 *
 * `decideSenderAuth` answers "may this send proceed" but returns only
 * `{ok, via}` — it cannot say WHICH row it matched. The send path papered over
 * that with a cast and `?? rows[0]`, so with two rows sharing name+client a
 * credential matching row N authorized while viewer/membership checks read
 * row 0. For a write-to-disk boundary that is not acceptable: this returns the
 * matched row itself, or refuses.
 */
export function selectAuthorizedRow(input: StrictAuthInput): StrictAuthResult {
  const rows = input.participants.filter(
    p => p.name === input.name && p.client === input.clientKind,
  );
  if (rows.length === 0) return { ok: false, reason: 'no-row' };

  // A durable Access identity outranks the per-tab member key: the key rotates
  // on rejoin, the account does not.
  const authRows = rows.filter(r => r.authIdHash);
  if (input.verifiedAuthIdHash && authRows.length > 0) {
    const matched = authRows.filter(r => r.authIdHash === input.verifiedAuthIdHash);
    if (matched.length === 1) return { ok: true, row: matched[0]! };
    if (matched.length > 1) return { ok: false, reason: 'ambiguous' };
    return { ok: false, reason: 'wrong-auth-id' };
  }

  const keyed = rows.filter(r => r.memberKeyHash);
  if (keyed.length > 0) {
    if (!input.presentedKeyHash) return { ok: false, reason: 'need-key' };
    const matched = keyed.filter(r => r.memberKeyHash === input.presentedKeyHash);
    if (matched.length === 1) return { ok: true, row: matched[0]! };
    if (matched.length > 1) return { ok: false, reason: 'ambiguous' };
    return { ok: false, reason: 'bad-key' };
  }

  // Keyless rows reach here. The ordinary send path may accept them under
  // ALLOW_LEGACY_NAME_AUTH; an upload never does.
  return { ok: false, reason: 'name-only-refused' };
}

const REFUSAL_MESSAGE: Record<StrictAuthRefusal, string> = {
  'no-row': 'You are not a participant in this room. Join the room before uploading.',
  'wrong-auth-id': 'The signed-in account does not own that participant.',
  'need-key': 'This participant requires its member credential. Rejoin the room to obtain one, then retry.',
  'bad-key': 'Member credential does not match that participant.',
  'ambiguous': 'That name matches more than one participant. Rejoin with a distinct name.',
  'name-only-refused': 'Uploading requires a member credential. A display name alone is not sufficient.',
};

export interface UploadRequest {
  code: string;
  name: string;
  /** Already validated by parseClientKind; null means the caller sent garbage. */
  clientKind: ClientKind | null;
  presentedKeyHash?: string;
  verifiedAuthIdHash?: string;
  callerKind: CallerKind;
}

/** The complete descriptor both web and MCP clients consume. Returning only
 *  `{key,url,size}` here silently breaks them: they read id/type/name/mime/
 *  storageKey/uploadedAt off this object. */
export interface StoredAttachment {
  id: string; type: string; url: string; storageKey: string;
  name: string; size: number; mime: string; uploadedAt: number;
  width?: number; height?: number;
}

export interface UploadDeps {
  /** Single room snapshot. Throws when the room does not exist. */
  getRoom: (code: string) => Promise<Room>;
  /** The effect. Injected so tests execute the real gate, not a copy of it. */
  saveBlob: () => StoredAttachment;
}

export type UploadOutcome =
  | { allow: true; participant: Participant; stored: StoredAttachment }
  | { allow: false; status: number; error: string; message: string; audit?: string };

/**
 * Authorize and, only if authorized, perform the upload.
 *
 * The effect gate lives here rather than in the route so that no test can
 * mirror it: `index.ts` calls this function, and the temp-root matrix calls
 * this same function. Deleting the guard fails both.
 */
export async function executeUpload(req: UploadRequest, deps: UploadDeps): Promise<UploadOutcome> {
  if (req.callerKind === 'anonymous') {
    return { allow: false, status: 401, error: 'Unauthorized', message: 'Sign in required.' };
  }
  if (req.clientKind === null) {
    return { allow: false, status: 400, error: 'bad_request', message: 'invalid client kind' };
  }
  if (!req.name.trim()) {
    return { allow: false, status: 400, error: 'bad_request', message: 'missing participant name' };
  }

  let room: Room;
  try {
    room = await deps.getRoom(req.code);
  } catch {
    return {
      allow: false, status: 404, error: 'room_not_found',
      message: 'That room does not exist.',
      audit: `upload refused on ${req.code}: room not found`,
    };
  }

  // getRoom returns ENDED rooms too, so credential validity alone would admit
  // an upload into a finished room. Missing and ended stay distinct.
  if (room.status !== 'active') {
    return {
      allow: false, status: 409, error: 'room_ended',
      message: 'This room has ended. Attachments can only be added to an active room.',
      audit: `upload refused on ${req.code}: room ended`,
    };
  }

  const auth = selectAuthorizedRow({
    participants: room.participants ?? [],
    name: req.name,
    clientKind: req.clientKind,
    presentedKeyHash: req.presentedKeyHash,
    verifiedAuthIdHash: req.verifiedAuthIdHash,
  });
  if (!auth.ok) {
    return {
      allow: false, status: 403, error: 'forbidden',
      message: REFUSAL_MESSAGE[auth.reason],
      audit: `upload refused on ${req.code} for "${req.name}" (${req.clientKind}): ${auth.reason}`,
    };
  }
  if (auth.row.viewer) {
    return {
      allow: false, status: 403, error: 'forbidden',
      message: 'Viewers cannot upload attachments.',
      audit: `upload refused on ${req.code} for "${req.name}" (${req.clientKind}): viewer row`,
    };
  }
  // `canSpeak === false` is the host's mute / pending-approval gate, and
  // findSpeaker refuses that row's send. Checking only `viewer` let a muted
  // credential holder write a 10 MB file per request that it can never attach
  // — a disk-write channel for someone the host has explicitly silenced.
  // Legacy rows predate the field: `undefined` means "not muted" and is allowed.
  if (auth.row.canSpeak === false) {
    return {
      allow: false, status: 403, error: 'forbidden',
      message: 'You cannot upload attachments while muted or awaiting approval in this room.',
      audit: `upload refused on ${req.code} for "${req.name}" (${req.clientKind}): canSpeak=false`,
    };
  }

  return { allow: true, participant: auth.row, stored: deps.saveBlob() };
}

export type PurgeVerdict = {
  allow: false;
  status: number;
  error: string;
  message: string;
  audit: string;
};

/**
 * Decide whether an attachment purge may run. It may not — for anyone.
 *
 * The route deleted every blob under a room code for any allowlisted account or
 * trusted local process, with no room, host, or member check. A host gate does
 * not repair it: blobs are stored code-only, so a NEW room's host would still
 * be able to erase a PRIOR room's attachments sharing that code. A safe purge
 * needs incarnation-scoped storage that does not exist yet. The return type has
 * no `allow: true` member, so there is no branch a caller could reach.
 */
export function authorizePurge(req: { code: string; callerKind: CallerKind }): PurgeVerdict {
  if (req.callerKind === 'anonymous') {
    return {
      allow: false, status: 401, error: 'Unauthorized', message: 'Sign in required.',
      audit: `attachment purge refused on ${req.code}: anonymous caller`,
    };
  }
  return {
    allow: false, status: 410, error: 'attachment_purge_disabled',
    message: 'Attachment deletion is disabled. Ending or archiving a room does not delete its attachments.',
    audit: `attachment purge refused on ${req.code}: route disabled pending incarnation-scoped storage; caller=${req.callerKind}`,
  };
}
