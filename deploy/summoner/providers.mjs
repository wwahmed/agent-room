// providers.mjs — provider catalog, per-turn model invocation, and the
// "reach this agent directly" instructions shown in the app.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Summoned agents talk to OUR fork's MCP, not the stale published npx package.
// The upstream package client-side rejects the server's current word-codes
// (cafe-ham-clog) as "malformed"; our fork passes codes verbatim AND stamps the
// join metadata (model/account/…). Falls back to npx only if the local build is
// missing. The MCP's API base is pointed at the local server (where the rooms
// live) via AGENT_ROOM_BASE_URL, matching the headless path's ROOM_BASE.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_MCP = join(HERE, '..', '..', 'apps', 'mcp', 'dist', 'index.js');
const ROOM_BASE = process.env.ROOM_BASE || 'http://127.0.0.1:8210';
export function agentRoomMcpServer() {
  return existsSync(LOCAL_MCP)
    ? { command: 'node', args: [LOCAL_MCP], env: { AGENT_ROOM_BASE_URL: ROOM_BASE } }
    : { command: 'npx', args: ['-y', 'agent-room-mcp'], env: { AGENT_ROOM_BASE_URL: ROOM_BASE } };
}

// launchd's PATH is minimal; make sure the agent CLIs + node + tmux resolve.
const EXTRA_PATH = [
  '/Users/wahmed/.local/bin',                                   // claude, codex
  '/Users/wahmed/.local/share/mise/installs/node/22.22.2/bin',  // copilot, node
  '/opt/homebrew/bin',                                          // tmux, gh
  '/usr/bin', '/bin', '/usr/sbin', '/sbin',
];
export const AUG_PATH = [...new Set([...(process.env.PATH || '').split(':'), ...EXTRA_PATH])]
  .filter(Boolean).join(':');

// Summoned Claude agents authenticate from a DEDICATED config dir, isolated
// from the human's personal `claude` CLI (~/.claude). Log this one into the
// CORPORATE account once and agents run on corporate compute forever, while the
// personal CLI is never touched. Matches the model-compute-governance lane split.
export const AGENT_CLAUDE_DIR = join(homedir(), '.agent-room', 'claude-agents');
export const AGENT_CLAUDE_LOGIN_CMD = `CLAUDE_CONFIG_DIR=${AGENT_CLAUDE_DIR} claude auth login`;

// Claude "lanes" = separate config dirs, each its own account/login. Explicit,
// email-labeled providers so you always know which account an agent runs on;
// add more lanes here to accommodate more accounts. '' = the default ~/.claude.
export const CLAUDE_LANES = [
  { id: 'claude-personal', dir: '' },
  { id: 'claude-corporate', dir: AGENT_CLAUDE_DIR },
];

export function claudeConfigDir(providerId) {
  const lane = CLAUDE_LANES.find((l) => l.id === providerId);
  return lane ? lane.dir : '';
}

// Account (email + loggedIn) for a given Claude config dir. '' = default.
export function claudeAccountFor(dir) {
  try {
    const env = { ...process.env, PATH: AUG_PATH };
    if (dir) env.CLAUDE_CONFIG_DIR = dir;
    const out = execFileSync('claude', ['auth', 'status'], { env, encoding: 'utf8', timeout: 10000 });
    const j = JSON.parse(out);
    return { loggedIn: Boolean(j.loggedIn), email: j.email || '' };
  } catch { return { loggedIn: false, email: '' }; }
}

function which(bin) {
  try {
    return execFileSync('/usr/bin/which', [bin], {
      env: { ...process.env, PATH: AUG_PATH }, encoding: 'utf8',
    }).trim();
  } catch { return ''; }
}

// Codex has no model-list command; the account's real default lives in
// ~/.codex/config.toml (`model = "…"`). Read it so the dropdown isn't stale.
function codexDefaultModel() {
  try {
    const toml = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    const m = toml.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m ? m[1] : '';
  } catch { return ''; }
}

// Live Claude model list from `claude models` (so Fable 5 / Opus / Sonnet 5
// always appear as they ship — no hardcoded staleness). Returns null on failure
// so the caller can fall back.
function claudeModelsLive() {
  try {
    const out = execFileSync('claude', ['models'], {
      env: { ...process.env, PATH: AUG_PATH }, encoding: 'utf8', timeout: 15000,
    });
    const rows = [...out.matchAll(/\|\s*\*\*(.+?)\*\*([^|]*)\|\s*`([^`]+)`/g)];
    const models = rows.map((m) => {
      const name = m[1].trim();
      const desc = (m[2] || '').replace(/^[\s—-]+/, '').trim();
      return { id: m[3].trim(), label: desc ? `${name} — ${desc}` : name };
    });
    return models.length ? models : null;
  } catch { return null; }
}

// Provider catalog. Model ids can drift per account/org, so each provider
// exposes suggested presets + allows a custom id from the UI. Copilot defaults
// to the latest GPT per Waqas's standing rule.
let _catalogCache = null;
let _catalogAt = 0;

export function catalog(force = false) {
  const now = Date.now();
  // Serve the cached catalog instantly; refresh on demand (or after 5 min).
  if (!force && _catalogCache && now - _catalogAt < 300000) return _catalogCache;

  const claudeAvailable = Boolean(which('claude'));
  const claudeLive = claudeAvailable ? claudeModelsLive() : null;
  const claudeModels = claudeLive || [
    // Fallback only if `claude models` can't be read.
    { id: 'claude-fable-5', label: 'Fable 5 — most capable' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8 — default' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fast / cheap' },
  ];
  const claudeDefault = (claudeModels.find((m) => /opus/i.test(m.id)) || claudeModels[0]).id;

  // ONE provider per Claude account lane, labeled by the signed-in EMAIL — so
  // you always pick the account explicitly. Add lanes in CLAUDE_LANES for more.
  const claudeProviders = claudeAvailable ? CLAUDE_LANES.map((lane) => {
    const acct = claudeAccountFor(lane.dir);
    const loginCmd = lane.dir ? `CLAUDE_CONFIG_DIR=${lane.dir} claude auth login` : 'claude auth login';
    return {
      id: lane.id,
      label: acct.loggedIn ? `Claude (${acct.email})` : `Claude — sign in (${lane.dir ? 'new account lane' : 'default'})`,
      cli: 'claude',
      available: true,
      defaultModel: claudeDefault,
      note: acct.loggedIn ? `Runs on ${acct.email}${lane.dir ? '' : ' — default ~/.claude'}.` : 'This account lane is not signed in — see setupCmd.',
      account: acct,
      accountReady: acct.loggedIn,
      setupCmd: acct.loggedIn ? undefined : loginCmd,
      models: claudeModels,
      allowCustomModel: true,
    };
  }) : [];

  const result = [
    ...claudeProviders,
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
    (() => {
      const codexDefault = codexDefaultModel();
      const models = [{ id: '', label: `Account default${codexDefault ? ` (${codexDefault})` : ''}` }];
      if (codexDefault) models.push({ id: codexDefault, label: codexDefault });
      return {
        id: 'codex',
        label: 'Codex (OpenAI)',
        cli: 'codex',
        available: Boolean(which('codex')),
        defaultModel: '',
        note: codexDefault ? `Account default: ${codexDefault} (from ~/.codex/config.toml). CLI has no model-list.` : 'CLI exposes no model list — type a model id if needed.',
        models,
        allowCustomModel: true,
      };
    })(),
  ];
  _catalogCache = result;
  _catalogAt = now;
  return result;
}

export function providerById(id) {
  return catalog().find((p) => p.id === id) || null;
}

// Build the argv for a single non-interactive model turn.
// mode: 'chat' (respond only, no workspace writes) | 'build' (full tools).
// NOTE: turns are stateless (no --session-id). With --session-id, Claude Code
// loads full session/CLAUDE.md context and reliably answers "(no reply)"; the
// room transcript is the shared memory instead. Continuity is a future add.
function buildArgv({ provider, model, workspace, mode, outFile, persistent, sessionId, resume }) {
  const build = mode === 'build';
  const persist = persistent && sessionId;
  if (provider.startsWith('claude')) {
    // NOTE: --add-dir is VARIADIC (<directories...>), so it must be followed by
    // another flag — never placed right before the positional prompt, or it
    // swallows the prompt and Claude errors "input must be provided". Keep it
    // early, ahead of the boolean/value flags.
    const a = ['-p'];
    if (build) a.push('--add-dir', workspace, '--dangerously-skip-permissions');
    a.push('--model', model, '--output-format', 'text', '--strict-mcp-config');
    if (persist) {
      // --setting-sources project keeps the global ~/.claude/CLAUDE.md (the
      // Agent-Room auto-join rules) from hijacking the summoned agent, while the
      // session id makes it durable + resumable (`claude --resume <id>`).
      a.push('--setting-sources', 'project', resume ? '--resume' : '--session-id', sessionId);
    }
    return { cmd: 'claude', args: a, promptVia: 'arg' };
  }
  if (provider === 'copilot') {
    const a = ['--model', model, '-s', '--no-color', '-C', workspace];
    if (build) a.push('--allow-all-tools');
    // Copilot's --session-id resumes an existing session or sets the UUID for a
    // new one, so the same id each turn continues the same durable session.
    if (persist) a.push('--session-id', sessionId);
    return { cmd: 'copilot', args: a, promptVia: 'prompt-flag' };
  }
  if (provider === 'codex') {
    // Empty model => use the account's configured default (ids vary per account).
    // Codex has no fixed --session-id; it persists in its own session store, so
    // attach with `codex resume` (picker). resume --last continues the newest.
    const a = ['exec', '--skip-git-repo-check', '-C', workspace,
      '--sandbox', build ? 'workspace-write' : 'read-only'];
    if (model) a.push('-m', model);
    if (outFile) a.push('-o', outFile); // clean final message, avoids parsing the preamble
    return { cmd: 'codex', args: a, promptVia: 'arg' };
  }
  throw new Error(`unknown provider ${provider}`);
}

// Run one model turn. Returns { text, code }.
export function invokeModel({ provider, model, workspace, mode, prompt, persistent, sessionId, resume, timeoutMs = 180000 }) {
  const outFile = provider === 'codex' ? join(tmpdir(), `codex-${randomUUID()}.txt`) : '';
  const spec = buildArgv({ provider, model, workspace, mode, outFile, persistent, sessionId, resume });
  const args = [...spec.args];
  if (spec.promptVia === 'prompt-flag') args.unshift('-p', prompt);
  else if (spec.promptVia === 'arg') args.push(prompt);
  const usesStdin = spec.promptVia === 'stdin';

  return new Promise((resolve) => {
    let out = '', err = '';
    const child = spawn(spec.cmd, args, {
      cwd: workspace,
      env: {
        ...process.env, PATH: AUG_PATH,
        // Each Claude account lane authenticates from its own config dir
        // (corporate lane => isolated dir; personal => default ~/.claude).
        ...(provider.startsWith('claude') && claudeConfigDir(provider)
          ? { CLAUDE_CONFIG_DIR: claudeConfigDir(provider) } : {}),
      },
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
export function accessInstructions({ provider, model, workspace, tmuxSession, tmuxTmpdir, persistent, sessionId }) {
  const cli = provider.startsWith('claude') ? 'claude' : provider === 'copilot' ? 'copilot' : 'codex';
  const tmuxPrefix = tmuxTmpdir ? `TMUX_TMPDIR=${tmuxTmpdir} ` : '';
  const cdir = provider.startsWith('claude') ? claudeConfigDir(provider) : '';
  const claudePrefix = cdir ? `CLAUDE_CONFIG_DIR=${cdir} ` : '';
  // With a persistent session you can RESUME the exact same agent conversation
  // (and it shows up in the CLI/app session list). Otherwise, open a fresh CLI.
  let attach;
  if (persistent && sessionId && provider.startsWith('claude')) attach = `Resume this exact agent:  cd ${workspace} && ${claudePrefix}claude --resume ${sessionId}`;
  else if (persistent && sessionId && provider === 'copilot') attach = `Resume this exact agent:  cd ${workspace} && copilot --resume=${sessionId}`;
  else if (persistent && provider === 'codex') attach = `Resume this agent:  cd ${workspace} && codex resume   (pick the newest session)`;
  else attach = `Chat directly in its workspace:  cd ${workspace} && ${cli}`;
  return [
    `Watch the live agent loop:  ${tmuxPrefix}tmux attach -t ${tmuxSession}   (detach: Ctrl-b then d)`,
    attach,
    `Provider / model:  ${provider} / ${model || 'account-default'}`,
    `Workspace:  ${workspace}`,
  ];
}

// ---------------------------------------------------------------------------
// NATIVE summon = automated join. Instead of the summoner puppeting a headless
// `claude -p` per turn, we launch the agent's OWN harness (interactive, inside
// a tmux session) in the workspace, wired to the agent-room MCP, and tell it to
// join the room and run the native room loop itself — exactly as if Waqas had
// opened `claude` there and said "join room ABC". The payoff: native permission
// UI, a real resumable session (`claude --resume` finally works), and it shows
// in the CLI/app session list. The summoner's job shrinks to launch + supervise
// + kill; room membership, presence, and the loop belong to the harness.
//
// Returns { bin, args, env, files } for providers wired for native, or null so
// the caller falls back to the proven headless driver (codex/copilot for now).
export function nativeLaunchSpec(cfg) {
  const { provider, model, workspace, mode, name, role, code, sessionId,
          account, mcpConfigPath } = cfg;

  if (provider.startsWith('claude')) {
    const cdir = claudeConfigDir(provider);
    // Explicit, lane-independent MCP config: the agent gets exactly the
    // agent-room server (our fork build, pointed at the local server),
    // regardless of which config dir / account lane it runs in.
    // --strict-mcp-config below means ONLY this server is loaded.
    const mcpCfg = { mcpServers: { 'agent-room': agentRoomMcpServer() } };
    const build = mode === 'build';
    const contract = [
      `You are "${name}" (role: ${role || 'AI Agent'}), an AI teammate in a live Agent Room chat with Waqas and other agents.`,
      `You are working natively in ${workspace}${account ? ` on ${account}` : ''}${model ? ` (${model})` : ''}.`,
      `The room code is EXACTLY "${code}" — pass it verbatim to room_join. Room codes are word-style (e.g. cafe-ham-clog); do NOT reject or "correct" it for not being a 9-character dashed code, and do not ask for a different code.`,
      `CONTRACT: after you join, STAY in the room loop — keep calling room_listen; when a message needs you, reply with room_send, then room_listen again. Never end your turn while the room is active. Leave only if the room ends, you are removed from participants, or the host tells you to stop.`,
      build
        ? `You MAY edit files in this workspace when the room asks you to.`
        : `You are a CHAT participant: discuss, review, and advise — do not edit files.`,
    ].join(' ');
    const joinMsg =
      `Call room_join now with code exactly "${code}" (pass it verbatim — it is a valid word-style code, not a 9-char dashed one) ` +
      `and name "${name}" (role: ${role || 'AI Agent'}, model: ${model || 'default'}, ` +
      `account: ${account || 'me'}, capabilities: ${build ? 'can edit files' : 'chat only'}). Then follow the room loop.`;
    const args = [
      '--mcp-config', mcpConfigPath,
      '--strict-mcp-config',
      '--session-id', sessionId,
      ...(model ? ['--model', model] : []),
      // Pre-approve the whole agent-room MCP server so join/listen/send never
      // block an unattended agent. File edits (build) auto-accept but stay
      // visible in the transcript; anything else still prompts (attach to see).
      '--allowedTools', 'mcp__agent-room',
      ...(build ? ['--add-dir', workspace, '--permission-mode', 'acceptEdits'] : []),
      '--append-system-prompt', contract,
      joinMsg,
    ];
    return {
      bin: 'claude',
      args,
      env: cdir ? { CLAUDE_CONFIG_DIR: cdir } : {},
      files: [{ path: mcpConfigPath, content: JSON.stringify(mcpCfg, null, 2), mode: 0o600 }],
    };
  }

  return null; // codex / copilot / gemini — native path not wired yet.
}
