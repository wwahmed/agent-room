// HTTP status mapping for domain errors. Lives in its own module (rather than
// index.ts) so it is unit-testable: importing index.ts boots the HTTP server and
// exits when KV_TOKEN is unset.
export function statusForError(err: Error): number {
  switch (err.name) {
    case 'RoomNotFoundError':
      return 404;
    case 'HostNameTakenError':
    case 'MutedError':
    // T-05: a guest viewer tried to speak — same refusal tier as muted.
    case 'ViewerError':
    case 'NotYourTurnError':
    case 'NotHostError':
    case 'MemberAuthError':
    // T-126: read markers demand an authenticated account (or explicit
    // account naming from the trusted loopback tier).
    case 'AccessDeniedError':
      return 403;
    // T-66: the caller tried to bind its durable anchor to a row it has not
    // proven it owns. 409, not 403: the request is authenticated, but it
    // conflicts with an identity already bound to that row. Without this it
    // fell through to a 500, which reads as "server bug" rather than "refused".
    case 'AgentAnchorConflictError':
    // T-49: the session that offered a view action is not in the room right now.
    // 409, not 400: the request is well-formed and will succeed once that exact
    // session resumes, so the client must offer a retry rather than retire the card.
    case 'ViewActionUnavailableError':
    // A clientSendId may be replayed only for the exact original payload.
    // Reusing it for changed content is a deterministic operation conflict.
    case 'MessageOperationConflictError':
      return 409;
    case 'InvalidModeConfigError':
    case 'ModeNotSupportedError':
    case 'BadRequestError':
      return 400;
    case 'LedgerConflictError':
      return 409;
    case 'ProjectRegistryError':
      return 503; // registry misconfigured: project features fail closed
    default:
      return 500;
  }
}
