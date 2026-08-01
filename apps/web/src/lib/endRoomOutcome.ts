// P0 End truthfulness.
//
// `handleEndMeeting` used to `catch { setEnded(true) }`, so a server rejection
// (a nonhost pressing End), a timeout, or a non-JSON response all rendered the
// room as successfully ended while it stayed live for everyone else. The
// decision is extracted here so the rule — only an authoritative success may
// transition — is executable rather than asserted in a comment.

export type EndOutcome =
  | { ended: true }
  | { ended: false; error: string };

/**
 * Message shown when ending is refused or fails.
 *
 * Raw exception text is NOT safe to render: a network or parse failure carries
 * URLs, hostnames and stack fragments, and nothing guarantees a thrown message
 * is user-facing. So this maps to a fixed set of safe strings and only ever
 * surfaces server text that matches a known refusal shape. Every variant states
 * the room is still active and says what to do next.
 */
export function endFailureMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message.trim() : '';
  // Authorization refusals are the one case worth quoting: they are written for
  // a person and they tell the reader who *can* act.
  if (/only the host|not the host|host can end/i.test(raw)) {
    return 'Only the host can end this room. It is still active — ask the host to end it.';
  }
  if (/already ended|room has ended/i.test(raw)) {
    return 'This room was already ended by someone else. Reload to see its final state.';
  }
  if (/failed to fetch|network|timeout|abort/i.test(raw)) {
    return 'Could not reach the server. The room is still active — check your connection and try again.';
  }
  return 'Could not end the room. It is still active — try again, or reload if this continues.';
}

/**
 * Decide the UI transition for one end attempt.
 *
 * `settled` is the resolved API result; pass the thrown value instead when the
 * call rejected. Only an explicit success transitions.
 */
export function endOutcome(result: { ok: true } | { thrown: unknown }): EndOutcome {
  if ('ok' in result && result.ok === true) return { ended: true };
  return { ended: false, error: endFailureMessage((result as { thrown: unknown }).thrown) };
}

/** Whether the idle prompt may offer an End control to this viewer. */
export function canOfferEnd(isHost: boolean): boolean {
  // The server rejects a nonhost end, so offering it manufactures a refusal
  // the user cannot act on — and, before this fix, one that looked like success.
  return isHost;
}

/** Idle-prompt body copy. A nonhost must not be told they can end the room. */
export function idlePromptCopy(isHost: boolean): string {
  return isHost
    ? 'This room stays open and your agents keep running until you end it.'
    : 'This room stays open and your agents keep running until the host ends it.';
}
