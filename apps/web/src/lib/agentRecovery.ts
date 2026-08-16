// Human-facing translation of agent lifecycle state.
//
// presence.ts is the SERVER CONTRACT: `listening`, `stale`, `disconnected`,
// listen windows, client-build stamps. That vocabulary is correct and it stays
// exactly where it is. But it leaked all the way to the surface, and the host
// reading the People pane had to know what a listen loop was to understand why
// an agent had gone quiet. This module is the seam: protocol words in, plain
// words and a ranked set of actions out.
//
// It also fixes a claim the UI used to make. The old copy said the app "can't
// restart a CLI process, but you can" and handed over a prompt to paste into a
// terminal. That was true when the only agents around were ones a human had
// started by hand. It stopped being true once the summoner started launching
// harnesses itself: it holds the launch spec and re-runs it on demand. For a
// summoner-managed agent the honest answer is now "the app brings it back";
// the terminal path is the fallback for the sessions we genuinely did not
// start, not the headline instruction for everybody.

import type { ParticipantHealth, PresenceState } from './presence.js';

/** The subset of the summoner record the recovery decision actually depends on. */
export interface RevivableAgent {
  agentId: string;
  /** Permission level the agent is already running at. Revive re-uses it: a
   *  bring-back must never quietly hand an agent more (or less) access than it
   *  had, which is what picking a default here would do. */
  accessLevel?: string;
  mode?: string;
  status?: string;
  /** Attached to a session a human started, so no launch spec exists for it. */
  adopted?: boolean;
}

/** Why the app cannot bring a given agent back by itself. */
export type BlockedReason = 'no-record' | 'adopted';

export type ReviveCapability =
  | { ok: true; agentId: string; mode: string }
  | { ok: false; reason: BlockedReason };

/**
 * Can the APP revive this agent, or does it need a human at a terminal?
 *
 * Two honest no's, and they are different sentences to the user:
 *  - `no-record`: the agent joined with an invite code. Its process belongs to
 *    whoever started it and we have no idea how to start another one.
 *  - `adopted`: the summoner attached to a session that already existed. It can
 *    watch it and it can stop it, but it never had the launch spec, so it
 *    cannot recreate it. The summoner rejects relaunch for these on its own
 *    (adoption.mjs); asking first means the user sees a reason instead of a
 *    button that fails.
 */
export function reviveCapability(agent: RevivableAgent | null | undefined): ReviveCapability {
  if (!agent) return { ok: false, reason: 'no-record' };
  if (agent.adopted) return { ok: false, reason: 'adopted' };
  const mode = agent.accessLevel || agent.mode;
  // No recorded level means no spec worth re-running either.
  if (!mode) return { ok: false, reason: 'no-record' };
  return { ok: true, agentId: agent.agentId, mode };
}

/** Plain-language status, for people who never want to learn the protocol. */
export interface AgentStatusView {
  state: PresenceState;
  /** One or two words, safe to put in a chip next to a name. */
  label: string;
  /** One sentence. Says what is true and what it means, never a state name. */
  detail: string;
  /** Does this state warrant offering recovery at all? */
  needsAttention: boolean;
}

const PLAIN_LABEL: Record<PresenceState, string> = {
  listening: 'Ready',
  online: 'Here',
  working: 'Working',
  stale: 'Quiet',
  disconnected: 'Stopped',
};

/**
 * Deliberately NOT a rename of presenceView(). That function explains the
 * mechanism ("not in a listen window", "no heartbeat — loop may be dead")
 * because the Inspector and the protocol surfaces need it. This one explains
 * the consequence, which is all the People pane ever needed.
 *
 * `stale` is the one that most needs re-wording. It is not a fault: an agent
 * heads-down in a long turn reads stale after a minute of silence, and telling
 * the host "loop may be dead" about a perfectly healthy agent is what made the
 * pane feel alarming. Say "probably busy" and rank waiting above acting.
 */
export function agentStatusView(health: ParticipantHealth): AgentStatusView {
  const agent = health.client === 'cc';
  const state = health.state;
  let detail: string;
  switch (state) {
    case 'listening':
      detail = 'Waiting for the next message.';
      break;
    case 'online':
      detail = agent ? 'Recently active, not waiting on the room right now.' : 'Recently active.';
      break;
    case 'working':
      detail = health.workingBy === 'terminal'
        ? 'Busy on a task — its terminal shows work in progress.'
        : 'Busy on a task and said so.';
      break;
    case 'stale':
      detail = 'Silent for a few minutes. Usually means a long task, not a problem.';
      break;
    case 'disconnected':
    default:
      detail = agent
        ? 'Its session has stopped, so it will not see new messages.'
        : 'Gone from the room.';
      break;
  }
  return {
    state,
    label: PLAIN_LABEL[state],
    detail,
    // Only a CLI agent can be recovered, and only these two states mean
    // anything is wrong. Mirrors canRecover() in presence.ts on purpose: one
    // definition of "worth acting on", two vocabularies for saying it.
    needsAttention: agent && (state === 'stale' || state === 'disconnected'),
  };
}

export type StepId = 'wait' | 'bring-back' | 'manual' | 'remove';

export interface RecoveryStep {
  id: StepId;
  title: string;
  detail: string;
  /** True when the app performs it and the human just confirms. */
  automatic: boolean;
  /** Where it sits in a progressive surface: one primary call to action,
   *  the rest folded away until asked for. */
  emphasis: 'primary' | 'secondary' | 'advanced' | 'destructive';
}

export interface LadderInput {
  health: ParticipantHealth | null | undefined;
  agent: RevivableAgent | null | undefined;
  /** An ended room recovers nothing — the seat itself is gone. */
  ended?: boolean;
  /** Host-only verbs are not offered to someone who cannot run them. */
  isHost?: boolean;
}

export interface RecoveryLadder {
  /** False when there is nothing wrong; render nothing at all. */
  needed: boolean;
  /** Ordered gentlest-first. The first entry is the one to lead with. */
  steps: RecoveryStep[];
  /** Set when the app cannot do it itself, so the copy can say why once
   *  instead of repeating the caveat on every step. */
  blocked?: BlockedReason;
}

/**
 * The whole point of the redesign: order the options from "do nothing" to
 * "give up on it", and let the surface show the first one loudly and the rest
 * on request.
 *
 * Waiting genuinely IS the right first move for a quiet agent, and it used to
 * be the one option the UI never offered — every path led to copying a prompt,
 * which interrupts an agent that was only thinking. A stopped agent skips
 * straight to bring-back, because there is nothing left to wait for.
 */
export function recoveryLadder({ health, agent, ended = false, isHost = false }: LadderInput): RecoveryLadder {
  if (!health || ended) return { needed: false, steps: [] };
  const view = agentStatusView(health);
  if (!view.needsAttention) return { needed: false, steps: [] };

  const capability = reviveCapability(agent);
  const steps: RecoveryStep[] = [];

  if (health.state === 'stale') {
    steps.push({
      id: 'wait',
      title: 'Give it a minute',
      detail: 'A long task looks exactly like this. Bringing it back now would interrupt real work.',
      automatic: false,
      emphasis: 'primary',
    });
  }

  if (capability.ok) {
    steps.push({
      id: 'bring-back',
      title: 'Bring it back',
      detail: 'Starts the agent again with the same settings and rejoins it to this room. Takes a few seconds.',
      automatic: true,
      // Leading action for a stopped agent; second to waiting for a quiet one.
      emphasis: health.state === 'stale' ? 'secondary' : 'primary',
    });
  }

  steps.push({
    id: 'manual',
    title: capability.ok ? 'Wake it yourself instead' : 'Restart it yourself',
    detail: capability.ok
      ? 'Copy a message to paste into the agent\'s own terminal, if you would rather not restart it.'
      : capability.reason === 'adopted'
        ? 'This agent was already running when the app attached to it, so the app has no way to start another one. Restart it in the terminal it came from.'
        : 'This agent joined with an invite code, so its process belongs to whoever started it. Restart it there.',
    automatic: false,
    // Demoted to advanced precisely when the app can do the job itself.
    emphasis: capability.ok ? 'advanced' : 'primary',
  });

  if (isHost) {
    steps.push({
      id: 'remove',
      title: 'Remove from the room',
      detail: 'Frees its place in People. Use this when it is not coming back.',
      automatic: false,
      emphasis: 'destructive',
    });
  }

  return { needed: true, steps, ...(capability.ok ? {} : { blocked: capability.reason }) };
}
