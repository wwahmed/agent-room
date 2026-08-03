// What a newly summoned agent is allowed to do, before the owner touches
// anything.
//
// The summon sheet used to open on `chat` — room-only, no file access — so
// every agent summoned to actually build something had to be re-permissioned,
// and then interrupted the owner with a harness permission dialog for each
// step it tried to take. The host's call: default to maximum permissions so
// agents stop prompting, and make the default a setting.
//
// This is a deliberate trade. `build` is full autonomy in the chosen
// workspace — the agent edits files and runs commands without asking — so the
// blast radius of a summon is the workspace you point it at. It is the right
// default for this product (a single owner summoning agents onto his own
// machine to ship work) and the wrong one to assume silently, which is why the
// setting exists, the sheet always shows the current level before you confirm,
// and the choice is stated in plain language rather than a permission code.

export type AgentMode = 'chat' | 'edit' | 'build';

export const AGENT_MODES: AgentMode[] = ['chat', 'edit', 'build'];

/** Maximum permissions — edits files AND runs commands without prompting. */
export const MAX_AGENT_MODE: AgentMode = 'build';

const KEY = 'wakichat:summon:default-mode';

export function isAgentMode(value: unknown): value is AgentMode {
  return value === 'chat' || value === 'edit' || value === 'build';
}

/**
 * The level a fresh summon starts at. Defaults to maximum: an unset
 * preference, unreadable storage, or a stored value from a future version all
 * land on `build` rather than silently downgrading the owner to the old
 * chat-only behaviour he asked us to stop doing.
 */
export function defaultAgentMode(): AgentMode {
  try {
    const raw = localStorage.getItem(KEY);
    return isAgentMode(raw) ? raw : MAX_AGENT_MODE;
  } catch {
    return MAX_AGENT_MODE; // private mode / storage disabled
  }
}

/** Persist the preference. Invalid values are ignored rather than stored — a
 *  junk mode would otherwise read back as "maximum" on every future summon
 *  without the owner having chosen it. */
export function setDefaultAgentMode(mode: AgentMode): void {
  if (!isAgentMode(mode)) return;
  try {
    localStorage.setItem(KEY, mode);
    // Same-tab listeners (the summon sheet may already be mounted) do not get
    // a storage event; announce it so a sheet opened later is never stale.
    try { window.dispatchEvent(new CustomEvent('wakichat:agent-mode', { detail: { mode } })); } catch { /* non-browser */ }
  } catch { /* storage unavailable — the default simply won't persist */ }
}

/** Plain-language description of what each level permits. One source of
 *  truth, so the summon sheet and settings can never describe them differently. */
export const AGENT_MODE_COPY: Record<AgentMode, { title: string; short: string; detail: string }> = {
  chat: {
    title: 'Chat',
    short: 'Room only',
    detail: 'Discusses and advises in the room. No file access.',
  },
  edit: {
    title: 'Edit',
    short: 'Edit files',
    detail: 'Can create and modify files in the workspace (auto-accepted). No shell commands.',
  },
  build: {
    title: 'Build',
    short: 'Edit + run cmds',
    detail: 'Full autonomy in the workspace — edits files and runs commands (git, tests, builds) without prompting. Fewest interruptions, widest blast radius.',
  },
};
