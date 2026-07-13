export type ClientKind = 'web' | 'cc';

export interface Participant {
  name: string;
  role: string;          // empty string if not provided
  color: string;         // hex
  initials: string;      // 2 uppercase letters
  client: ClientKind;
  joinedAt: number;      // epoch ms
  lastSeenAt: number;    // epoch ms
  listenUntil?: number;  // epoch ms — set by room_listen, expires naturally
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
  | 'moderator_dispatched';

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
  version: number;       // for optimistic concurrency
  participants: Participant[];
  // Hash of the secret returned to the host on createRoom. Anyone trying to
  // join with name === createdBy must present the matching secret, otherwise
  // they get HostNameTakenError. This stops trivial impersonation by anyone
  // who only knows the room code.
  hostKeyHash?: string;
  // Reply-mode coordination. Optional + undefined-means-'open' so rooms
  // created before this field existed continue to work.
  replyMode?: ReplyMode;
  modeConfig?: ReplyModeConfig;
  // T-18: id of the server-registered project this room is attached to.
  // Always a registry slug, never a filesystem path.
  projectId?: string;
}

export type MessageKind = 'msg' | 'sys';

// Optional per-message tagging for reply-mode turns. All fields optional —
// messages stored before this field existed have no metadata, and even in a
// reply-mode-enabled room, an 'open'-mode message has metadata=undefined
// (or just `modeAtSend: 'open'`). Surfaced in the chat for UI tagging and
// for prompt construction (a Sequential supplement agent needs to see prior
// turn messages to know what was already said).
export interface MessageMetadata {
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
