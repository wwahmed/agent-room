export type ClientKind = 'web' | 'cc';

export interface Participant {
  name: string;
  role: string;          // empty string if not provided
  color: string;         // hex
  initials: string;      // 2 uppercase letters
  client: ClientKind;
  // T-44/T-47: which agent harness runs this participant ('claude-code',
  // 'codex', 'cursor', ...), stamped by the MCP at join from its own detected
  // environment — NEVER derived from the display name. Display-only metadata:
  // absent on humans, web rows, and rows joined before this field existed.
  harness?: string;
  // T-47b: self-reported agent metadata supplied at join, so a manually-joined
  // agent is as legible in the People pane / agent-details view as a summoned
  // one — which account it runs on, its model, its workspace, and what it can
  // do. Display-only and UNTRUSTED (same trust class as `name`/`harness`):
  // never used for auth or gating. Absent on humans, web rows, and rows joined
  // before these fields existed. `account` is a human-readable label (a login
  // email / org name), NEVER a secret or token.
  model?: string;
  account?: string;
  workspace?: string;
  capabilities?: string;
  joinedAt: number;      // epoch ms
  lastSeenAt: number;    // epoch ms
  listenUntil?: number;  // epoch ms — set by room_listen, expires naturally
  // T-05: guest viewer — joined to observe, not to participate. Read-only
  // (sends are rejected server-side), excluded from agent counts/facepiles,
  // turn order, and presence alarms; the People pane lists viewers in their
  // own dimmed strip so "who's active" stays clean.
  viewer?: boolean;
  // T-04: declared work window. Stamped by a room_status ping or a task claim
  // — the two acts that already mean "I'm heads-down". While unexpired, the
  // participant reads as `working` instead of decaying toward stale, so a
  // busy agent is not shown as a dying one. Capped server-side; an expired
  // window degrades exactly like silence does today.
  workingUntil?: number;
  // Host approval gate. Undefined for participants joined before this field
  // existed (treated as legacy-approved). New joiners default to false until
  // the host (createdBy) approves them via approveParticipant.
  canSpeak?: boolean;
  // T-30 (F2): SHA-256 of a server-issued, room-scoped `memberKey` handed to
  // the client once at join. When present, the send/presence path REQUIRES
  // the matching plaintext key — a claimed display name alone no longer
  // authenticates. Absent on rows from credential-unaware clients (MCP
  // 0.25.x), which fall to the flag-gated, fail-closed-on-ambiguity legacy
  // path. Only the hash is ever stored; the plaintext lives client-side.
  memberKeyHash?: string;
  // T-25: SHA-256 of the server-VERIFIED authenticated identity (the Access
  // JWT email) of a web participant. This is the DURABLE reclaim anchor for a
  // human, because the web memberKey lives in per-tab sessionStorage and is
  // gone in a fresh tab / after a browser restart — but the Access cookie
  // persists. On (re)join, a web caller whose verified email hashes to this
  // value reclaims THIS row instead of being suffixed into a new one. Only the
  // hash is stored (rows are room-visible, so the raw email must never be),
  // and it is only ever set from the server-verified caller, never a client
  // claim. Absent on agent (cc) rows, which reclaim by memberKeyHash instead.
  authIdHash?: string;
  // T-66: SHA-256 of an agent's DURABLE, room-scoped anchor — the agent
  // equivalent of `authIdHash`, and the fix for a hole that made a lost key
  // unrecoverable.
  //
  // `memberKeyHash` alone is not enough to get an agent home: the memberKey
  // ROTATES on every join, so if the agent's credential store is lost before
  // the new key is persisted (proxy crash, disk loss), the row becomes
  // permanently unreclaimable — reclaim-by-key fails (the plaintext is gone)
  // and reclaim-by-priorIdentity is deliberately refused on protected rows
  // (the anti-hijack guard). Every rejoin then mints "Name (2)", "(3)" … and
  // the agent loses its task ownership, which is keyed by name.
  //
  // The anchor is derived from the agent's long-lived proxy secret, NOT from
  // the rotating key, so it is reconstructible after total credential loss.
  // It is per-agent (no other agent can derive it) and room-scoped (an anchor
  // captured for one room cannot reclaim an identity in another). Only the
  // hash is stored; the plaintext is injected by the agent's own proxy and
  // never reaches the agent, its transcript, or the chat.
  agentIdHash?: string;
}

// How agent responses are coordinated in this room.
//   - 'open' (default, legacy): anyone can speak any time. Current behavior.
//   - 'sequential': a designated Lead answers first, the rest of the agents
//     supplement in join order. Only one agent is allowed to speak per turn;
//     human participants (web) and the host are always allowed.
//   - 'moderator': a designated Moderator agent receives the host's message,
//     then assigns work to specific agents. Non-assigned agents stay silent.
// Field is optional on Room so legacy stored rooms (written before reply-mode
// existed) parse fine; readers should treat undefined as 'open'.
export type ReplyMode = 'open' | 'sequential' | 'moderator';

// Per-message marker for which role this message played in the turn machine.
// Used both for UI tagging and for prompt construction (e.g. a supplement
// agent's prompt needs to see prior lead/supplement messages from this turn).
export type RoleInTurn =
  | 'open'           // sent under reply-mode 'open' (no turn)
  | 'lead'           // sequential mode — the lead answer
  | 'supplement'     // sequential mode — a follow-up supplement
  | 'wrap'           // sequential mode — the Lead's closing wrap-up turn,
                     // issued once after the supplement queue drains
  | 'moderator'      // moderator mode — moderator dispatching/summarizing
  | 'assignee'       // moderator mode — an agent answering a moderator assignment
  | 'host_directed'  // host used direct-invoke to call this agent (any mode)
  | 'human';         // sent by a web client / human participant

// Why this message was produced. UI / prompts can distinguish a normal turn
// message from a host's one-shot direct call from a moderator assignment.
export type InvocationType =
  | 'normal_turn'
  | 'host_directed'
  | 'moderator_assigned';

// Kind of system event encoded as a sys-typed Message. Surfaced in the chat
// so participants can see why state changed (mode switched, agent timed out,
// host manually skipped someone, etc).
export type SystemEventType =
  | 'mode_changed'
  | 'lead_changed'
  | 'moderator_changed'
  | 'timed_out'
  | 'skipped_by_host'
  | 'skipped_by_grace'
  | 'lead_left'
  | 'moderator_left'
  | 'moderator_fallback'
  | 'host_invoked'
  | 'moderator_dispatched'
  | 'question_created'
  | 'reaction'
  | 'pin'
  | 'template_changed';

// Default per-role timeout values (in ms). Used when a room hasn't been
// configured with custom overrides. Tuned higher than the chat default
// because real LLM calls (with tool use) can take 30-60s. Moderator gets
// the longest window because they read + decide + dispatch in one turn.
export const DEFAULT_TURN_TIMEOUTS_MS = {
  lead: 90_000,
  supplement: 45_000,
  moderator: 300_000,
  assignee: 90_000,
} as const;

// Sequential mode: how long after a turn starts the Lead has the floor
// exclusively. Once this elapses the queue-head supplement may also speak;
// whichever lands first wins the turn and the loser is logged as
// status='skipped_by_grace'. Stops sequential head-of-line blocking when
// the Lead is slow or offline.
export const DEFAULT_LEAD_GRACE_MS = 20_000;

// Per-room reply-mode configuration. All fields optional so a room can be
// created without naming a Lead/Moderator until the host actually picks a
// non-open mode. setReplyMode validates that the right fields are present
// for the requested mode.
export interface ReplyModeConfig {
  // Sequential mode: the agent who answers first. Identity is (name, client)
  // because the same display name can appear from different clients (rare
  // but legal). When unset in sequential mode, the first cc-client agent
  // that joined is used as Lead by fallback.
  leadAgentName?: string;
  leadAgentClient?: ClientKind;

  // Moderator mode: the agent that dispatches work. Required when setting
  // mode to 'moderator'.
  moderatorAgentName?: string;
  moderatorAgentClient?: ClientKind;

  // Optional per-role timeout overrides (ms). Missing roles fall back to
  // DEFAULT_TURN_TIMEOUTS_MS. Stored at room level (not turn state) so
  // settings survive server restarts.
  timeoutMs?: Partial<typeof DEFAULT_TURN_TIMEOUTS_MS>;

  // Sequential mode: lead-grace window in ms. After this elapses the
  // queue-head supplement may speak even though the Lead is still current
  // — see canAgentSpeakNow / applyGraceSupplementReply. Defaults to
  // DEFAULT_LEAD_GRACE_MS. Must satisfy 0 <= leadGraceMs <= lead deadline
  // (a grace window longer than the Lead's own deadline is nonsensical).
  leadGraceMs?: number;
}

// T-32: why a participant row was removed by the server. Every server-side
// removal path stamps one of these so no agent is ever kicked without a
// paper trail (the glue-vow-soap class of "the room removed me and nobody
// can say why").
export interface RemovalRecord {
  mechanism: 'host_removal' | 'join_displacement' | 'anchor_recovery';
  /** Who triggered it: the host's name, or the joining identity that displaced the row. */
  byName?: string;
  at: number;
  /** The removed row's agentIdHash, when it had one. Binds the notice to the
   *  identity that lost the row so a stranger joining under the same name
   *  cannot pop someone else's removal record. SERVER-ONLY: stripped by
   *  redactRoomPayload and never included in the removalNotice handed out. */
  anchorHash?: string;
}

// T-14: a pinned outcome — a decision, result, or link promoted out of the
// scroll. DENORMALIZED (sender + snippet travel on the pin, like
// MessageReplyRef) so the pinned strip renders even after the original
// message pages out of the loaded window or is LTRIMmed from history.
export interface PinnedMessage {
  /** id of the pinned message. */
  id: number;
  /** The pinned message's sender display name. */
  name: string;
  /** Server-truncated snippet of the pinned message body. */
  text: string;
  /** Who pinned it. */
  by: string;
  /** Epoch ms when it was pinned. */
  at: number;
}

export interface Room {
  code: string;
  topic: string;
  createdAt: number;
  createdBy: string;
  ownerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  status: 'active' | 'ended';
  endedAt?: number;      // epoch ms — set when meeting ends
  archived?: boolean;    // reversible: hidden from Active/Ended into the Archived view
  archivedAt?: number;   // epoch ms — set when archived
  workspace?: string;    // local workspace path the room is based in; summoned agents inherit it
  version: number;       // for optimistic concurrency
  participants: Participant[];
  // Hash of the secret returned to the host on createRoom. Anyone trying to
  // join with name === createdBy must present the matching secret, otherwise
  // they get HostNameTakenError. This stops trivial impersonation by anyone
  // who only knows the room code.
  hostKeyHash?: string;
  // T-32 removal provenance: the last involuntary removal of each identity,
  // keyed `${name}\n${client}`. Written by every server-side removal path
  // (host kick, join displacement, anchor recovery) and handed back — then
  // cleared — on that identity's next join, so a returning agent learns WHY
  // it was removed and can dispute it in-room. Names + timestamps only;
  // never credential material.
  lastRemovals?: Record<string, RemovalRecord>;
  // SHA-256 of the server-VERIFIED authenticated identity that created the
  // room. This is the host equivalent of Participant.authIdHash: it lets the
  // same Google/Access account recover host authority on another device where
  // the browser-local hostKey is unavailable. Raw email is never stored, and
  // the field is redacted from every API response.
  hostAuthIdHash?: string;
  // Reply-mode coordination. Optional + undefined-means-'open' so rooms
  // created before this field existed continue to work.
  replyMode?: ReplyMode;
  modeConfig?: ReplyModeConfig;
  // T-18: id of the server-registered project this room is attached to.
  // Always a registry slug, never a filesystem path.
  projectId?: string;
  // Room-template id (shared/templates.ts registry). Host-editable AFTER
  // creation ('setTemplate'), so existing rooms can be converted; undefined
  // means untyped/blank. This is what turns templates from a create-form
  // veneer into a shared fact every joiner (human or agent) can read.
  templateId?: string;
  // T-14: pinned outcomes, oldest pin first, bounded (MAX_PINNED_MESSAGES).
  // Lives on the room record so every client sees the same strip from the
  // ordinary room poll — no extra fetch, survives message trimming.
  pinnedMessages?: PinnedMessage[];
}

// Structured prompts stored as private owner-decision documents. A safe link
// card travels through chat, but prompt/answer content stays in this record.
export type RoomQuestionMode = 'single' | 'multiple' | 'text';

export interface RoomQuestionOption {
  id: string;
  label: string;
}

export interface RoomQuestionAnswer {
  value: string | string[];
  answeredAt: number;
  answeredBy: string;
}

export interface RoomQuestion {
  id: string;
  prompt: string;
  context?: string;
  mode: RoomQuestionMode;
  options?: RoomQuestionOption[];
  createdBy: string;
  createdByClient: ClientKind;
  createdAt: number;
  answer?: RoomQuestionAnswer;
}

export type MessageKind = 'msg' | 'sys';

// Optional per-message tagging for reply-mode turns. All fields optional —
// messages stored before this field existed have no metadata, and even in a
// reply-mode-enabled room, an 'open'-mode message has metadata=undefined
// (or just `modeAtSend: 'open'`). Surfaced in the chat for UI tagging and
// for prompt construction (a Sequential supplement agent needs to see prior
// turn messages to know what was already said).
export interface MessageMetadata {
  // The sender dictated this message by voice. Recipients (human and agent)
  // should read transcription artifacts charitably — odd words may be the
  // speech engine, not the speaker. Set by the web composer at send time.
  dictated?: boolean;
  modeAtSend?: ReplyMode;
  roleAtSend?: RoleInTurn;
  // Stable id for the current turn (epoch ms of when the turn started).
  // Lets UI / reports group lead+supplements together.
  turnId?: number;
  invocationType?: InvocationType;
  // For sys-typed messages: which event the system message is reporting.
  // Used by the UI to render skips/timeouts/mode-changes differently than
  // a free-text system message.
  eventType?: SystemEventType;
  // For host_directed / moderator_assigned / event messages: the participant
  // this message is about. e.g. "Moderator assigned this to Claude" stores
  // targetAgentName='Claude'. For timed_out events, the agent that timed out.
  targetAgentName?: string;
  targetAgentClient?: ClientKind;
  // For skipped_by_host / timed_out events: who/what triggered the skip.
  skippedBy?: 'system' | 'host';
  // Sequential mode: room_status heartbeat that renewed the speaker's deadline
  // instead of ending the turn (UI/report show "still working" pings).
  extendsTurn?: boolean;
  // template_changed events: the template id the room was retagged to
  // (absent when the host cleared the type).
  templateId?: string;
  // Structured owner-question artifact linked from an inline chat card. The
  // card itself contains no private prompt/answer content; authorized viewers
  // resolve this id through the owner Questions API.
  questionId?: string;
  // T-121 reaction event rows (eventType === 'reaction'): which stored message
  // the reaction landed on, what changed, and the target's FULL post-change
  // reaction list. The snapshot is what lets cursor-polling web clients patch
  // an already-rendered message without refetching history (the stored row is
  // LSET in place, which append-only cursors never see again).
  targetMessageId?: number;
  reactionKind?: MessageReactionKind;
  reactionRemoved?: boolean;
  reactionsSnapshot?: MessageReaction[];
  // T-139: an /brief command result rendered as an EXECUTIVE BRIEF card. The
  // message text carries the display (markdown) rendering; briefSpeech carries
  // the speech-optimized rendering the 🔊 button plays (same facts, IDs/URLs
  // stripped). briefScope notes a /brief <topic> or deep run for provenance.
  brief?: boolean;
  briefSpeech?: string;
  briefScope?: string;
}

// T-121: structured acknowledge/reject state on a message. Stored ON the
// message (authoritative) and mirrored into a sys event row's metadata so both
// humans (chips) and listening agents (event text) can read it.
export type MessageReactionKind = 'ack' | 'reject';

export interface MessageReaction {
  kind: MessageReactionKind;
  name: string;        // reactor display name
  client: ClientKind;  // reactor client kind (web = human, cc = agent)
  time: number;        // epoch ms when the reaction was applied
}

// T-53: a quoted message carried on the replying message. Denormalized (author
// + snippet live here, not a pointer) so the quote still renders after the
// original is paged out by lazy-load; `id` remains the scroll-to target.
export interface MessageReplyRef {
  id: number;    // quoted message's id (epoch ms) — the jump target
  name: string;  // quoted author display name
  text: string;  // short snippet of the quoted text (server-truncated)
}

export interface Message {
  id: number;            // epoch ms at creation
  type: MessageKind;
  name: string;
  initials: string;
  color: string;
  role: string;
  text: string;
  client: ClientKind;
  time: number;
  attachments?: MessageAttachment[];
  replyTo?: MessageReplyRef;
  // T-121: acknowledge/reject reactions. Authoritative copy — the stored row
  // is updated in place (LSET) when someone reacts.
  reactions?: MessageReaction[];
  metadata?: MessageMetadata;
}

export interface MessageAttachment {
  id: string;
  type: 'file' | 'image';
  url: string;
  storageKey?: string;
  name: string;
  size: number;
  mime: string;
  uploadedAt: number;
  width?: number;
  height?: number;
}

export type ArtifactKind = 'decision' | 'todo' | 'status' | 'result';

export interface RoomArtifact {
  id: string;
  kind: ArtifactKind;
  text: string;
  sourceMessageId: number;
  author: string;
  time: number;
}

export interface ReportParticipant {
  name: string;
  role: string;
  client: ClientKind;
}

export interface RoomReport {
  code: string;
  topic: string;
  createdAt: number;
  exportedAt: number;
  ownerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  participants: ReportParticipant[];
  messageCount: number;
  summary: string;
  highlights: string[];
  decisions: string[];
  actionItems: string[];
  artifacts: RoomArtifact[];
  transcript: Message[];
}
