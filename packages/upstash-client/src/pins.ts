import type { PinnedMessage } from '@agent-room/shared';
import type { UpstashClient } from './client.js';
import { casRoom } from './rooms.js';
import { findStoredMessage, MessageNotFoundError } from './messages.js';

// T-14: pinned outcomes. Pins live ON THE ROOM RECORD as denormalized
// {id, name, snippet, by, at} entries — the strip must render sender +
// snippet even after the original message pages out of the loaded window
// or is LTRIMmed from history entirely (same philosophy as MessageReplyRef).

// Bound, not a quota: a pinned strip past ~20 entries is a second feed, not
// a summary. The OLDEST pin falls off — pins record current outcomes, and
// the newest decision is the one the room is acting on.
export const MAX_PINNED_MESSAGES = 20;
export const PIN_SNIPPET_MAX = 120;

/** Server-owned snippet: whitespace collapsed, hard-truncated. Never trust a
 *  client-supplied length (same rule as normalizeReplyTo). */
export function pinSnippet(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, PIN_SNIPPET_MAX);
}

// Pure toggle: dedup by message id, newest pin appended last, bounded by
// dropping the OLDEST entries. Re-pinning an already-pinned message moves it
// to the tail (freshest position) rather than erroring — idempotent for
// agents that retry.
export function applyPinToggle(
  prior: PinnedMessage[] | undefined,
  entry: PinnedMessage,
  pin: boolean,
): PinnedMessage[] {
  const rest = (Array.isArray(prior) ? prior : []).filter(p => p.id !== entry.id);
  if (!pin) return rest;
  const next = [...rest, entry];
  return next.length > MAX_PINNED_MESSAGES ? next.slice(next.length - MAX_PINNED_MESSAGES) : next;
}

export interface PinResult {
  /** true = the message is now pinned; false = it is now unpinned. */
  pinned: boolean;
  /** The room's full post-change pin list. */
  pinnedMessages: PinnedMessage[];
  /** Pinned message's author + snippet for the sys event line; null when an
   *  unpin targeted a message already trimmed from history. */
  target: { id: number; name: string; text: string } | null;
}

export async function setMessagePinned(
  client: UpstashClient,
  code: string,
  messageId: number,
  actor: { name: string },
  pin: boolean,
): Promise<PinResult> {
  const found = await findStoredMessage(client, code, messageId);
  // Asymmetric existence rule: PINNING a missing message is an error, but
  // UNPINNING one must always work — otherwise a pin whose original was
  // LTRIMmed away becomes permanent (the strip entry is denormalized and
  // outlives the message).
  if (!found && pin) throw new MessageNotFoundError(messageId);
  if (found && found.message.type === 'sys' && pin) {
    const err = new Error('Only participant messages can be pinned, not system rows.');
    err.name = 'BadRequestError';
    throw err;
  }
  const entry: PinnedMessage = found
    ? { id: messageId, name: found.message.name, text: pinSnippet(found.message.text), by: actor.name, at: Date.now() }
    : { id: messageId, name: '', text: '', by: actor.name, at: Date.now() };
  const room = await casRoom(client, code, current => ({
    ...current,
    pinnedMessages: applyPinToggle(current.pinnedMessages, entry, pin),
  }));
  return {
    pinned: pin,
    pinnedMessages: room.pinnedMessages ?? [],
    target: found
      ? {
          id: messageId,
          name: found.message.name,
          text: (found.message.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
        }
      : null,
  };
}
