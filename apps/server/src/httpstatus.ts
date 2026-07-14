// HTTP status mapping for domain errors. Lives in its own module (rather than
// index.ts) so it is unit-testable: importing index.ts boots the HTTP server and
// exits when KV_TOKEN is unset.
export function statusForError(err: Error): number {
  switch (err.name) {
    case 'RoomNotFoundError':
      return 404;
    case 'HostNameTakenError':
    case 'MutedError':
    case 'NotYourTurnError':
    case 'NotHostError':
    case 'MemberAuthError':
      return 403;
    // T-66: the caller tried to bind its durable anchor to a row it has not
    // proven it owns. 409, not 403: the request is authenticated, but it
    // conflicts with an identity already bound to that row. Without this it
    // fell through to a 500, which reads as "server bug" rather than "refused".
    case 'AgentAnchorConflictError':
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
