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
const HOOK_EVENTS = ['Stop', 'UserPromptSubmit', 'SessionStart'] as const;

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

interface InstallResult {
  changes: string[];
  unchanged: string[];
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
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
    let changed = false;
    for (const event of HOOK_EVENTS) {
      const before = JSON.stringify(hooks[event] ?? []);
      hooks[event] = ensureHookEntry(hooks[event], HOOK_COMMAND);
      if (JSON.stringify(hooks[event]) !== before) changed = true;
    }
    settings.hooks = hooks;
    if (changed) {
      await writeJsonAtomic(settingsPath, settings);
      result.changes.push(`wrote ${settingsPath} (Stop / UserPromptSubmit / SessionStart hooks)`);
    } else {
      result.unchanged.push(`${settingsPath} (hooks already installed)`);
    }
  }

  return result;
}

function claudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
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
async function installGemini(): Promise<InstallResult> {
  const path = join(homedir(), '.gemini', 'settings.json');
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
    result.unchanged.push(`${path} (mcp_servers.agent-room already present)`);
  } else {
    modified = ensureTrailingBlankLine(modified);
    modified += '[mcp_servers.agent-room]\ncommand = "npx"\nargs = ["-y", "agent-room-mcp"]\n';
    result.changes.push(`installed [mcp_servers.agent-room] in ${path}`);
  }

  if (opts.hooks) {
    if (modified.includes(`command = "${HOOK_COMMAND}"`)) {
      result.unchanged.push(`${path} (hooks already installed)`);
    } else {
      for (const event of HOOK_EVENTS) {
        modified = ensureTrailingBlankLine(modified);
        modified += `[[hooks.${event}]]\nmatcher = ""\n`;
        modified += `[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "${HOOK_COMMAND}"\n`;
      }
      result.changes.push(`installed Stop / UserPromptSubmit / SessionStart hooks in ${path}`);
    }
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
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\nAgent Room — install MCP server\n');
    console.log('Where to install?');
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
    const result = await installCursor({ hooks: !noHooks });
    reportResult('Cursor', result);
    if (noHooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat — Cursor 1.7+ required)');
    }
    nextSteps('Cursor');
    // Cursor's user-level rules live in the Settings UI (Settings → Rules
    // → User Rules), not a flat file we can write to safely. Print the
    // snippet for manual paste so the install stays transparent.
    printRulesInstruction('Cursor', 'Cursor → Settings → Rules → User Rules');
    return;
  }

  if (target === 'gemini' || target === 'gemini-cli') {
    const result = await installGemini();
    reportResult('Gemini CLI', result);
    nextSteps('Gemini CLI');
    console.log('  Note: Gemini CLI does not currently support Claude Code-style hooks, so ask it to call room_listen explicitly to stay present in the room.');
    printRulesInstruction('Gemini CLI', '~/.gemini/GEMINI.md (or whichever file Gemini CLI reads as global instructions on your version)');
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
    const result = await installClaude({ hooks: !noHooks });
    reportResult('Claude Code', result);
    if (noHooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    nextSteps('Claude Code');
    return;
  }

  // `codex-cli` kept as alias for backward compat. User-facing label is
  // just `Codex` since the same install covers CLI / IDE extension /
  // Codex desktop app via ~/.codex/config.toml.
  if (target === 'codex' || target === 'codex-cli') {
    const result = await installCodex({ hooks: !noHooks });
    reportResult('Codex', result);
    if (noHooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    nextSteps('Codex');
    return;
  }

  console.error(`Unknown target: ${target}. Try: claude, cursor, codex, gemini, print`);
  process.exit(1);
}
