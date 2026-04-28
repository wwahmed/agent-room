import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';

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

async function installClaudeCode(opts: { hooks: boolean }): Promise<InstallResult> {
  const result: InstallResult = { changes: [], unchanged: [] };

  const mcpPath = join(homedir(), '.claude', '.mcp.json');
  const mcp = (await readJson(mcpPath)) ?? {};
  const servers = ((mcp.mcpServers as Record<string, unknown>) ?? {});
  const before = JSON.stringify(servers['ai-room']);
  servers['ai-room'] = MCP_ENTRY;
  mcp.mcpServers = servers;
  if (JSON.stringify(servers['ai-room']) !== before) {
    await writeJsonAtomic(mcpPath, mcp);
    result.changes.push(`wrote ${mcpPath} (ai-room MCP server)`);
  } else {
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

  console.log('\n--- Cursor / Windsurf / Cline ---');
  console.log('~/.cursor/mcp.json (or equivalent):');
  console.log(mcp);

  console.log('\n--- Codex CLI ---');
  console.log('~/.config/codex/config.toml:');
  console.log('[mcp_servers.ai-room]');
  console.log('command = "npx"');
  console.log('args = ["-y", "ai-room-mcp"]');
  console.log('');
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
    console.log('  2. Cursor');
    console.log('  3. Print configs (paste them yourself)');
    const ans = (await rl.question('\n[1]: ')).trim();
    rl.close();
    target = ans === '2' ? 'cursor' : ans === '3' ? 'print' : 'claude-code';
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

  if (target === 'claude-code' || target === 'claude') {
    const result = await installClaudeCode({ hooks: !noHooks });
    reportResult('Claude Code', result);
    if (noHooks) {
      console.log('  (skipped hooks; pass without --no-hooks for autonomous chat)');
    }
    nextSteps('Claude Code');
    return;
  }

  console.error(`Unknown target: ${target}. Try: claude-code, cursor, print`);
  process.exit(1);
}
