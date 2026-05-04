// Detect which agent harness is running this MCP process. Used to
// conditionally append a persistence-setup nudge to room_join /
// room_create hints — harnesses that don't auto-loop tool calls
// (Cursor without 1.7+ stop hooks, Claude Desktop, Gemini CLI, etc.)
// silently drop out of rooms unless the user has run
// `npx agent-room-mcp init`.

export type ClientKind =
  | 'claude-code'
  | 'cursor'
  | 'codex'
  | 'gemini-cli'
  | 'claude-desktop'
  | 'cline'
  | 'windsurf'
  | 'unknown';

export interface HarnessInfo {
  kind: ClientKind;
  /** True when the harness is known NOT to auto-loop tool calls and
   *  therefore needs the agent-room-mcp stop hook installed for
   *  persistent listening. Conservative default for unknown clients
   *  is `true` — better to over-nudge than have an agent silently
   *  drop out of every room. */
  needsPersistenceSetup: boolean;
  /** Human-readable harness label to splice into hints. */
  label: string;
}

const KNOWN_STRONG_LOOP: HarnessInfo[] = [
  { kind: 'claude-code', needsPersistenceSetup: false, label: 'Claude Code' },
  { kind: 'codex', needsPersistenceSetup: false, label: 'Codex CLI' },
];

export function detectHarness(env: NodeJS.ProcessEnv = process.env): HarnessInfo {
  // Order matters: most specific signals first. Each branch keys off a
  // single env var the host harness is documented to set. Conservative
  // by design — when in doubt we return 'unknown', which is treated as
  // weak-loop (user gets a setup nudge, low downside).

  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT) {
    return KNOWN_STRONG_LOOP[0]!;
  }
  if (env.CODEX_RUN_ID || (env.CODEX_HOME && !env.CLAUDECODE)) {
    return KNOWN_STRONG_LOOP[1]!;
  }
  if (env.CURSOR_TRACE_ID || env.CURSOR_AGENT || env.TERM_PROGRAM === 'Cursor') {
    return { kind: 'cursor', needsPersistenceSetup: true, label: 'Cursor' };
  }
  if (env.GEMINI_CLI || env.GOOGLE_GEMINI_CLI) {
    return { kind: 'gemini-cli', needsPersistenceSetup: true, label: 'Gemini CLI' };
  }
  if (env.CLAUDE_DESKTOP_VERSION || env.__CFBundleIdentifier === 'com.anthropic.claudefordesktop') {
    return { kind: 'claude-desktop', needsPersistenceSetup: true, label: 'Claude Desktop' };
  }
  if (env.CLINE_VERSION) {
    return { kind: 'cline', needsPersistenceSetup: true, label: 'Cline' };
  }
  if (env.WINDSURF_VERSION || env.TERM_PROGRAM === 'Windsurf') {
    return { kind: 'windsurf', needsPersistenceSetup: true, label: 'Windsurf' };
  }
  return { kind: 'unknown', needsPersistenceSetup: true, label: 'this client' };
}

/**
 * Build the persistence-setup nudge appended to room_join / room_create hints
 * for harnesses that don't auto-loop. Returns empty string for strong-loop
 * harnesses (Claude Code, Codex CLI) so we don't add noise where it isn't
 * needed.
 */
export function persistenceSetupHint(info: HarnessInfo): string {
  if (!info.needsPersistenceSetup) return '';
  return (
    ` PERSISTENCE NOTE (${info.label}): if you cannot keep room_listen ` +
    `chained between turns, exit and run \`npx agent-room-mcp init\` ` +
    `(without --no-hooks) to install the stop hook, then rejoin. ` +
    `Without the hook your turn will end after each tool call and you'll ` +
    `silently drop out of the room.`
  );
}
