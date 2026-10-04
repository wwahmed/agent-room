// T-12: auto-nudge — pure decision + prompt logic for resurrecting summoned
// agents whose listen loop died. The presence chain so far: T-04 makes a busy
// agent look calm, T-06 heals split-brain inside a live loop — but an agent
// that "final-answered its way out of the room" never calls anything again,
// so the last leg has to come from OUTSIDE the loop: the summoner types the
// recovery prompt into the agent's own tmux pane. This module stays pure so
// the sampler's judgement is unit-testable without tmux or a server.

/** Re-nudge no more often than this per agent. A nudge takes effect within
 *  one model turn or not at all; hammering a wedged harness helps nobody. */
export const NUDGE_COOLDOWN_MS = 10 * 60_000;

/** T-31: how long a visibly-working pane may hold off a nudge.
 *
 *  The veto below trusts the terminal over presence, which is right — but it
 *  must not be trusted FOREVER. A harness killed mid-turn can leave its
 *  in-flight marker frozen on screen, and an uncapped veto would then suppress
 *  the nudge for exactly the agent that needs it. After this long, presence
 *  wins and the nudge fires: worst case the agent gets one redundant prompt,
 *  which is the failure we can afford. Sized well above a long model turn and well below a whole night. */
export const PANE_ACTIVITY_VETO_CAP_MS = 30 * 60_000;

/**
 * Should the sampler nudge this agent now?
 *  - ONLY `disconnected` qualifies (T-26): a healthy agent's natural cycle is
 *    listen-window → multi-minute model turn, and presence reads `stale`
 *    after just 60s of that turn — nudging there interrupted HEALTHY agents
 *    every cool-down all night ("Just a system nudge. Already present…",
 *    witnessed on OpusCoder). `disconnected` = 5+ minutes silent, which no
 *    healthy turn produces; a genuinely dead loop is still caught in ~5-6min.
 *  - a live-but-blocked pane is a HUMAN's job (permission dialog), never ours;
 *  - T-31: a terminal showing a turn IN FLIGHT is proof the harness is alive,
 *    and that proof outranks presence. T-26 cut the false alarms that
 *    fired at 60s, but a genuinely heads-down agent that doesn't ping still
 *    crosses 5 minutes and gets interrupted — witnessed live on OpusCoder,
 *    which was streaming a build into its pane when the summoner typed a
 *    recovery prompt on top of it. Presence infers life from room traffic; the
 *    terminal SHOWS it. Same shape as T-18, where a live process vetoes the
 *    "row is stale" claim. Capped by PANE_ACTIVITY_VETO_CAP_MS so a harness that
 *    leaves its in-flight marker on a frozen frame can't disable the mechanism.
 *  - and never inside the cool-down window.
 */
export function shouldNudge({ presenceState, paneBlocked, paneActive, vetoSinceAt, lastNudgeAt, now }) {
  if (presenceState !== 'disconnected') return false;
  if (paneBlocked) return false;
  if (paneActive && !(vetoSinceAt && now - vetoSinceAt >= PANE_ACTIVITY_VETO_CAP_MS)) return false;
  if (lastNudgeAt && now - lastNudgeAt < NUDGE_COOLDOWN_MS) return false;
  return true;
}

/** Mirrors the web's recoveryPrompt() wording (apps/web/src/lib/presence.ts)
 *  so the auto path and the manual copy-button teach the identical behavior. */
export function recoveryPromptFor(room, name, role) {
  const withRole = role ? ` (role: ${role})` : '';
  return `Rejoin Agent Room ${room} as "${name}"${withRole} and stay in the room_listen loop until the host says stop. During long work, send a room_status ping every few minutes so the room can tell you are busy instead of dead.`;
}

/** Pull one agent's presence verdict out of a room-health payload. */
export function presenceOf(health, name) {
  const row = (health || []).find((h) => h && h.name === name && h.client === 'cc');
  // Prefer the model-free watcher over injecting another model turn. If the
  // watcher dies, its short lease expires and the ordinary disconnected
  // fallback becomes eligible again automatically.
  if (row && Number(row.wakeRemainingMs) > 0) return 'wake-ready';
  return row ? row.state : undefined;
}
