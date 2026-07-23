// T-123: reference MCP tool wrapper for secure agent-native attachment
// download. The security-bearing logic lives in the SERVER (apps/server:
// action 'attachmentDownload' + the /dl one-time-URL route); this module is the
// thin, documented tool surface an MCP host registers so a joined agent can
// call it directly.
//
// DEPLOY BOUNDARY (disclosed): the running mcp__agent-room__* server is the
// published `agent-room-mcp` npm package (see ~/.claude.json), which is built
// and released outside this repo. Registering this tool there is a separate
// publish step. This file is the ready-to-adopt reference: schema, error
// mapping, and the exact server call. The server capability it targets is live
// and independently verified.

import type { RoomApiClient } from './roomApi.js';

export const ROOM_ATTACHMENT_DOWNLOAD_TOOL = {
  name: 'room_attachment_download',
  description:
    'Securely download the exact bytes of a file already shared in a room you have joined, ' +
    'without a browser session or cookie. Authorized by your participant member credential and ' +
    'scoped to that one room. Works for ANY format including ZIP and other archives that the ' +
    'text-extraction reader reports as unsupported. Provide the room code, your participant name, ' +
    'and exactly ONE selector: attachmentId, attachmentName, or url (from the transcript). Small ' +
    'files return inline base64 bytes plus filename, declared+detected MIME, byte length, SHA-256, ' +
    'uploader message id, and upload time; larger files return a one-time signed URL that expires ' +
    'in 60s. Verify the returned SHA-256 after decoding. Stable error codes: not_found, ' +
    'not_a_participant, too_large, integrity_mismatch, bad_request.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: '9-character dashed room code you have joined.' },
      name: { type: 'string', description: 'Your participant display name in that room.' },
      client: { type: 'string', enum: ['web', 'cc'], description: "Your client kind (agents use 'cc'). Default 'cc'." },
      attachmentId: { type: 'string', description: 'Attachment id from the message transcript.' },
      attachmentName: { type: 'string', description: 'Attachment display name (newest match wins).' },
      url: { type: 'string', description: 'Attachment url from the transcript (relative or absolute).' },
    },
    required: ['code', 'name'],
  },
} as const;

export interface AttachmentDownloadResult {
  id: string;
  name: string;
  declaredMime: string;
  detectedMime: string;
  bytes: number;
  sha256: string;
  uploaderMessageId: number;
  uploadedAt: number;
  delivery: 'inline' | 'signed-url';
  contentBase64?: string;
  signedUrl?: string;
  expiresInMs?: number;
}

export interface AttachmentDownloadArgs {
  code: string;
  name: string;
  client?: 'web' | 'cc';
  attachmentId?: string;
  attachmentName?: string;
  url?: string;
  /** The participant member credential obtained when joining (wantMemberKey). */
  memberKey?: string;
}

/**
 * Call the server's secure download action. The MCP host supplies the joined
 * participant's memberKey (it already holds it from room_join); it is sent to
 * the server for authorization and never surfaced to the model.
 */
export async function downloadRoomAttachment(
  client: RoomApiClient,
  args: AttachmentDownloadArgs,
): Promise<AttachmentDownloadResult> {
  const body = await client.post<{ result: AttachmentDownloadResult }>({
    action: 'attachmentDownload',
    code: args.code,
    name: args.name,
    client: args.client ?? 'cc',
    attachmentId: args.attachmentId,
    attachmentName: args.attachmentName,
    url: args.url,
    memberKey: args.memberKey,
  });
  return body.result;
}
