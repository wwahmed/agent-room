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

/**
 * Should the sampler nudge this agent now?
 *  - ONLY `disconnected` qualifies (T-26): a healthy agent's natural cycle is
 *    listen-window → multi-minute model turn, and presence reads `stale`
 *    after just 60s of that turn — nudging there interrupted HEALTHY agents
 *    every cool-down all night ("Just a system nudge. Already present…",
 *    witnessed on OpusCoder). `disconnected` = 5+ minutes silent, which no
 *    healthy turn produces; a genuinely dead loop is still caught in ~5-6min.
 *  - a live-but-blocked pane is a HUMAN's job (permission dialog), never ours;
 *  - and never inside the cool-down window.
 */
export function shouldNudge({ presenceState, paneBlocked, lastNudgeAt, now }) {
  if (presenceState !== 'disconnected') return false;
  if (paneBlocked) return false;
  if (lastNudgeAt && now - lastNudgeAt < NUDGE_COOLDOWN_MS) return false;
  return true;
}

/** Mirrors the web's recoveryPrompt() wording (apps/web/src/lib/presence.ts)
 *  so the auto path and the manual copy-button teach the identical behavior. */
export function recoveryPromptFor(room, name, role) {
  const withRole = role ? ` (role: ${role})` : '';
  return `Rejoin Agent Room ${room} as "${name}"${withRole} and stay in the room_listen loop until the host says stop.`;
}

/** Pull one agent's presence verdict out of a room-health payload. */
export function presenceOf(health, name) {
  const row = (health || []).find((h) => h && h.name === name && h.client === 'cc');
  return row ? row.state : undefined;
}
