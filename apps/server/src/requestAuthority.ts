import { createHash } from 'node:crypto';
import {
  ACCESS_AUTHENTICATED_OWNER,
  type Message,
  type Participant,
} from '@agent-room/shared';

function authIdHash(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

/**
 * Replace any client-claimed authority with server-derived provenance.
 *
 * `verifiedAccessEmail` must come from resolveCaller(), never request JSON.
 * Requiring the participant's stored authIdHash closes the stolen member-key
 * case, and requiring room.createdBy keeps an authenticated guest from gaining
 * facilitator/owner authority in somebody else's room.
 */
export function stampRequestAuthority(
  message: Message,
  input: {
    verifiedAccessEmail?: string;
    senderRow: Participant | null;
    roomCreatedBy: string;
    actionable: boolean;
  },
): Message {
  const metadata = { ...(message.metadata ?? {}) };
  delete metadata.requestAuthority;

  const email = input.verifiedAccessEmail?.trim().toLowerCase();
  const sender = input.senderRow;
  const isVerifiedOwner = Boolean(
    input.actionable
      && email
      && sender
      && sender.client === 'web'
      && sender.name === input.roomCreatedBy
      && sender.authIdHash === authIdHash(email),
  );

  if (isVerifiedOwner) metadata.requestAuthority = ACCESS_AUTHENTICATED_OWNER;
  return { ...message, metadata };
}
