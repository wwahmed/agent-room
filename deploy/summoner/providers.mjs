// providers.mjs — provider catalog, per-turn model invocation, and the
// "reach this agent directly" instructions shown in the app.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// launchd's PATH is minimal; make sure the agent CLIs + node + tmux resolve.
const EXTRA_PATH = [
  '/Users/wahmed/.local/bin',                                   // claude, codex
  '/Users/wahmed/.local/share/mise/installs/node/22.22.2/bin',  // copilot, node
  '/opt/homebrew/bin',                                          // tmux, gh
  '/usr/bin', '/bin', '/usr/sbin', '/sbin',
];
export const AUG_PATH = [...new Set([...(process.env.PATH || '').split(':'), ...EXTRA_PATH])]
  .filter(Boolean).join(':');

function which(bin) {
  try {
    return execFileSync('/usr/bin/which', [bin], {
      env: { ...process.env, PATH: AUG_PATH }, encoding: 'utf8',
    }).trim();
  } catch { return ''; }
}

// Provider catalog. Model ids can drift per account/org, so each provider
// exposes suggested presets + allows a custom id from the UI. Copilot defaults
// to the latest GPT per Waqas's standing rule.
export function catalog() {
  return [
    {
      id: 'claude',
      label: 'Claude (Anthropic)',
      cli: 'claude',
      available: Boolean(which('claude')),
      defaultModel: 'sonnet',
      models: [
        { id: 'sonnet', label: 'Sonnet 5 — balanced (default)' },
        { id: 'opus', label: 'Opus 4.8 — most capable' },
        { id: 'haiku', label: 'Haiku 4.5 — fast / cheap' },
      ],
      allowCustomModel: true,
    },
    {
      id: 'copilot',
      label: 'GitHub Copilot (corporate seat)',
      cli: 'copilot',
      available: Boolean(which('copilot')),
      defaultModel: 'gpt-5.5',
      note: 'Corporate lane — always latest GPT (gpt-5.6 not enabled on this seat).',
      models: [
        { id: 'gpt-5.5', label: 'GPT-5.5 — latest available (default)' },
        { id: 'gpt-5.4', label: 'GPT-5.4' },
        { id: 'gpt-5.1', label: 'GPT-5.1' },
      ],
      allowCustomModel: true,
    },
    {
      id: 'codex',
      label: 'Codex (OpenAI)',
      cli: 'codex',
      available: Boolean(which('codex')),
      defaultModel: '',
      note: 'Uses your Codex account default model unless overridden.',
      models: [
        { id: '', label: 'Account default (recommended)' },
        { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
        { id: 'gpt-5.5-sol', label: 'gpt-5.5-sol' },
      ],
      allowCustomModel: true,
    },
  ];
}

export function providerById(id) {
  return catalog().find((p) => p.id === id) || null;
}

// Build the argv for a single non-interactive model turn.
// mode: 'chat' (respond only, no workspace writes) | 'build' (full tools).
// NOTE: turns are stateless (no --session-id). With --session-id, Claude Code
// loads full session/CLAUDE.md context and reliably answers "(no reply)"; the
// room transcript is the shared memory instead. Continuity is a future add.
function buildArgv({ provider, model, workspace, mode, outFile }) {
  const build = mode === 'build';
  if (provider === 'claude') {
    const a = ['-p', '--model', model, '--output-format', 'text', '--strict-mcp-config'];
    if (build) a.push('--dangerously-skip-permissions', '--add-dir', workspace);
    return { cmd: 'claude', args: a, promptVia: 'arg' };
  }
  if (provider === 'copilot') {
    const a = ['--model', model, '-s', '--no-color', '-C', workspace];
    if (build) a.push('--allow-all-tools');
    return { cmd: 'copilot', args: a, promptVia: 'prompt-flag' };
  }
  if (provider === 'codex') {
    // Empty model => use the account's configured default (ids vary per account).
    const a = ['exec', '--skip-git-repo-check', '-C', workspace,
      '--sandbox', build ? 'workspace-write' : 'read-only'];
    if (model) a.push('-m', model);
    if (outFile) a.push('-o', outFile); // clean final message, avoids parsing the preamble
    return { cmd: 'codex', args: a, promptVia: 'arg' };
  }
  throw new Error(`unknown provider ${provider}`);
}

// Run one model turn. Returns { text, code }.
export function invokeModel({ provider, model, workspace, mode, prompt, timeoutMs = 180000 }) {
  const outFile = provider === 'codex' ? join(tmpdir(), `codex-${randomUUID()}.txt`) : '';
  const spec = buildArgv({ provider, model, workspace, mode, outFile });
  const args = [...spec.args];
  if (spec.promptVia === 'prompt-flag') args.unshift('-p', prompt);
  else if (spec.promptVia === 'arg') args.push(prompt);
  const usesStdin = spec.promptVia === 'stdin';

  return new Promise((resolve) => {
    let out = '', err = '';
    const child = spawn(spec.cmd, args, {
      cwd: workspace,
      env: { ...process.env, PATH: AUG_PATH },
      stdio: [usesStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(killer); resolve({ text: '', code: -1, err: String(e) }); });
    child.on('close', (code) => {
      clearTimeout(killer);
      let text = '';
      if (outFile) {
        try { text = readFileSync(outFile, 'utf8').trim(); } catch {}
        try { unlinkSync(outFile); } catch {}
      }
      if (!text) text = cleanOutput(provider, out);
      // Surface a codex/copilot API/usage error as the err channel for logging.
      const apiErr = /usage limit|not supported|invalid_request|error/i.test(err + out) && !text
        ? (err + out).replace(/\s+/g, ' ').slice(0, 200) : err;
      resolve({ text, code, err: apiErr });
    });
    if (usesStdin) { try { child.stdin.write(prompt); child.stdin.end(); } catch {} }
  });
}

// Codex exec is chatty (reasoning preamble); keep the final assistant text.
function cleanOutput(provider, raw) {
  let t = (raw || '').replace(/\[[0-9;]*m/g, '').trim(); // strip ANSI
  if (provider === 'codex') {
    // codex exec prints a header then the final message; take the tail after the
    // last "codex" / separator line if present, else the whole thing.
    const lines = t.split('\n');
    // drop obvious metadata lines
    const filtered = lines.filter((l) => !/^\s*(workdir:|model:|provider:|approval:|sandbox:|reasoning|tokens used|session id:)/i.test(l));
    t = filtered.join('\n').trim();
  }
  return t;
}

// Instructions the app shows so Waqas can reach the agent directly.
export function accessInstructions({ provider, model, workspace, tmuxSession, tmuxTmpdir }) {
  const cli = provider === 'claude' ? 'claude' : provider === 'copilot' ? 'copilot' : 'codex';
  const tmuxPrefix = tmuxTmpdir ? `TMUX_TMPDIR=${tmuxTmpdir} ` : '';
  return [
    `Watch the live agent loop:  ${tmuxPrefix}tmux attach -t ${tmuxSession}   (detach: Ctrl-b then d)`,
    `Chat directly in its workspace:  cd ${workspace} && ${cli}`,
    `Provider / model:  ${provider} / ${model || 'account-default'}`,
    `Workspace:  ${workspace}`,
  ];
}
