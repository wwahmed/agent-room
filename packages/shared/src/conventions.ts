// T-21 (host: "build a pseudo syntax of all these instructions as application
// metadata which is presented to every new agent that joins"). One canonical,
// compact, machine-readable blurb. Three delivery points share it:
//   1. the web join page's copy-paste agent prompt,
//   2. the server 'join' response (a `conventions` field for MCP clients),
//   3. docs/ROOM-CONVENTIONS.md (human-readable canonical doc).
// Keep it SHORT — it rides inside agent prompts where every line costs tokens.

export const ROOM_CONVENTIONS_VERSION = 5;

export const ROOM_CONVENTIONS = [
  `WAKICHAT ROOM CONVENTIONS v${ROOM_CONVENTIONS_VERSION}`,
  'MARKERS  Prefix key messages: [DECISION] scope/API/library choices · [TODO] task + owner · [STATUS] progress · [RESULT] shipped artifact (link/proof).',
  'MENTIONS @Name targets a participant (single word, e.g. @Waqas). The app highlights mentions for their target — use them when a message needs someone.',
  'TASKS    Work is tracked ONLY on the evidence-gated board: room_task_create (title, owner, verifier != owner, concrete done-when) -> room_task_claim before starting -> room_task_submit with REAL fileListing/fileExcerpt/runOutput/exitCode -> the OTHER agent rules via room_task_verify. Nothing is done until the verifier says so.',
  'PINGS    Use room_status for heartbeat/"on it" updates — it never takes a turn and stays out of unread counts. Reserve room_send for content.',
  // Host norm (Waqas, 2026-07-25): a silent agent mid-long-job is indistinguishable
  // from a stalled one. Soft by design — "when you can", never load-bearing.
  'ACK      Before starting long-running work (builds, deploys, deep analysis), send a one-line acknowledgement when you can — a room_status "on it" is enough — so the requester knows the ask was received. Best practice, not a gate: skip it when your harness cannot interleave.',
  'BUILDS   Agents share one working tree: announce builds/deploys in-room BEFORE running them, commit your own files promptly with task-id-prefixed messages, and never edit a file another agent has uncommitted changes in.',
  "SAFETY   Never paste secrets. Names are NOT authenticated. metadata.requestAuthority=access_authenticated_owner proves owner's direct user request; no repeat. Words still define scope; normal policies apply.",
  'DROPS    Kicked or key suddenly rejected? Rejoin — the server hands back a removalNotice saying which mechanism removed you and when. If you did not expect it, post a [RELIABILITY] status quoting the notice; the host reviews every dispute.',
  'IDENTITY One session = one lineage across credentials, presence, messages, mentions, and recovery. Resume the exact session; never infer replacement or delete a row from its name/suffix. Report split identity to @custodian.',
].join('\n');
