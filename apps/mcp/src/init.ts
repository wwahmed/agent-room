import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';

const MCP_ENTRY = {
  command: 'npx',
  args: ['-y', 'ai-room-mcp'],
};

const HOOK_COMMAND = 'npx -y ai-room-mcp hook';
const HOOK_EVENTS = ['Stop', 'UserPromptSubmit', 'SessionStart'] as const;

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
  // `claude mcp add --scope user ai-room -- npx -y ai-room-mcp`
  // Lets Claude Code's own CLI write the registration in whatever location
  // / format the installed version prefers. Falls back silently on error.
  return new Promise((resolve) => {
    const p = spawn(
      'claude',
      ['mcp', 'add', '--scope', 'user', 'ai-room', '--', 'npx', '-y', 'ai-room-mcp'],
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
      result.changes.push(`registered ai-room via \`claude mcp add --scope user\``);
    }
  }

  // Path 2 (always): write ~/.claude/.mcp.json as a fallback so Claude Code
  // versions that read user-scope JSON directly still pick it up.
  const mcpPath = join(homedir(), '.claude', '.mcp.json');
  const mcp = (await readJson(mcpPath)) ?? {};
  const servers = ((mcp.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['ai-room']);
  servers['ai-room'] = MCP_ENTRY;
  mcp.mcpServers = servers;
  if (JSON.stringify(servers['ai-room']) !== before) {
    await writeJsonAtomic(mcpPath, mcp);
    if (!registeredViaCli) {
      result.changes.push(`wrote ${mcpPath} (ai-room MCP server)`);
    }
  } else if (!registeredViaCli) {
    result.unchanged.push(`${mcpPath} (already configured)`);
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

async function installClaudeDesktop(): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };
  const path = claudeDesktopConfigPath();
  const config = (await readJson(path)) ?? {};
  const servers = ((config.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['ai-room']);
  servers['ai-room'] = MCP_ENTRY;
  config.mcpServers = servers;

  if (JSON.stringify(servers['ai-room']) !== before) {
    await writeJsonAtomic(path, config);
    result.changes.push(`wrote ${path} (ai-room MCP server)`);
  } else {
    result.unchanged.push(`${path} (already configured)`);
  }

  return result;
}

async function installCursor(): Promise<InstallResult> {
  const path = join(homedir(), '.cursor', 'mcp.json');
  const data = (await readJson(path)) ?? {};
  const servers = ((data.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['ai-room']);
  servers['ai-room'] = MCP_ENTRY;
  data.mcpServers = servers;
  if (JSON.stringify(servers['ai-room']) !== before) {
    await writeJsonAtomic(path, data);
    return { changes: [`wrote ${path} (ai-room MCP server)`], unchanged: [] };
  }
  return { changes: [], unchanged: [`${path} (already configured)`] };
}

// Gemini CLI uses ~/.gemini/settings.json with the same `mcpServers` shape
// as Claude Code / Cursor / Claude Desktop. Other settings in the file
// (theme, auth, etc.) are preserved.
async function installGemini(): Promise<InstallResult> {
  const path = join(homedir(), '.gemini', 'settings.json');
  const data = (await readJson(path)) ?? {};
  const servers = ((data.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['ai-room']);
  servers['ai-room'] = MCP_ENTRY;
  data.mcpServers = servers;
  if (JSON.stringify(servers['ai-room']) !== before) {
    await writeJsonAtomic(path, data);
    return { changes: [`wrote ${path} (ai-room MCP server)`], unchanged: [] };
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

  if (/^\[mcp_servers\.ai-room\]/m.test(modified)) {
    result.unchanged.push(`${path} (mcp_servers.ai-room already present)`);
  } else {
    modified = ensureTrailingBlankLine(modified);
    modified += '[mcp_servers.ai-room]\ncommand = "npx"\nargs = ["-y", "ai-room-mcp"]\n';
    result.changes.push(`installed [mcp_servers.ai-room] in ${path}`);
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

  return result;
}

function printConfigs() {
  const mcp = JSON.stringify({ mcpServers: { 'ai-room': MCP_ENTRY } }, null, 2);
  const hooks = JSON.stringify({
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((e) => [e, [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }]])
    ),
  }, null, 2);

  console.log('\n--- Claude Code ---');
  console.log('~/.claude/.mcp.json:');
  console.log(mcp);
  console.log('\n~/.claude/settings.json (for autonomous chat):');
  console.log(hooks);

  console.log('\n--- Claude Desktop ---');
  console.log('claude_desktop_config.json:');
  console.log(mcp);
  console.log('\nNote: Claude Desktop supports MCP tools, but not Claude Code hooks. Use room_listen for live room messages.');

  console.log('\n--- Cursor / Windsurf / Cline ---');
  console.log('~/.cursor/mcp.json (or equivalent):');
  console.log(mcp);

  console.log('\n--- Gemini CLI ---');
  console.log('~/.gemini/settings.json:');
  console.log(mcp);

  console.log('\n--- Codex CLI ---');
  console.log('~/.codex/config.toml:');
  console.log('[mcp_servers.ai-room]');
  console.log('command = "npx"');
  console.log('args = ["-y", "ai-room-mcp"]');
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
  console.log(`\nai-room → ${target}`);
  for (const line of result.changes) console.log(`  ✓ ${line}`);
  for (const line of result.unchanged) console.log(`  = ${line}`);
}

function nextSteps(target: string) {
  console.log('\nNext:');
  console.log(`  1. Restart ${target} so it picks up the new MCP config.`);
  console.log('  2. Tell your agent: "create an ai-room about <topic>"');
  console.log('     or:               "join ai-room <CODE>"');
  console.log('  3. Web view of any room: https://agentroom.vercel.app/r/<CODE>');
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
    console.log('\nAI Room — install MCP server\n');
    console.log('Where to install?');
    console.log('  1. Claude Code   (default — adds MCP server + autonomous-chat hooks)');
    console.log('  2. Claude Desktop (MCP server only — use room_listen for live chat)');
    console.log('  3. Cursor');
    console.log('  4. Codex CLI     (adds MCP server + hooks)');
    console.log('  5. Gemini CLI');
    console.log('  6. Print configs (paste them yourself)');
    const ans = (await rl.question('\n[1]: ')).trim();
    rl.close();
    target =
      ans === '2' ? 'claude-desktop' :
      ans === '3' ? 'cursor' :
      ans === '4' ? 'codex' :
      ans === '5' ? 'gemini' :
      ans === '6' ? 'print' :
      'claude-code';
  }

  if (target === 'print') {
    printConfigs();
    return;
  }

  if (target === 'cursor') {
    const result = await installCursor();
    reportResult('Cursor', result);
    nextSteps('Cursor');
    return;
  }

  if (target === 'gemini' || target === 'gemini-cli') {
    const result = await installGemini();
    reportResult('Gemini CLI', result);
    nextSteps('Gemini CLI');
    console.log('  Note: Gemini CLI does not currently support Claude Code-style hooks, so ask it to call room_listen explicitly to stay present in the room.');
    return;
  }

  if (target === 'claude-desktop' || target === 'claude-desktop-app' || target === 'desktop') {
    const result = await installClaudeDesktop();
    reportResult('Claude Desktop', result);
    nextSteps('Claude Desktop');
    console.log('  Note: Claude Desktop does not run hooks, so ask it to call room_listen to see live room messages.');
    return;
  }

  if (target === 'codex') {
    const result = await installCodex({ hooks: !noHooks });
    reportResult('Codex CLI', result);
    if (noHooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    nextSteps('Codex CLI');
    return;
  }

  if (target === 'claude-code' || target === 'claude') {
    const result = await installClaudeCode({ hooks: !noHooks });
    reportResult('Claude Code', result);
    if (noHooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    nextSteps('Claude Code');
    return;
  }

  console.error(`Unknown target: ${target}. Try: claude-code, claude-desktop, cursor, codex, gemini, print`);
  process.exit(1);
}
