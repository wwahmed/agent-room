// T-37: adopting an agent the summoner did NOT launch.
//
// Every supervision mechanism — the watchdog, the auto-nudge, T-31's terminal
// veto, T-36's working vouch — iterates the summoner's registry. An agent started
// by hand in a tmux pane is therefore invisible to all of it. That is not
// theoretical: WakiDrive's two sessions were resumed as bare panes, the registry
// held zero entries for that room, and when one of them hit a usage limit it sat
// dead for 14 hours with nothing positioned to notice. The host found it, not the
// machinery.
//
// Adoption closes that, but it changes the meaning of an entry, and the dangerous
// part is what a MANAGED entry implies:
//
//   doDismiss unconditionally kills the agent's tmux session.
//
// For a summoned agent that is correct — the summoner started that process and
// owns its lifecycle. For an adopted one it would kill a session someone else
// started, from a UI button labelled "remove from room". A host tidying a
// participant list would have terminated a live release build. So adoption also
// has to teach the lifecycle paths what they do NOT own.

/** Why this adoption request must be refused, or null when it is acceptable.
 *  `isSessionAlive` is injected so the decision stays testable without tmux. */
export function adoptionRejection({ agents, room, name, tmuxSession, isSessionAlive }) {
  const cleanRoom = String(room || '').trim();
  const cleanName = String(name || '').trim();
  const cleanSession = String(tmuxSession || '').trim();
  if (!cleanRoom || !cleanName || !cleanSession) {
    return 'room, name and tmuxSession are all required to adopt an agent.';
  }
  if (!isSessionAlive(cleanSession)) {
    // Adopting a dead session would create a permanent ghost the watchdog
    // reports on forever. Supervision needs something to supervise.
    return `tmux session "${cleanSession}" is not running — nothing to adopt.`;
  }
  const rows = Object.values(agents || {});
  if (rows.some(a => a.status === 'active' && a.tmuxSession === cleanSession)) {
    return `tmux session "${cleanSession}" is already supervised.`;
  }
  if (rows.some(a => a.status === 'active' && a.room === cleanRoom && a.name === cleanName)) {
    // Two active entries sharing (room, name) is the exact shape that made
    // dismissing one yank the other's participant row out from under it.
    return `an active agent named "${cleanName}" is already supervised in ${cleanRoom}.`;
  }
  return null;
}

/**
 * What dismissal is allowed to do to this entry.
 *
 * The summoner may only kill what it started. An adopted session keeps running;
 * dismissal just stops supervising it. Saying so in the response matters — a host
 * who expects "remove" to stop the process should be told plainly that it didn't,
 * rather than discovering it later.
 */
export function dismissPlan(agent) {
  if (agent?.adopted) {
    return {
      killSession: false,
      note: 'Stopped supervising this agent. Its terminal session was NOT started by the summoner, so it is still running — stop it yourself if you meant to.',
    };
  }
  return { killSession: true, note: 'Session stopped.' };
}

/** Why a relaunch is impossible for this entry, or null when it can proceed.
 *  An adopted agent has no launch spec to relaunch FROM: the summoner never knew
 *  the command, model, or flags it was started with, and inventing plausible ones
 *  would replace a working session with a guess. */
export function relaunchRejection(agent) {
  if (agent?.adopted) {
    return 'This agent was adopted, not summoned — the summoner has no launch spec for it, so it cannot be relaunched or have its permission level changed. Restart it yourself in its own terminal.';
  }
  return null;
}
