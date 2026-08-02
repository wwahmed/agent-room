import type { Message, MessageMetadata, MessageReaction, MessageReactionKind, MessageReplyRef, RoleInTurn, InvocationType } from '@agent-room/shared';
import { MAX_MESSAGES_PER_ROOM, ROOM_TTL_SECONDS, extractArtifacts } from '@agent-room/shared';
import { artifactAppendCommands } from './artifactStore.js';
import type { UpstashClient } from './client.js';
import { findSpeaker, MutedError, NotYourTurnError, ViewerError, getRoom, sha256Hex } from './rooms.js';
import type { TurnSpokenEntry, TurnState } from './turnState.js';
import {
  advanceOnTimeout,
  advanceTurn,
  applyGraceSupplementReply,
  canAgentSpeakNow,
  casTurnState,
  consumeHostDirectedDetailed,
  isGraceSupplementSpeaker,
  isHumanSender,
  moderatorReply,
  newModeratorTurn,
  newSequentialTurn,
  shouldStartNewTurn,
  skipQueueHead,
} from './turnState.js';

function msgsKey(code: string): string { return `room-msgs:${code}`; }
// Tracks the absolute count of messages ever appended to this room. Used by
// listMessages to translate an agent's logical cursor (= "I've consumed N
// messages so far") into the right LRANGE start position even after LTRIM has
// dropped the oldest entries. Without this, once the list crosses
// MAX_MESSAGES_PER_ROOM the index stored in the cursor stops mapping to the
// list slot the agent thinks it does, and agents silently MISS messages
// (witnessed: 499 in list, +2 RPUSH, LTRIM keeps last 500 → first new
// message is now at index 498, but cursor=499 LRANGEs from 499 and only
// returns the second new message). The counter key is INCRed in the same
// pipeline as RPUSH/LTRIM so it can never drift relative to the list.
function msgCountKey(code: string): string { return `room-msg-count:${code}`; }
function turnStateKey(code: string): string { return `turn-state:${code}`; }
function sendReceiptKey(code: string, sender: string, clientSendId: string): string {
  return `room-send-receipt:${code}:${sender}:${clientSendId}`;
}

export class MessageOperationConflictError extends Error {
  constructor() {
    super('This send id is already bound to different message content.');
    this.name = 'MessageOperationConflictError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).filter(k => row[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(row[k])}`).join(',')}}`;
  }
  return 'null';
}

interface SendReceipt {
  v: 1;
  payloadHash: string;
  outcome: AppendResult;
}

async function sendProof(
  code: string,
  sender: string,
  message: Message,
): Promise<{ key: string; payloadHash: string } | null> {
  const clientSendId = message.metadata?.clientSendId;
  if (clientSendId === undefined) return null;
  if (!/^[a-f0-9]{32}$/.test(clientSendId)) {
    const err = new Error('metadata.clientSendId must be 32 lowercase hex characters.');
    err.name = 'BadRequestError';
    throw err;
  }
  const payloadHash = await sha256Hex(canonicalJson({ ...message, text: message.text ?? '' }));
  return { key: sendReceiptKey(code, sender, clientSendId), payloadHash };
}

function parseReceipt(raw: unknown, payloadHash: string): AppendResult {
  let receipt: SendReceipt;
  try { receipt = JSON.parse(String(raw)) as SendReceipt; }
  catch { throw new MessageOperationConflictError(); }
  if (receipt.v !== 1 || receipt.payloadHash !== payloadHash || !receipt.outcome) {
    throw new MessageOperationConflictError();
  }
  return receipt.outcome;
}

async function existingReceipt(
  client: UpstashClient,
  proof: { key: string; payloadHash: string } | null,
): Promise<AppendResult | null> {
  if (!proof) return null;
  const raw = await client.command<string | null>(['GET', proof.key]);
  return raw === null || raw === undefined ? null : parseReceipt(raw, proof.payloadHash);
}

async function appendWithReceipt(
  client: UpstashClient,
  code: string,
  message: Message,
  proof: { key: string; payloadHash: string },
  outcome: AppendResult,
): Promise<AppendResult> {
  const normalized: Message = { ...message, text: message.text ?? '' };
  const artifacts = extractArtifacts([normalized]);
  const receipt = canonicalJson({ v: 1, payloadHash: proof.payloadHash, outcome } satisfies SendReceipt);
  const script = [
    'local prior = redis.call("GET", KEYS[3])',
    'if prior then',
    '  local ok, row = pcall(cjson.decode, prior)',
    '  if not ok or type(row) ~= "table" or row.payloadHash ~= ARGV[1] then return {4} end',
    '  return {2, prior}',
    'end',
    'local msgType = redis.call("TYPE", KEYS[1])["ok"]',
    'local countType = redis.call("TYPE", KEYS[2])["ok"]',
    'local artifactType = redis.call("TYPE", KEYS[4])["ok"]',
    'if (msgType ~= "none" and msgType ~= "list")',
    '  or (countType ~= "none" and countType ~= "string")',
    '  or (artifactType ~= "none" and artifactType ~= "list") then return {0} end',
    'redis.call("SET", KEYS[3], ARGV[2], "EX", ARGV[5])',
    'redis.call("RPUSH", KEYS[1], ARGV[3])',
    'redis.call("INCR", KEYS[2])',
    'redis.call("LTRIM", KEYS[1], -tonumber(ARGV[4]), -1)',
    'for i = 1, tonumber(ARGV[6]) do redis.call("RPUSH", KEYS[4], ARGV[6 + i]) end',
    'redis.call("EXPIRE", KEYS[1], ARGV[5])',
    'redis.call("EXPIRE", KEYS[2], ARGV[5])',
    'redis.call("EXPIRE", KEYS[4], ARGV[5])',
    'return {1}',
  ].join('\n');
  const raw = await client.command<unknown>([
    'EVAL', script, '4',
    msgsKey(code), msgCountKey(code), proof.key, `room-artifacts-v2:${code}`,
    proof.payloadHash, receipt, JSON.stringify(normalized),
    String(MAX_MESSAGES_PER_ROOM), String(ROOM_TTL_SECONDS),
    String(artifacts.length), ...artifacts.map(a => JSON.stringify(a)),
  ]);
  const result = Array.isArray(raw) ? raw : [];
  if (Number(result[0]) === 1) return outcome;
  if (Number(result[0]) === 2) return parseReceipt(result[1], proof.payloadHash);
  if (Number(result[0]) === 4) throw new MessageOperationConflictError();
  throw new Error('Atomic message append refused unreadable Redis state.');
}

async function commitTurnWithReceipt(
  client: UpstashClient,
  code: string,
  input: {
    expectedTurnRaw: string | null;
    nextTurnRaw: string | null;
    message: Message | null;
    proof: { key: string; payloadHash: string };
    outcome: AppendResult;
  },
): Promise<'committed' | 'retry' | AppendResult> {
  const NIL = '__agent_room_nil__';
  const normalized = input.message ? { ...input.message, text: input.message.text ?? '' } : null;
  const artifacts = normalized ? extractArtifacts([normalized]) : [];
  const receipt = canonicalJson({
    v: 1, payloadHash: input.proof.payloadHash, outcome: input.outcome,
  } satisfies SendReceipt);
  const script = [
    'local prior = redis.call("GET", KEYS[4])',
    'if prior then',
    '  local ok, row = pcall(cjson.decode, prior)',
    '  if not ok or type(row) ~= "table" or row.payloadHash ~= ARGV[1] then return {4} end',
    '  return {2, prior}',
    'end',
    'local current = redis.call("GET", KEYS[1])',
    'if ARGV[3] == ARGV[9] then',
    '  if current then return {3} end',
    'elseif current ~= ARGV[3] then return {3} end',
    'local msgType = redis.call("TYPE", KEYS[2])["ok"]',
    'local countType = redis.call("TYPE", KEYS[3])["ok"]',
    'local artifactType = redis.call("TYPE", KEYS[5])["ok"]',
    'if (msgType ~= "none" and msgType ~= "list")',
    '  or (countType ~= "none" and countType ~= "string")',
    '  or (artifactType ~= "none" and artifactType ~= "list") then return {0} end',
    'redis.call("SET", KEYS[4], ARGV[2], "EX", ARGV[8])',
    'if ARGV[4] == ARGV[9] then redis.call("DEL", KEYS[1])',
    'else redis.call("SET", KEYS[1], ARGV[4], "EX", ARGV[8]) end',
    'if ARGV[5] ~= "" then',
    '  redis.call("RPUSH", KEYS[2], ARGV[5])',
    '  redis.call("INCR", KEYS[3])',
    '  redis.call("LTRIM", KEYS[2], -tonumber(ARGV[7]), -1)',
    '  for i = 1, tonumber(ARGV[6]) do redis.call("RPUSH", KEYS[5], ARGV[9 + i]) end',
    '  redis.call("EXPIRE", KEYS[2], ARGV[8])',
    '  redis.call("EXPIRE", KEYS[3], ARGV[8])',
    '  redis.call("EXPIRE", KEYS[5], ARGV[8])',
    'end',
    'return {1}',
  ].join('\n');
  const raw = await client.command<unknown>([
    'EVAL', script, '5',
    turnStateKey(code), msgsKey(code), msgCountKey(code), input.proof.key,
    `room-artifacts-v2:${code}`,
    input.proof.payloadHash, receipt,
    input.expectedTurnRaw ?? NIL, input.nextTurnRaw ?? NIL,
    normalized ? JSON.stringify(normalized) : '',
    String(artifacts.length), String(MAX_MESSAGES_PER_ROOM), String(ROOM_TTL_SECONDS),
    NIL, ...artifacts.map(a => JSON.stringify(a)),
  ]);
  const result = Array.isArray(raw) ? raw : [];
  if (Number(result[0]) === 1) return 'committed';
  if (Number(result[0]) === 2) return parseReceipt(result[1], input.proof.payloadHash);
  if (Number(result[0]) === 3) return 'retry';
  if (Number(result[0]) === 4) throw new MessageOperationConflictError();
  throw new Error('Atomic turn/message append refused unreadable Redis state.');
}

/** Next poll cursor after a full `listMessages(..., 0)` when the room has a counter key; `null` = legacy room. */
export async function getMessageTotalCount(client: UpstashClient, code: string): Promise<number | null> {
  const countRaw = await client.command<unknown>(['GET', msgCountKey(code)]);
  if (countRaw === null || countRaw === undefined) return null;
  const totalCount = typeof countRaw === 'number' ? countRaw : parseInt(String(countRaw), 10);
  return Number.isFinite(totalCount) ? totalCount : null;
}

// Supplement-skip token. A supplement agent that has nothing to add MUST
// emit this exact string (after trim) — appendMessage detects it, advances
// the turn with status='no_addition', and does NOT append a message to the
// chat. Slice B does exact-match only; fuzzy matching ("无补充", "Nothing
// to add", etc.) is deferred to a later iteration once we have real prompt
// outputs to calibrate against.
export const NO_ADDITION_TOKEN = '__no_addition__';

// Result of a successful appendMessage call. `appended` is true for normal
// chat messages (the message ended up in the list); false for messages
// that were absorbed by the turn machinery (the supplement-skip token, or
// any future "swallowed" case). Callers like the MCP room_send handler use
// this to decide what hint to send back to the agent.
export interface AppendResult {
  appended: boolean;
  reason?: 'no_addition';
  // The metadata that ended up on the message (or, in the no_addition
  // case, the metadata that WOULD have been attached). Useful for
  // surfacing roleAtSend/turnId in the tool response.
  metadata: MessageMetadata;
  // Sequential lead-grace path: when a queue-head supplement preempts the
  // Lead, the Lead is logged as skipped_by_grace inside the CAS mutator.
  // We surface that entry here so the MCP layer can post a sys message
  // explaining the skip (mirrors how advanceOnTimeout's skipped[] flows
  // to emitTimeoutSysMessage).
  leadSkipped?: TurnSpokenEntry;
}

// Append a message. Server-side gates, in order:
//   1. Mute gate: (name, client) must be a non-muted participant. Throws
//      MutedError otherwise.
//   2. Turn gate (sequential/moderator modes only): the sender must be the
//      current turn-holder, OR a human (web client / host), OR present in
//      the host-directed one-shot allowlist. Throws NotYourTurnError
//      otherwise.
//
// Side effects on success:
//   - Sequential mode: a human message kicks off a new turn if none is
//     active; an agent message advances the turn cursor. Lazy timeout
//     check runs first, silently skipping past expired speakers (callers
//     that want sys messages for those skips watch via the listen poll).
//   - Message metadata is enriched with modeAtSend / roleAtSend / turnId
//     / invocationType. Callers that pre-set message.metadata fields keep
//     them — server-side fields are merged in, server wins on conflict.
//   - Supplement-skip token (`__no_addition__`) advances the turn WITHOUT
//     appending a chat message; returns { appended: false, reason: 'no_addition' }.
// T-53: the server owns the quoted snippet — never trust a client-supplied
// length. Truncate, collapse whitespace, require a valid target id; anything
// malformed drops the quote rather than storing junk.
const REPLY_SNIPPET_MAX = 120;
const REPLY_NAME_MAX = 80;
export function normalizeReplyTo(r: unknown): MessageReplyRef | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id) || id <= 0) return undefined;
  const name = typeof o.name === 'string' ? o.name : '';
  const text = typeof o.text === 'string' ? o.text : '';
  return {
    id,
    name: name.slice(0, REPLY_NAME_MAX),
    text: text.replace(/\s+/g, ' ').trim().slice(0, REPLY_SNIPPET_MAX),
  };
}

export async function appendMessage(
  client: UpstashClient,
  code: string,
  message: Message
): Promise<AppendResult> {
  const room = await getRoom(client, code);
  // T-05: viewers are read-only BY THEIR OWN CHOICE — reject before the mute
  // gate so the error says "you joined as a viewer", not "the host muted you".
  const row = room.participants.find(x => x.name === message.name && x.client === message.client);
  if (row?.viewer === true) {
    throw new ViewerError(message.name);
  }
  if (!findSpeaker(room, message.name, message.client)) {
    throw new MutedError(message.name, room.createdBy);
  }
  // Sanitize the quote once at the funnel so every store path carries the
  // server-truncated version (both the open fast-path and the turn-gated path).
  message = { ...message, replyTo: normalizeReplyTo(message.replyTo) };
  // Scope receipts to the strongest stable, server-owned identity available.
  // Do not hash every row field together: member keys rotate on rejoin, so that
  // would silently change the receipt namespace precisely during the recovery
  // window this protocol exists to make safe. lineageId is designed to survive
  // a credential-proved reconnect while remaining distinct for a replacement.
  const senderAnchor =
    row?.lineageId ? { kind: 'lineage', value: row.lineageId }
      : row?.agentIdHash ? { kind: 'agent', value: row.agentIdHash }
        : row?.authIdHash ? { kind: 'auth', value: row.authIdHash }
          : row?.memberKeyHash ? { kind: 'member', value: row.memberKeyHash }
            : {
                kind: 'legacy',
                name: row?.name ?? message.name,
                client: row?.client ?? message.client,
                joinedAt: row?.joinedAt,
              };
  const senderIdentity = await sha256Hex(canonicalJson(senderAnchor));
  const proof = await sendProof(code, senderIdentity, message);
  const mode = room.replyMode ?? 'open';

  // Fast path: open mode. No turn machinery — preserves the legacy hot
  // path bit-for-bit so existing rooms see zero added latency.
  if (mode === 'open') {
    const metadata: MessageMetadata = {
      ...(message.metadata ?? {}),
      modeAtSend: 'open',
      roleAtSend: 'open',
      invocationType: message.metadata?.invocationType ?? 'normal_turn',
    };
    const enriched: Message = { ...message, metadata };
    const outcome: AppendResult = { appended: true, metadata };
    if (proof) return appendWithReceipt(client, code, enriched, proof, outcome);
    await rpushMessage(client, code, enriched);
    return outcome;
  }

  // Non-open mode: validate and advance turn state atomically.
  // `casTurnState`'s mutator is synchronous and may throw NotYourTurnError
  // to reject — casTurnState re-throws non-Concurrency errors, which we
  // propagate up to the caller (MCP room_send turns this into
  // sent=false/not_your_turn).
  const text = message.text ?? '';
  const isSupplementSkipToken = text.trim() === NO_ADDITION_TOKEN;
  const decision: {
    roleAtSend: RoleInTurn;
    invocationType: InvocationType;
    turnId?: number;
    skipMessage: boolean;
    leadSkipped?: TurnSpokenEntry;
  } = {
    roleAtSend: 'open',
    invocationType: 'normal_turn',
    skipMessage: false,
  };

  const mutateTurn = (prev: TurnState | null): TurnState | null => {
    // Reset per-attempt decision state so a CAS retry doesn't carry over
    // metadata or leadSkipped from a stale earlier attempt.
    decision.roleAtSend = 'open';
    decision.invocationType = 'normal_turn';
    decision.turnId = undefined;
    decision.skipMessage = false;
    decision.leadSkipped = undefined;
    // Lazy cleanup: skip any expired speakers before evaluating this
    // sender. Skipped sys messages are emitted by the listen poll, not
    // here — appendMessage is on the hot path and must not RPUSH a sys
    // event from inside a CAS mutator. We *do* update state.spoken so
    // the listen poll sees the skips and can emit the appropriate
    // events.
    const after = advanceOnTimeout(prev, room);
    let cur = after.state;
    const now = Date.now();

    if (isHumanSender(room, message.name, message.client)) {
      // Humans (web client or the host) are never turn-gated. If a new
      // turn should start, kick one off — sequential and moderator
      // modes each have their own initial-state shape.
      if (shouldStartNewTurn(cur, room)) {
        if (mode === 'sequential') {
          cur = newSequentialTurn(room, message.id);
        } else if (mode === 'moderator') {
          cur = newModeratorTurn(room, message.id);
          // Moderator mode requires a configured Moderator who is
          // currently present in the room. If we couldn't pick one,
          // newModeratorTurn returns null — the human message stands
          // alone and no agent is expected to reply. (The room remains
          // in moderator mode; sweepTimeouts will eventually auto-
          // fallback to open if this stays broken.)
        }
      }
      decision.roleAtSend = 'human';
      decision.invocationType = 'normal_turn';
      decision.turnId = cur?.turnId;
      return cur;
    }

    // cc agent (not the host) — must be the current speaker, or the
    // grace-eligible queue-head supplement, or in the host-directed
    // allowlist.
    if (cur && canAgentSpeakNow(cur, message.name, message.client, now)) {
      const isGrace = isGraceSupplementSpeaker(cur, message.name, message.client, now);
      const role: RoleInTurn = isGrace ? 'supplement' : cur.currentRole!;
      const turnId = cur.turnId;
      decision.roleAtSend = role;
      decision.invocationType = 'normal_turn';
      decision.turnId = turnId;
      // Supplement-skip token: advance with status='no_addition', do NOT
      // append a chat message. During lead grace we treat this as the
      // supplement bowing out (drop from queue, lead keeps the floor),
      // NOT as a preemption — opting out is a soft signal, not a claim
      // on the mic.
      if (isSupplementSkipToken) {
        decision.skipMessage = true;
        if (isGrace) {
          return skipQueueHead(cur, 'no_addition', now);
        }
        return advanceTurn(cur, 'no_addition', room, now);
      }
      // Moderator mode: Moderator-as-current keeps current after reply
      // (no queue pop). They route via room_direct_invoke; their
      // deadline resets each time they actually post a message.
      if (cur.mode === 'moderator' && role === 'moderator') {
        return moderatorReply(cur, room, now);
      }
      // Grace path: queue-head supplement preempts Lead. Log the Lead
      // as skipped_by_grace and surface that entry so the caller can
      // post a sys message.
      if (isGrace) {
        const result = applyGraceSupplementReply(
          cur, message.name, message.client, room, now,
        );
        decision.leadSkipped = result.leadSkipped;
        return result.state;
      }
      return advanceTurn(cur, 'replied', room, now);
    }
    if (cur) {
      const directed = consumeHostDirectedDetailed(cur, message.name, message.client);
      if (directed.consumed) {
        // Moderator dispatch ('assignee') vs host override
        // ('host_directed') are tracked separately for reporting.
        decision.roleAtSend = directed.source === 'moderator' ? 'assignee' : 'host_directed';
        decision.invocationType = directed.source === 'moderator' ? 'moderator_assigned' : 'host_directed';
        decision.turnId = cur.turnId;
        // Directed messages don't consume the main turn queue slot —
        // the named current speaker stays current. The mutated
        // hostDirected list (one entry popped) is what gets persisted.
        return cur;
      }
    }
    throw new NotYourTurnError(message.name, mode);
  };

  const outcomeForDecision = (): { outcome: AppendResult; enriched: Message | null } => {
    const metadata: MessageMetadata = {
      ...(message.metadata ?? {}),
      modeAtSend: mode,
      roleAtSend: decision.roleAtSend,
      invocationType: decision.invocationType,
      ...(decision.turnId !== undefined ? { turnId: decision.turnId } : {}),
    };
    if (decision.skipMessage) {
      return {
        enriched: null,
        outcome: {
          appended: false,
          reason: 'no_addition',
          metadata,
          ...(decision.leadSkipped ? { leadSkipped: decision.leadSkipped } : {}),
        },
      };
    }
    return {
      enriched: { ...message, metadata },
      outcome: {
        appended: true,
        metadata,
        ...(decision.leadSkipped ? { leadSkipped: decision.leadSkipped } : {}),
      },
    };
  };

  if (proof) {
    // A retry after a committed-but-lost response must return the original
    // result before re-evaluating the now-advanced turn state.
    const prior = await existingReceipt(client, proof);
    if (prior) return prior;

    for (let attempt = 0; attempt < 3; attempt++) {
      const expectedTurnRaw = await client.command<string | null>(['GET', turnStateKey(code)]);
      let current: TurnState | null = null;
      if (expectedTurnRaw !== null && expectedTurnRaw !== undefined) {
        try { current = JSON.parse(expectedTurnRaw) as TurnState; }
        catch { throw new Error('Turn state is unreadable; refusing an ambiguous send.'); }
      }
      const next = mutateTurn(current);
      const { outcome, enriched } = outcomeForDecision();
      const committed = await commitTurnWithReceipt(client, code, {
        expectedTurnRaw,
        nextTurnRaw: next ? JSON.stringify(next) : null,
        message: enriched,
        proof,
        outcome,
      });
      if (committed === 'committed') return outcome;
      if (committed !== 'retry') return committed;
    }
    throw new Error('Turn state changed concurrently; retry the send.');
  }

  await casTurnState(client, code, mutateTurn);
  const { outcome, enriched } = outcomeForDecision();
  if (enriched) await rpushMessage(client, code, enriched);
  return outcome;
}

// Internal helper: write a message to the Redis list, refreshing TTL and
// keeping the absolute-count counter in lockstep.
// INCR on the count key MUST sit in the same pipeline as RPUSH so the count
// stays in lock-step with the list — listMessages relies on the invariant
// `totalCount - listLen = number of LTRIMmed entries` to compensate cursors.
async function rpushMessage(client: UpstashClient, code: string, message: Message): Promise<void> {
  // Normalize `text` at the persistence boundary. Agent clients can omit it
  // (attachment-only sends, or a dropped arg), and a stored message with no
  // `text` field crashes every reader that calls .trim() on it.
  const normalized: Message = { ...message, text: message.text ?? '' };
  // T-71: produced-work artifacts persist in their own never-trimmed index.
  // artifactAppendCommands ALWAYS includes the index TTL refresh, so every
  // stored message keeps the index alive as long as the room is.
  const artifactCmds = artifactAppendCommands(code, extractArtifacts([normalized]));
  await client.pipeline([
    ['RPUSH', msgsKey(code), JSON.stringify(normalized)],
    ['INCR', msgCountKey(code)],
    ['LTRIM', msgsKey(code), -MAX_MESSAGES_PER_ROOM, -1],
    ...artifactCmds,
    ['EXPIRE', msgsKey(code), ROOM_TTL_SECONDS],
    ['EXPIRE', msgCountKey(code), ROOM_TTL_SECONDS],
  ]);
}

// T-121: toggle an acknowledge/reject reaction on a stored message.
//
// Semantics:
//   - Same person + same kind again  → the reaction is REMOVED (toggle off).
//   - Same person + the OTHER kind   → their old reaction is replaced; ack and
//     reject are mutually exclusive per person (a message is either accepted
//     or contested by you, never both).
//   - The stored row is rewritten in place with LSET, so history readers and
//     fresh page loads see the authoritative reaction list on the message
//     itself. Cursor-polling clients learn about the change from the sys
//     event row the server appends after calling this.
//
// Concurrency note: find-then-LSET is not atomic. Two simultaneous reactions
// on the SAME message can lose one of the two writes; an LTRIM between the
// read and the write can shift indices. Both windows are milliseconds wide on
// a single-server deployment and the failure mode is a missing chip, not
// corruption — accepted for now rather than pulling in WATCH/EVAL machinery.
export class MessageNotFoundError extends Error {
  constructor(messageId: number) {
    super(`Message ${messageId} was not found in this room (it may have been trimmed from history).`);
    this.name = 'MessageNotFoundError';
  }
}

// Locate a stored message by id. Scans from the tail — reactions and pins
// overwhelmingly land on recent messages. Returns the list index too so
// callers that rewrite the row in place (LSET) know where it lives.
export async function findStoredMessage(
  client: UpstashClient,
  code: string,
  messageId: number,
): Promise<{ index: number; message: Message } | null> {
  const raw = await client.command<string[]>(['LRANGE', msgsKey(code), 0, -1]);
  for (let i = raw.length - 1; i >= 0; i--) {
    const parsed = JSON.parse(raw[i]!) as Message;
    if (parsed.id === messageId) return { index: i, message: parsed };
  }
  return null;
}

export interface ReactionResult {
  /** true = the reaction is now present; false = it was toggled off. */
  added: boolean;
  /** The target message's full post-change reaction list. */
  reactions: MessageReaction[];
  /** Target author + snippet, for composing the human/agent-readable event. */
  target: { id: number; name: string; text: string };
}

export async function applyMessageReaction(
  client: UpstashClient,
  code: string,
  messageId: number,
  reactor: { name: string; client: Message['client'] },
  kind: MessageReactionKind,
): Promise<ReactionResult> {
  const found = await findStoredMessage(client, code, messageId);
  if (!found) throw new MessageNotFoundError(messageId);
  const { index, message } = found;
  if (message.type === 'sys') {
    const err = new Error('Reactions can only be applied to participant messages, not system rows.');
    err.name = 'BadRequestError';
    throw err;
  }
  const prior = Array.isArray(message.reactions) ? message.reactions : [];
  const mine = prior.find(r => r.name === reactor.name && r.client === reactor.client);
  const others = prior.filter(r => !(r.name === reactor.name && r.client === reactor.client));
  const added = !(mine && mine.kind === kind);
  const reactions: MessageReaction[] = added
    ? [...others, { kind, name: reactor.name, client: reactor.client, time: Date.now() }]
    : others;
  const updated: Message = { ...message, reactions };
  await client.pipeline([
    ['LSET', msgsKey(code), index, JSON.stringify(updated)],
    ['EXPIRE', msgsKey(code), ROOM_TTL_SECONDS],
  ]);
  return {
    added,
    reactions,
    target: {
      id: message.id,
      name: message.name,
      text: (message.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    },
  };
}

// Append a server-originated system message. Bypasses the speaker/mute/turn
// gates because system messages are not sent by a participant — they are
// emitted by the server itself in response to events like mode changes,
// turn timeouts, host-driven skips, or moderator fallbacks. Callers should
// set `message.type = 'sys'` and use a synthetic sender (typically
// `name: 'system'`, `client: 'cc'`). The room must still exist; we hit
// getRoom() to refresh TTL and keep the count key aligned with the list.
export async function appendSystemMessage(
  client: UpstashClient,
  code: string,
  message: Message
): Promise<void> {
  await getRoom(client, code); // throws RoomNotFoundError if the room is gone
  await rpushMessage(client, code, message);
}

// Cursor semantics: `fromIndex` is the absolute count of messages the caller
// has already consumed (0 on first call, advanced by `msgs.length` after
// each call). It is NOT a list-index — the on-disk list shifts whenever
// LTRIM trims the head, so a list-index cursor would skip messages past
// MAX_MESSAGES_PER_ROOM. The counter key + LLEN let us reconstruct where the
// caller's next unread message actually lives in the (possibly trimmed) list.
// T-04: `limit` (optional) caps how many messages are returned starting at
// `fromIndex`. Omitted = to the end of the list (the polling path). A bounded
// LRANGE is what lets the web load "the previous page" during upward scroll
// without pulling everything from that point forward.
/**
 * How a requested cursor related to what the room can actually serve.
 *
 * - `exact`   — the cursor was inside the retained window; nothing was skipped.
 * - `trimmed` — the cursor pointed at messages LTRIM has already destroyed. The
 *               surviving prefix is returned and `nextCursor` jumps forward to
 *               the true absolute position. Those older messages are gone.
 * - `ahead`   — the cursor is BEYOND the newest message. Nothing can satisfy it
 *               and nothing ever will: this is a caller that has desynced from
 *               the absolute counter, and it must be told rather than left to
 *               poll an empty result forever.
 */
export type CursorFit = 'exact' | 'trimmed' | 'ahead';

export interface MessagePage {
  messages: Message[];
  /** ABSOLUTE cursor to pass on the next call. Server-computed on purpose —
   *  a caller that derives it as `since + messages.length` gets it wrong the
   *  moment the server clamps `start`, and then re-reads the same window on
   *  every poll while its cursor crawls toward the trim point. */
  nextCursor: number;
  /** Absolute number of messages the room has ever held, or null on a legacy
   *  room that predates the counter. */
  totalCount: number | null;
  fit: CursorFit;
}

/**
 * The cursor-authoritative read. `listMessages` is the thin
 * messages-only wrapper over this.
 *
 * Why this exists (T-52): callers used to advance their own cursor by adding
 * the returned batch length to what they sent. That is only correct when the
 * server served exactly the range asked for. On a long-lived room past the
 * LTRIM cap it does not: a cursor below the trim point gets `start` clamped to
 * 0, so the caller receives the WHOLE retained window, advances by its length,
 * and asks again from a cursor that is still below the trim point. The room
 * replays its entire retained window on every poll — hundreds of messages per
 * call — until the cursor finally crawls past the trim point.
 *
 * The other end of the same defect is worse: a cursor past the newest message
 * returns an empty list indistinguishable from "nobody has spoken", so a
 * listener sits in a healthy-looking loop and never receives anything again.
 */
export async function listMessagesPage(
  client: UpstashClient,
  code: string,
  fromIndex: number,
  limit?: number
): Promise<MessagePage> {
  const meta = await client.pipeline<unknown>([
    ['GET', msgCountKey(code)],
    ['LLEN', msgsKey(code)],
  ]);
  const countRaw = meta[0] as string | number | null;
  const listLen = Number(meta[1] ?? 0);
  const totalCount =
    countRaw === null || countRaw === undefined
      ? null
      : typeof countRaw === 'number' ? countRaw : parseInt(countRaw, 10);

  // Cursor sanitation. Three distinct kinds of nonsense arrive here and they
  // do NOT collapse into one answer:
  //   - negative / NaN / -Infinity: no position at all. Start from the
  //     beginning rather than letting a negative index run backwards.
  //   - +Infinity: unambiguously past the newest message. Collapsing it to 0
  //     would replay the entire room to a caller whose cursor is broken in the
  //     "too far ahead" direction — the opposite of what it needs.
  //   - fractional: floor it; a position is a whole number of messages.
  const requested =
    fromIndex === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY
      : Number.isFinite(fromIndex) && fromIndex > 0 ? Math.floor(fromIndex)
        : 0;

  if (listLen === 0) {
    // An empty room still has an authoritative position: whatever the counter
    // says, or 0. Never echo a cursor we cannot honor.
    const end = totalCount ?? 0;
    return { messages: [], nextCursor: end, totalCount, fit: requested > end ? 'ahead' : 'exact' };
  }

  // Legacy rooms (no counter) have no absolute frame of reference — the list
  // index IS the cursor, exactly as before.
  if (totalCount === null) {
    if (requested >= listLen) return { messages: [], nextCursor: listLen, totalCount: null, fit: requested > listLen ? 'ahead' : 'exact' };
    const end = limit !== undefined && limit > 0 ? Math.min(requested + limit - 1, listLen - 1) : -1;
    const raw = await client.command<string[]>(['LRANGE', msgsKey(code), requested, end]);
    const messages = raw.map(line => JSON.parse(line) as Message);
    return { messages, nextCursor: requested + messages.length, totalCount: null, fit: 'exact' };
  }

  // `trimmed` is how many head entries LTRIM has dropped over this room's
  // lifetime — the absolute index of the OLDEST message still on disk.
  const trimmed = totalCount - listLen;

  if (requested > totalCount) {
    // Past the newest message. Re-anchor to the true end and say so; the
    // caller cannot recover from this by polling, only by being told.
    return { messages: [], nextCursor: totalCount, totalCount, fit: 'ahead' };
  }

  // Below the trim point: serve the surviving prefix, and report the cursor
  // for where that prefix ACTUALLY starts. This is the line that stops the
  // replay — the caller lands past the trim point in one step instead of
  // crawling there one window at a time.
  const fit: CursorFit = requested < trimmed ? 'trimmed' : 'exact';
  const effective = Math.max(requested, trimmed);
  const start = effective - trimmed;
  if (start >= listLen) return { messages: [], nextCursor: totalCount, totalCount, fit };

  const end = limit !== undefined && limit > 0 ? Math.min(start + limit - 1, listLen - 1) : -1;
  const raw = await client.command<string[]>(['LRANGE', msgsKey(code), start, end]);
  const messages = raw.map(line => JSON.parse(line) as Message);
  return { messages, nextCursor: effective + messages.length, totalCount, fit };
}

export async function listMessages(
  client: UpstashClient,
  code: string,
  fromIndex: number,
  limit?: number
): Promise<Message[]> {
  const page = await listMessagesPage(client, code, fromIndex, limit);
  return page.messages;
}
