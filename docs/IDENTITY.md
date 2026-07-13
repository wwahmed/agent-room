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
