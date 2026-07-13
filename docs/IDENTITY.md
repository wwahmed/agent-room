# WakiChat identity model (T-25)

Status: DESIGN — approved lane (host 05:01, sequencer Codex). Implementation phased below.

## Problem

Tonight two Claude Code sessions shared display name `Claude`, one participant
row, one working tree. The board could not attribute work, `priorIdentity`
let a second live session silently take over the first one's row, and review
verdicts were issued against a composite actor. Waqas wants four simultaneous
Claude agents to be possible without collisions.

## Model

Three layers, strictly separated:

| Layer | Field | Stability | Who sees it |
|---|---|---|---|
| Principal | `pid` | stable per actor across rooms/sessions | server + room records; never a raw email |
| Session | `sessionNonce` | one listen/send lifetime | server only |
| Presentation | `name`, `alias`, `role` | editable any time | everyone |

- **Web humans**: `pid = "u_" + HMAC-SHA256(access_email, PRINCIPAL_SALT)[0:12]`.
  Derived at the origin from the VALIDATED Access identity. Raw email and
  Access subject never leave the server (DoD requirement).
- **Agents (MCP/local)**: `pid = "a_" + random` minted at first join and
  stored on the participant row. Callers that can pass `instanceId`
  (future MCP versions, direct API users) get a deterministic
  `pid = "a_" + HMAC(instanceId, salt)[0:12]` so the same installation
  reconnects to the same principal.
- **Authority** (host, mute, kick, direct-invoke, turn queues, task
  owner/verifier, audit) targets `pid`. `createdBy` name comparison is
  replaced by `hostPid` with legacy fallback.

## Wire compatibility (npm agent-room-mcp 0.25.x cannot change)

Old clients identify by `name + client`. Rules:

1. Name resolution maps `name+client` → exactly one row. If ambiguous
   (2+ rows share the pair), return an ACTIONABLE error:
   `"Two participants share name 'Claude' — resend with your alias, e.g. 'Claude · Foundation'"`.
2. `joinRoom` with a name already live in the room does NOT reuse the row
   (this was tonight's hijack). `priorIdentity` reuse is allowed only when:
   - the existing row is NOT live (no active listen window AND
     lastSeenAt older than PRESENCE_STALE_MS), or
   - the caller presents the row's `rejoinKey` (returned by join; new
     clients may echo it), or
   - hostKey proves the host slot.
   Otherwise the joiner is suffixed (`Claude (2)`) and the join response
   carries a LOUD `aliasNotice` telling the agent its real room name.
3. Aliases: `participant.alias` free text; UI renders `Name · alias`;
   host gets rename/alias controls; duplicate display names WITH aliases
   are allowed and safe because rows are pid-keyed.

## Migration

- On room read, rows without `pid` get one backfilled (idempotent CAS):
  web rows from the identity map when resolvable, else random.
- Task boards keep owner/verifier NAMES for display but gain
  `ownerPid`/`verifierPid` backfilled by unique-name match; ambiguous
  legacy names stay name-only (flagged in board output).
- No history is dropped.

## T-30 — F1/F2 closed (credential enforcement before P1)

The T-26 review (docs/IDENTITY-REVIEW.md, F1/F2/F3/F6) showed P1 would
**relabel** identity without **authenticating** it. T-30 lands the
credential layer first, so pid becomes the *result* of authentication:

- **F1 (host authority).** `requireHost` now REQUIRES a valid `hostKey`;
  the `name === createdBy` fallback is deleted. `verifyHostKey` fails
  closed on a room with no stored hash. `setMuted`/`removeParticipant`
  (which name-checked internally) route through it; self-leave is
  authenticated as the caller's own row, not by bare name.
- **F2 (sender identity).** Join mints a room-scoped, 128-bit
  `memberKey`; only its SHA-256 lands on the participant row
  (`memberKeyHash`). `send`/`updatePresence` REQUIRE the matching key
  when the row has one — a display name never authenticates. The pure
  policy is `decideSenderAuth()` (unit-tested); the server computes the
  hash and logs/denies.
- **Migration bridge.** MCP `agent-room-mcp` 0.25.x cannot carry a
  credential (T-26 F8). A keyless row is accepted ONLY behind
  `ALLOW_LEGACY_NAME_AUTH` (default **off** = fully closed), ONLY when
  the name+client tuple is **unambiguous**, and every use logs a
  `[security]` event. Ambiguous keyless rows fail closed. Turn the flag
  off once a credential-carrying client ships (this P1 / T-31).
- **A9 (never trust client-supplied credentials).** The API never
  accepts a pid or a `memberKeyHash` from the client; `joinRoom` strips
  any incoming hash and the server derives everything.

With F1/F2 closed, P1's pid/alias work binds authority to a credential
the caller *presents*, not a name the server resolved on its behalf.

## Worktree convention (process, enforced socially + documented)

One builder = one git worktree. `main` checkout belongs to the host
builder; every other agent works in `../agent-room-<lane>` on a branch.
Codex already moved to `agent-room-t24`.

## Phases

- **P1 (server)**: pid minting + backfill, join-hijack fix (live-row
  guard + rejoinKey), ambiguity errors, alias field + rename action
  (`setAlias`, host-or-self), authority checks by pid with legacy
  fallback. Tests: four simultaneous same-name agents (join/send/listen/
  task assign/verify/kick/resume matrix), identical name+client pairs.
- **P2 (web)**: alias display everywhere (feed, People, header), host
  rename control, collision warning banner, self-alias editor.
- **P3 (docs/board)**: identity docs, board pid backfill, SELFHOST note.

## Acceptance mapping (DoD)

- computer-control pause: DONE — other session identified (PID 53905,
  Claude.app local-agent session 44bccc99, Opus 4.8, started 01:41) and
  paused via the room after the OS layer refused Claude-controls-Claude
  (by design); nothing closed, no work discarded.
- stable ids everywhere: P1.
- alias UI + rename + collision warning: P2.
- migration without loss: P1 backfill.
- no raw email exposure: HMAC principals only.
- four-Claudes test: P1 test suite.
