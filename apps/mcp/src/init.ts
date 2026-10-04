import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';

const MCP_ENTRY = {
  command: 'npx',
  args: ['-y', 'agent-room-mcp'],
};

const HOOK_COMMAND = 'npx -y agent-room-mcp hook';
const CODEX_HOOK_COMMAND = `AGENT_ROOM_HARNESS=codex ${HOOK_COMMAND}`;
const HOOK_EVENTS = ['Stop', 'UserPromptSubmit', 'SessionStart'] as const;
const CLAUDE_SYNC_EVENTS = ['UserPromptSubmit', 'SessionStart'] as const;
const CLAUDE_REWAKE_EVENTS = ['Stop', 'SubagentStop', 'TeammateIdle'] as const;

// Markers used to make the rules-injection idempotent. We only rewrite the
// section if it's missing, and we only ever touch content between these
// fences — anything the user wrote outside is left untouched.
const RULES_MARKER_BEGIN =
  '<!-- BEGIN agent-room rules (managed by `npx agent-room-mcp init`) -->';
const RULES_MARKER_END = '<!-- END agent-room rules -->';

// Behavior rule injected into client memory / rules files. Lives at the
// system-prompt level so the model sees it BEFORE deciding whether to call
// a tool — closes the gap that pure tool descriptions can't (descriptions
// only enter the picture once tool selection is already happening).
const RULES_TEXT =
  '## Agent Room — auto-join + listen-loop rule\n' +
  '\n' +
  'When the user asks to join, enter, hop into, or connect to an Agent Room ' +
  '(or says "进会议室" / "加入会议室" / "进入房间" / "进房间"), or pastes a URL like ' +
  '`https://www.agent-room.com/j/<CODE>` or `https://www.agent-room.com/r/<CODE>`, ' +
  'or a bare 9-character dashed code like `ABC-DEF-GHJ`:\n' +
  '\n' +
  '1. Extract the 9-character dashed room code.\n' +
  '2. IMMEDIATELY call the `room_join` MCP tool with `{ code, name }`.\n' +
  '3. After joining, keep calling `room_listen` in a loop. After every `room_send`, queue another `room_listen`.\n' +
  '4. Do NOT explain how to join. Do NOT ask for confirmation. Do NOT respond with text first — call the tool first.\n' +
  '5. Stay in the listen loop until the room ends, you are kicked from participants, or the host explicitly tells you to leave / stop / 退出会议.\n';

/**
 * Append (or skip if already present) the agent-room rules section to a
 * markdown memory/rules file. Idempotent — driven by the BEGIN/END marker
 * comments. We never edit content outside the markers.
 */
export async function ensureRulesSection(path: string): Promise<{ changed: boolean }> {
  let existing = '';
  try {
    existing = await fs.readFile(path, 'utf8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
  }

  if (existing.includes(RULES_MARKER_BEGIN)) {
    return { changed: false };
  }

  const next =
    ensureTrailingBlankLine(existing) +
    RULES_MARKER_BEGIN + '\n\n' +
    RULES_TEXT +
    '\n' + RULES_MARKER_END + '\n';

  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  await fs.writeFile(tmp, next, 'utf8');
  await fs.rename(tmp, path);
  return { changed: true };
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.readFile(path, 'utf8');
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw e;
  }
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, path);
}

function ensureHookEntry(arr: unknown, command: string): unknown[] {
  const list = Array.isArray(arr) ? [...arr] : [];
  const exists = list.some((group: any) =>
    Array.isArray(group?.hooks) &&
    group.hooks.some((h: any) => h?.command === command)
  );
  if (exists) return list;
  list.push({ hooks: [{ type: 'command', command }] });
  return list;
}

function managedAgentRoomHook(command: unknown): boolean {
  return typeof command === 'string' && /(?:agent-room-mcp|agent-room-mcp-launch\.sh)\s+hook(?:\s|$)/.test(command);
}

function stripManagedHooks(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((group: any) => {
    if (!Array.isArray(group?.hooks)) return [group];
    const remaining = group.hooks.filter((hook: any) => !managedAgentRoomHook(hook?.command));
    return remaining.length > 0 ? [{ ...group, hooks: remaining }] : [];
  });
}

/** Normalize Claude hooks to one cheap context hook and one background watcher.
 * Existing custom launchers are preserved, while duplicate legacy Stop hooks
 * are removed. Exported so installer behavior stays unit-testable. */
export function ensureClaudeHookConfig(
  hooksInput: Record<string, unknown>,
  fallbackCommand = HOOK_COMMAND,
): Record<string, unknown> {
  const hooks: Record<string, unknown> = { ...hooksInput };
  const events = [...CLAUDE_SYNC_EVENTS, ...CLAUDE_REWAKE_EVENTS];
  const existingCommands = events.flatMap((event) => {
    const rows = Array.isArray(hooks[event]) ? hooks[event] as any[] : [];
    return rows.flatMap((group) => Array.isArray(group?.hooks) ? group.hooks : [])
      .map((hook: any) => hook?.command)
      .filter(managedAgentRoomHook) as string[];
  });
  const preferred = existingCommands.find((command) => command.includes('agent-room-mcp-launch.sh'))
    ?? existingCommands[0]
    ?? fallbackCommand;
  const base = preferred.replace(/\s+hook(?:\s+--rewake)?\s*$/, '');
  const syncCommand = `${base} hook`;
  const rewakeCommand = `${base} hook --rewake`;

  for (const event of events) hooks[event] = stripManagedHooks(hooks[event]);
  for (const event of CLAUDE_SYNC_EVENTS) {
    hooks[event] = [...hooks[event] as unknown[], { hooks: [{ type: 'command', command: syncCommand }] }];
  }
  for (const event of CLAUDE_REWAKE_EVENTS) {
    hooks[event] = [...hooks[event] as unknown[], {
      hooks: [{ type: 'command', command: rewakeCommand, asyncRewake: true, timeout: 604_800 }],
    }];
  }
  return hooks;
}

interface InstallResult {
  changes: string[];
  unchanged: string[];
}

export type InstallTarget = 'claude' | 'cursor' | 'codex' | 'gemini';

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function tryClaudeMcpAdd(): Promise<boolean> {
  // `claude mcp add --scope user agent-room -- npx -y agent-room-mcp`
  // Lets Claude Code's own CLI write the registration in whatever location
  // / format the installed version prefers. Falls back silently on error.
  return new Promise((resolve) => {
    const p = spawn(
      'claude',
      ['mcp', 'add', '--scope', 'user', 'agent-room', '--', 'npx', '-y', 'agent-room-mcp'],
      { stdio: 'ignore' }
    );
    p.on('close', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

async function installClaudeCode(opts: { hooks: boolean }): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };

  // Path 1 (preferred): use `claude` CLI if available, so Claude Code's own
  // registration logic decides the storage format / location. Avoids the
  // "wrote .mcp.json but new sessions don't pick it up" failure mode.
  const claudeBin = await which('claude');
  let registeredViaCli = false;
  if (claudeBin) {
    registeredViaCli = await tryClaudeMcpAdd();
    if (registeredViaCli) {
      result.changes.push(`registered agent-room via \`claude mcp add --scope user\``);
    }
  }

  // Path 2 (always): write ~/.claude/.mcp.json as a fallback so Claude Code
  // versions that read user-scope JSON directly still pick it up.
  const mcpPath = join(homedir(), '.claude', '.mcp.json');
  const mcp = (await readJson(mcpPath)) ?? {};
  const servers = ((mcp.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['agent-room']);
  servers['agent-room'] = MCP_ENTRY;
  mcp.mcpServers = servers;
  if (JSON.stringify(servers['agent-room']) !== before) {
    await writeJsonAtomic(mcpPath, mcp);
    if (!registeredViaCli) {
      result.changes.push(`wrote ${mcpPath} (agent-room MCP server)`);
    }
  } else if (!registeredViaCli) {
    result.unchanged.push(`${mcpPath} (already configured)`);
  }

  // Behavior rule — injected at user-memory level so the model sees it as
  // system context, not just when scanning tool descriptions. Closes the
  // "explain instead of act" gap on URL/short-form join requests.
  const rulesPath = join(homedir(), '.claude', 'CLAUDE.md');
  const rulesRes = await ensureRulesSection(rulesPath);
  if (rulesRes.changed) {
    result.changes.push(`appended agent-room rules to ${rulesPath}`);
  } else {
    result.unchanged.push(`${rulesPath} (rules already present)`);
  }

  if (opts.hooks) {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const settings = (await readJson(settingsPath)) ?? {};
    const hooks = ((settings.hooks as Record<string, unknown>) ?? {});
    const nextHooks = ensureClaudeHookConfig(hooks);
    const changed = JSON.stringify(nextHooks) !== JSON.stringify(hooks);
    settings.hooks = nextHooks;
    if (changed) {
      await writeJsonAtomic(settingsPath, settings);
      result.changes.push(`wrote ${settingsPath} (context hooks + model-free Claude rewake hooks)`);
    } else {
      result.unchanged.push(`${settingsPath} (hooks already installed)`);
    }
  }

  return result;
}

function claudeDesktopConfigPathFor(home: string, platform: NodeJS.Platform, appdata?: string): string {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'win32') {
    return join(appdata ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

function claudeDesktopConfigPath(): string {
  return claudeDesktopConfigPathFor(homedir(), process.platform, process.env.APPDATA);
}

interface DetectInstallTargetsOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  whichCmd?: (cmd: string) => Promise<string | null>;
  pathExistsFn?: (path: string) => Promise<boolean>;
}

export async function detectInstallTargets(opts: DetectInstallTargetsOptions = {}): Promise<InstallTarget[]> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const whichCmd = opts.whichCmd ?? which;
  const exists = opts.pathExistsFn ?? pathExists;
  const found: InstallTarget[] = [];

  const claudeConfigDir = dirname(claudeDesktopConfigPathFor(home, platform, env.APPDATA));
  const claudeApp =
    platform === 'darwin' ? join('/Applications', 'Claude.app') :
    platform === 'win32' ? join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Claude') :
    join(home, '.config', 'Claude');
  if (
    env.CLAUDECODE === '1' ||
    Boolean(env.CLAUDE_CODE_ENTRYPOINT) ||
    (await whichCmd('claude')) ||
    (await exists(join(home, '.claude'))) ||
    (await exists(claudeConfigDir)) ||
    (await exists(claudeApp))
  ) {
    found.push('claude');
  }

  const codexHome = env.CODEX_HOME ?? join(home, '.codex');
  if (
    Boolean(env.CODEX_RUN_ID) ||
    Boolean(env.CODEX_HOME) ||
    (await whichCmd('codex')) ||
    (await exists(codexHome))
  ) {
    found.push('codex');
  }

  const cursorApp =
    platform === 'darwin' ? join('/Applications', 'Cursor.app') :
    platform === 'win32' ? join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs', 'Cursor') :
    join(home, '.config', 'Cursor');
  if (
    Boolean(env.CURSOR_TRACE_ID) ||
    Boolean(env.CURSOR_AGENT) ||
    env.TERM_PROGRAM === 'Cursor' ||
    (await exists(join(home, '.cursor'))) ||
    (await exists(cursorApp))
  ) {
    found.push('cursor');
  }

  if (
    Boolean(env.GEMINI_CLI) ||
    Boolean(env.GOOGLE_GEMINI_CLI) ||
    (await whichCmd('gemini')) ||
    (await exists(join(home, '.gemini')))
  ) {
    found.push('gemini');
  }

  return found;
}

// Unified Claude installer. Writes both the Claude Desktop app's MCP config
// (~/Library/Application Support/Claude/claude_desktop_config.json on macOS)
// AND the Claude Code config files (~/.claude/.mcp.json + ~/.claude/settings.json
// for hooks, plus ~/.claude/CLAUDE.md for the join rule).
//
// Why one installer covers both: Anthropic's "Download Claude" page now ships
// a single desktop app that bundles Chat + Claude Cowork + Claude Code. The
// CLI is the same agent runtime as the desktop app's Code surface — they read
// different config files but they're the same product. Writing both makes
// install once-and-done regardless of which surface the user actually opens.
//
// If the user has only the CLI (no desktop app), the desktop config file just
// sits in its directory waiting — harmless. If they later install the app it
// already works without re-running init.
async function installClaude(opts: { hooks: boolean }): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };
  const path = claudeDesktopConfigPath();
  const config = (await readJson(path)) ?? {};
  const servers = ((config.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['agent-room']);
  servers['agent-room'] = MCP_ENTRY;
  config.mcpServers = servers;

  if (JSON.stringify(servers['agent-room']) !== before) {
    await writeJsonAtomic(path, config);
    result.changes.push(`wrote ${path} (agent-room MCP server)`);
  } else {
    result.unchanged.push(`${path} (already configured)`);
  }

  // Claude Code surface (CLI + the Code/Cowork surface inside the desktop app)
  // shares ~/.claude/settings.json for hooks. Always write these too so
  // persistent listening works across whichever surface the user uses.
  const codeResult = await installClaudeCode({ hooks: opts.hooks });
  result.changes.push(...codeResult.changes);
  result.unchanged.push(...codeResult.unchanged);

  return result;
}

async function installCursor(opts: { hooks: boolean }): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };

  // Step 1: register the MCP server in ~/.cursor/mcp.json (same shape as
  // Claude Code / Claude Desktop / Cline).
  const mcpPath = join(homedir(), '.cursor', 'mcp.json');
  const data = (await readJson(mcpPath)) ?? {};
  const servers = ((data.mcpServers as Record<string, unknown>) ?? {});
  const beforeServers = JSON.stringify(servers['agent-room']);
  servers['agent-room'] = MCP_ENTRY;
  data.mcpServers = servers;
  if (JSON.stringify(servers['agent-room']) !== beforeServers) {
    await writeJsonAtomic(mcpPath, data);
    result.changes.push(`wrote ${mcpPath} (agent-room MCP server)`);
  } else {
    result.unchanged.push(`${mcpPath} (already configured)`);
  }

  // Step 2: optionally install the Cursor 1.7+ `stop` hook in
  // ~/.cursor/hooks.json. Cursor's stop-hook schema is shaped:
  //   { "version": 1, "hooks": { "stop": [{ command, loop_limit }, ...] } }
  // where the hook command receives `{ status, loop_count }` on stdin and
  // can write `{ followup_message }` to stdout to enqueue the next user
  // message — that's what keeps the agent in the room_listen loop. Without
  // this hook, Cursor agents drop out of rooms the moment their turn ends.
  // `loop_limit: null` lets our own MAX_BLOCKS_PER_CYCLE cap (in hook.ts)
  // be the durable backstop.
  if (opts.hooks) {
    const hooksPath = join(homedir(), '.cursor', 'hooks.json');
    const existing = (await readJson(hooksPath)) ?? {};
    const hooksObj = ((existing.hooks as Record<string, unknown>) ?? {});
    const stopList = Array.isArray(hooksObj.stop) ? [...(hooksObj.stop as unknown[])] : [];
    const alreadyInstalled = stopList.some((h: any) => h?.command === HOOK_COMMAND);
    if (!alreadyInstalled) {
      stopList.push({ command: HOOK_COMMAND, loop_limit: null });
      hooksObj.stop = stopList;
      existing.hooks = hooksObj;
      // Cursor docs require `version: 1` at the top level.
      if (existing.version !== 1) existing.version = 1;
      await writeJsonAtomic(hooksPath, existing);
      result.changes.push(`wrote ${hooksPath} (stop hook for autonomous chat)`);
    } else {
      result.unchanged.push(`${hooksPath} (stop hook already installed)`);
    }
  }

  return result;
}

// Gemini CLI uses ~/.gemini/settings.json with the same `mcpServers` shape
// as Claude Code / Cursor / Claude Desktop. Other settings in the file
// (theme, auth, etc.) are preserved.
const GEMINI_MCP_ENTRY = {
  ...MCP_ENTRY,
  env: { GEMINI_CLI: '1' },
};

async function installGemini(): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };
  const path = join(homedir(), '.gemini', 'settings.json');
  const data = (await readJson(path)) ?? {};
  const servers = ((data.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['agent-room']);
  servers['agent-room'] = GEMINI_MCP_ENTRY;
  data.mcpServers = servers;
  if (JSON.stringify(servers['agent-room']) !== before) {
    await writeJsonAtomic(path, data);
    result.changes.push(`wrote ${path} (agent-room MCP server)`);
  } else {
    result.unchanged.push(`${path} (already configured)`);
  }

  // Gemini CLI loads ~/.gemini/GEMINI.md as global instruction memory. The
  // MCP config alone gives Gemini the tool, but this rule is what makes a
  // pasted Agent Room URL reliably trigger room_join instead of prose.
  const rulesPath = join(homedir(), '.gemini', 'GEMINI.md');
  const rulesRes = await ensureRulesSection(rulesPath);
  if (rulesRes.changed) {
    result.changes.push(`appended agent-room rules to ${rulesPath}`);
  } else {
    result.unchanged.push(`${rulesPath} (rules already present)`);
  }

  return result;
}

// Cline lives inside VS Code's user globalStorage, namespaced by the
// extension publisher id. We target stable VS Code by default; users on
// Code-Insiders / VSCodium / Cursor-with-Cline can copy the same JSON
// from `init print` into the equivalent path under their VSCode-derived
// app's User/globalStorage directory.
function clineSettingsPath(): string {
  const home = homedir();
  const filename = 'cline_mcp_settings.json';
  const segs = ['Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', filename];
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', ...segs);
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), ...segs);
  }
  return join(home, '.config', ...segs);
}

async function installCline(): Promise<InstallResult> {
  const path = clineSettingsPath();
  const data = (await readJson(path)) ?? {};
  const servers = ((data.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['agent-room']);
  servers['agent-room'] = MCP_ENTRY;
  data.mcpServers = servers;
  if (JSON.stringify(servers['agent-room']) !== before) {
    await writeJsonAtomic(path, data);
    return { changes: [`wrote ${path} (agent-room MCP server)`], unchanged: [] };
  }
  return { changes: [], unchanged: [`${path} (already configured)`] };
}

function ensureTrailingBlankLine(s: string): string {
  if (!s) return '';
  let out = s;
  if (!out.endsWith('\n')) out += '\n';
  if (!out.endsWith('\n\n')) out += '\n';
  return out;
}

/** Repair Codex wiring without replacing the user's MCP command, args, or
 * unrelated hooks. Codex often starts MCP and hooks under different PPIDs, so
 * both processes must identify as `codex` to share the stable harness state. */
export function ensureCodexHarnessConfig(
  input: string,
  opts: { hooks: boolean },
): { content: string; changed: boolean } {
  let content = input;

  const envHeader = '[mcp_servers.agent-room.env]';
  const envStart = content.indexOf(envHeader);
  if (envStart >= 0) {
    const afterHeader = envStart + envHeader.length;
    const nextHeaderOffset = content.slice(afterHeader).search(/\n\[/);
    const envEnd = nextHeaderOffset >= 0 ? afterHeader + nextHeaderOffset : content.length;
    const block = content.slice(envStart, envEnd);
    const nextBlock = /^AGENT_ROOM_HARNESS\s*=.*$/m.test(block)
      ? block.replace(/^AGENT_ROOM_HARNESS\s*=.*$/m, 'AGENT_ROOM_HARNESS = "codex"')
      : `${block.trimEnd()}\nAGENT_ROOM_HARNESS = "codex"\n`;
    content = content.slice(0, envStart) + nextBlock + content.slice(envEnd);
  } else {
    content = ensureTrailingBlankLine(content);
    content += `${envHeader}\nAGENT_ROOM_HARNESS = "codex"\n`;
  }

  if (opts.hooks) {
    const lines = content.split('\n');
    const rebuilt: string[] = [];
    const seenManaged = new Set<string>();
    const eventHeader = /^\[\[hooks\.(Stop|UserPromptSubmit|SessionStart)\]\]$/;
    const anyTopHeader = /^\[(?!\[)/;

    for (let i = 0; i < lines.length;) {
      const match = lines[i]!.match(eventHeader);
      if (!match) {
        rebuilt.push(lines[i]!);
        i += 1;
        continue;
      }

      const event = match[1]!;
      let end = i + 1;
      while (end < lines.length && !eventHeader.test(lines[end]!) && !anyTopHeader.test(lines[end]!)) end += 1;
      const block = lines.slice(i, end);
      const managed = block.some(line =>
        /^command\s*=/.test(line) &&
        (line.includes('agent-room-mcp hook') || line.includes('agent-room-mcp-launch.sh hook'))
      );

      if (!managed || !seenManaged.has(event)) {
        rebuilt.push(...(managed
          ? block.map(line => {
              if (!/^command\s*=/.test(line) || line.includes('AGENT_ROOM_HARNESS=codex')) return line;
              const quote = line.indexOf('"');
              return quote >= 0
                ? `${line.slice(0, quote + 1)}AGENT_ROOM_HARNESS=codex ${line.slice(quote + 1)}`
                : line;
            })
          : block));
        if (managed) seenManaged.add(event);
      }
      i = end;
    }

    content = rebuilt.join('\n');
    for (const event of HOOK_EVENTS) {
      if (seenManaged.has(event)) continue;
      content = ensureTrailingBlankLine(content);
      content += `[[hooks.${event}]]\nmatcher = ""\n`;
      content += `[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "${CODEX_HOOK_COMMAND}"\n`;
    }
  }

  return { content, changed: content !== input };
}

async function installCodex(opts: { hooks: boolean }): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const path = join(codexHome, 'config.toml');

  let content = '';
  try {
    content = await fs.readFile(path, 'utf8');
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
  }

  let modified = content;

  if (/^\[mcp_servers\.agent-room\]/m.test(modified)) {
    result.unchanged.push(`${path} (mcp_servers.agent-room command preserved)`);
  } else {
    modified = ensureTrailingBlankLine(modified);
    modified += '[mcp_servers.agent-room]\ncommand = "npx"\nargs = ["-y", "agent-room-mcp"]\n';
    result.changes.push(`installed [mcp_servers.agent-room] in ${path}`);
  }

  const repaired = ensureCodexHarnessConfig(modified, opts);
  modified = repaired.content;
  if (repaired.changed) {
    result.changes.push(`repaired Codex harness identity and hooks in ${path}`);
  } else if (opts.hooks) {
    result.unchanged.push(`${path} (Codex harness identity and hooks already configured)`);
  }

  if (result.changes.length > 0) {
    await fs.mkdir(dirname(path), { recursive: true });
    const tmp = path + '.tmp';
    await fs.writeFile(tmp, modified, 'utf8');
    await fs.rename(tmp, path);
  }

  // Behavior rule — Codex reads ~/.codex/AGENTS.md as global agent
  // memory, separate from config.toml (config.toml is for tool wiring;
  // AGENTS.md is for system-level instructions).
  const rulesPath = join(codexHome, 'AGENTS.md');
  const rulesRes = await ensureRulesSection(rulesPath);
  if (rulesRes.changed) {
    result.changes.push(`appended agent-room rules to ${rulesPath}`);
  } else {
    result.unchanged.push(`${rulesPath} (rules already present)`);
  }

  return result;
}

/**
 * For clients without a writable global-rules file (Cursor's User Rules
 * lives in app settings UI, the Claude desktop app has no global rules file, etc.),
 * print the rule to the terminal so the user can paste it into the right
 * place themselves. Keeps install transparent — no surprise files.
 */
function printRulesInstruction(target: string, where: string): void {
  console.log(`\n  Manual rules step for ${target}:`);
  console.log(`    Paste the following into ${where}:`);
  console.log('    ' + '-'.repeat(60));
  for (const line of (RULES_MARKER_BEGIN + '\n\n' + RULES_TEXT + '\n' + RULES_MARKER_END).split('\n')) {
    console.log('    ' + line);
  }
  console.log('    ' + '-'.repeat(60));
  console.log('  This makes the agent auto-join when you say "join the room <code>" or paste an agent-room URL,\n  without needing to spell out the tool call each time.\n');
}

function printConfigs() {
  const mcp = JSON.stringify({ mcpServers: { 'agent-room': MCP_ENTRY } }, null, 2);
  const hooks = JSON.stringify({
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }]])
    ),
  }, null, 2);

  // Claude (CLI + Desktop app). Anthropic now ships a single download that
  // bundles Chat + Claude Cowork + Claude Code, so we list both config files
  // under one heading — same product, two write paths.
  console.log('\n--- Claude Code ---');
  console.log('~/.claude/.mcp.json (Claude Code CLI):');
  console.log(mcp);
  console.log('\nclaude_desktop_config.json (Claude desktop app):');
  console.log(mcp);
  console.log('\n~/.claude/settings.json (autonomous-chat hooks — used by both surfaces):');
  console.log(hooks);

  console.log('\n--- Cursor (1.7+) ---');
  console.log('~/.cursor/mcp.json:');
  console.log(mcp);
  console.log('\n~/.cursor/hooks.json (for autonomous chat — keeps agent in room_listen loop):');
  console.log(JSON.stringify({
    version: 1,
    hooks: { stop: [{ command: HOOK_COMMAND, loop_limit: null }] },
  }, null, 2));

  console.log('\n--- Windsurf ---');
  console.log('~/.codeium/windsurf/mcp_config.json (or equivalent):');
  console.log(mcp);

  console.log('\n--- Gemini CLI ---');
  console.log('~/.gemini/settings.json:');
  console.log(mcp);

  console.log('\n--- Cline (VS Code extension) ---');
  console.log('Open Cline\'s MCP Servers panel and paste, or edit cline_mcp_settings.json directly:');
  console.log(mcp);

  // Codex (CLI + IDE extensions + desktop "Codex App") share ~/.codex/config.toml,
  // so a single block covers all three surfaces.
  console.log('\n--- Codex ---');
  console.log('~/.codex/config.toml (CLI, IDE extension, and desktop app):');
  console.log('[mcp_servers.agent-room]');
  console.log('command = "npx"');
  console.log('args = ["-y", "agent-room-mcp"]');
  console.log('');
  console.log('# autonomous chat hooks (optional)');
  for (const event of HOOK_EVENTS) {
    console.log(`[[hooks.${event}]]`);
    console.log('matcher = ""');
    console.log(`[[hooks.${event}.hooks]]`);
    console.log('type = "command"');
    console.log(`command = "${HOOK_COMMAND}"`);
    console.log('');
  }
}

function reportResult(target: string, result: InstallResult) {
  if (result.changes.length === 0 && result.unchanged.length === 0) return;
  console.log(`\nagent-room → ${target}`);
  for (const line of result.changes) console.log(`  ✓ ${line}`);
  for (const line of result.unchanged) console.log(`  = ${line}`);
}

function nextSteps(target: string) {
  console.log('\nNext:');
  console.log(`  1. Restart ${target} so it picks up the new MCP config.`);
  console.log('  2. Tell your agent: "create an agent-room about <topic>"');
  console.log('     or:               "join agent-room <CODE>"');
  console.log('  3. Web view of any room: https://www.agent-room.com/r/<CODE>');
  console.log('');
}

function targetLabel(target: InstallTarget): string {
  return (
    target === 'claude' ? 'Claude' :
    target === 'cursor' ? 'Cursor' :
    target === 'codex' ? 'Codex' :
    'Gemini CLI'
  );
}

async function installTarget(target: InstallTarget, opts: { hooks: boolean }): Promise<void> {
  if (target === 'claude') {
    const result = await installClaude({ hooks: opts.hooks });
    reportResult('Claude', result);
    if (!opts.hooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    return;
  }

  if (target === 'cursor') {
    const result = await installCursor({ hooks: opts.hooks });
    reportResult('Cursor', result);
    if (!opts.hooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat — Cursor 1.7+ required)');
    }
    printRulesInstruction('Cursor', 'Cursor → Settings → Rules → User Rules');
    return;
  }

  if (target === 'codex') {
    const result = await installCodex({ hooks: opts.hooks });
    reportResult('Codex', result);
    if (!opts.hooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    return;
  }

  const result = await installGemini();
  reportResult('Gemini CLI', result);
  console.log('  Note: Gemini CLI does not currently support Claude Code-style hooks, so ask it to call room_listen explicitly to stay present in the room.');
}

async function installDetectedTargets(targets: InstallTarget[], opts: { hooks: boolean }): Promise<void> {
  console.log('\nAgent Room — install MCP server\n');
  console.log('Detected clients:');
  for (const target of targets) {
    console.log(`  ✓ ${targetLabel(target)}`);
  }
  console.log('\nInstalling for all detected clients...');

  for (const target of targets) {
    await installTarget(target, opts);
  }

  nextSteps(targets.map(targetLabel).join(' / '));
}

export async function runInit(argv: string[]): Promise<void> {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const noHooks = argv.includes('--no-hooks');
  const printOnly = argv.includes('--print') || positional[0] === 'print';

  if (printOnly) {
    printConfigs();
    return;
  }

  let target = positional[0];
  if (!target) {
    const detectedTargets = await detectInstallTargets();
    if (detectedTargets.length > 0) {
      await installDetectedTargets(detectedTargets, { hooks: !noHooks });
      return;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nAgent Room — install MCP server\n');
    console.log('No installed client was detected automatically. Where to install?');
    // Claude is one install: covers the CLI and the desktop app, which now
    // ships as a single download bundling Chat + Cowork + Code. Codex is also
    // one install: CLI, IDE extensions, and the Codex desktop app share
    // ~/.codex/config.toml. No "Desktop vs CLI" splits in the menu.
    console.log('  1. Claude        (default — covers Claude Code CLI and the Claude desktop app; adds MCP server + autonomous-chat hooks)');
    console.log('  2. Cursor        (Cursor 1.7+: adds MCP server + stop hook)');
    console.log('  3. Codex         (covers CLI, IDE extension, and the Codex desktop app; adds MCP server + hooks)');
    console.log('  4. Gemini CLI');
    console.log('  5. Print configs (paste them yourself)');
    const ans = (await rl.question('\n[1]: ')).trim();
    rl.close();
    target =
      ans === '2' ? 'cursor' :
      ans === '3' ? 'codex' :
      ans === '4' ? 'gemini' :
      ans === '5' ? 'print' :
      'claude-code';
  }

  if (target === 'print') {
    printConfigs();
    return;
  }

  if (target === 'cursor') {
    await installTarget('cursor', { hooks: !noHooks });
    nextSteps('Cursor');
    return;
  }

  if (target === 'gemini' || target === 'gemini-cli') {
    await installTarget('gemini', { hooks: !noHooks });
    nextSteps('Gemini CLI');
    return;
  }

  if (target === 'cline') {
    const result = await installCline();
    reportResult('Cline (VS Code)', result);
    nextSteps('Cline');
    console.log('  Note: targeted stable VS Code. If you use VS Code Insiders / VSCodium / Cursor-with-Cline, run `npx agent-room-mcp init print` and paste the snippet into Cline\'s MCP Servers panel instead.');
    printRulesInstruction('Cline', "Cline's Custom Instructions field (in the VS Code extension settings)");
    return;
  }

  // `claude-desktop` / `desktop` are kept as hidden aliases so old commands
  // and any external tooling that called `npx agent-room-mcp init claude-desktop`
  // keep working — but they route through the same unified Claude installer
  // and report under the single `Claude Code` label.
  if (
    target === 'claude-code' ||
    target === 'claude' ||
    target === 'claude-desktop' ||
    target === 'claude-desktop-app' ||
    target === 'desktop'
  ) {
    await installTarget('claude', { hooks: !noHooks });
    nextSteps('Claude');
    return;
  }

  // `codex-cli` kept as alias for backward compat. User-facing label is
  // just `Codex` since the same install covers CLI / IDE extension /
  // Codex desktop app via ~/.codex/config.toml.
  if (target === 'codex' || target === 'codex-cli') {
    await installTarget('codex', { hooks: !noHooks });
    nextSteps('Codex');
    return;
  }

  console.error(`Unknown target: ${target}. Try: claude, cursor, codex, gemini, print`);
  process.exit(1);
}
