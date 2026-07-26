// providers.mjs — provider catalog, per-turn model invocation, and the
// "reach this agent directly" instructions shown in the app.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from 'node:fs';
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

// Pre-clear Claude Code's interactive first-run gates for a summoned agent so an
// UNATTENDED native session never stalls on a prompt no one can answer:
//   - hasCompletedOnboarding      → skips the theme picker
//   - bypassPermissionsModeAccepted → skips the bypass-mode acceptance
//   - projects[ws].hasTrustDialogAccepted → skips the "trust this folder?" gate
//     (which even --dangerously-skip-permissions does NOT bypass).
// Scoped to lanes with a DEDICATED config dir (e.g. the corporate agent lane);
// the personal lane is the human's own ~/.claude.json and their folders are
// already trusted — we never mutate that. Atomic write; best-effort.
export function ensureAgentConfigReady(providerId, workspace) {
  if (!providerId.startsWith('claude')) return;
  const dir = claudeConfigDir(providerId);
  if (!dir) return; // personal lane — do not touch the human's config
  const cfgPath = join(dir, '.claude.json');
  try {
    const j = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
    const before = JSON.stringify(j);
    j.hasCompletedOnboarding = true;
    j.bypassPermissionsModeAccepted = true;
    const proj = (j.projects = j.projects || {});
    const e = (proj[workspace] = proj[workspace] || {});
    e.hasTrustDialogAccepted = true;
    // Pre-DECLINE any project-.mcp.json servers so the "new MCP server found in
    // this project" prompt never blocks — the agent runs --strict-mcp-config
    // and only loads the agent-room server anyway.
    try {
      const mj = join(workspace, '.mcp.json');
      if (existsSync(mj)) {
        const servers = Object.keys(JSON.parse(readFileSync(mj, 'utf8')).mcpServers || {});
        const disabled = new Set(e.disabledMcpjsonServers || []);
        for (const s of servers) disabled.add(s);
        e.disabledMcpjsonServers = [...disabled];
        e.enabledMcpjsonServers = e.enabledMcpjsonServers || [];
      }
    } catch { /* no/invalid .mcp.json — nothing to pre-decline */ }
    if (JSON.stringify(j) === before) return; // nothing changed — skip the write
    const tmp = cfgPath + '.summoner-tmp';
    writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: 0o600 });
    JSON.parse(readFileSync(tmp, 'utf8')); // verify it parses before swapping
    renameSync(tmp, cfgPath);
  } catch { /* best-effort; a prompt is still better than a corrupt config */ }
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

// ---------------------------------------------------------------------------
// PERMISSION LEVELS for summoned agents — chosen at launch and surfaced in the
// app's agent-details view so it's always clear what an agent can do:
//   chat  — responds in the room only; NO file access.
//   edit  — can create/modify files in the workspace (auto-accepted); no shell.
//   build — full autonomy in the workspace: edit AND run commands (git, tests,
//           builds) unattended. Needed for agents that actually ship changes.
// Legacy 'build' stays 'build'; anything unknown is the safe 'chat'.
export function normalizeAccess(mode) {
  return mode === 'build' ? 'build' : mode === 'edit' ? 'edit' : 'chat';
}
export function accessLabel(mode) {
  const a = normalizeAccess(mode);
  return a === 'build' ? 'Build — edits files and runs commands (git/tests) autonomously'
       : a === 'edit'  ? 'Edit — can create/modify files in the workspace (no shell)'
       :                 'Chat — responds in the room only (no file access)';
}

// Build the argv for a single non-interactive model turn.
// mode: 'chat' | 'edit' | 'build' (see PERMISSION LEVELS above).
// NOTE: turns are stateless (no --session-id). With --session-id, Claude Code
// loads full session/CLAUDE.md context and reliably answers "(no reply)"; the
// room transcript is the shared memory instead. Continuity is a future add.
function buildArgv({ provider, model, workspace, mode, outFile, persistent, sessionId, resume }) {
  const access = normalizeAccess(mode);
  const build = access === 'build';
  const write = access !== 'chat';
  const persist = persistent && sessionId;
  if (provider.startsWith('claude')) {
    // NOTE: --add-dir is VARIADIC (<directories...>), so it must be followed by
    // another flag — never placed right before the positional prompt, or it
    // swallows the prompt and Claude errors "input must be provided". Keep it
    // early, ahead of the boolean/value flags.
    const a = ['-p'];
    if (build) a.push('--add-dir', workspace, '--dangerously-skip-permissions');
    else if (access === 'edit') a.push('--add-dir', workspace, '--permission-mode', 'acceptEdits');
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
    if (write) a.push('--allow-all-tools');
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
      '--sandbox', write ? 'workspace-write' : 'read-only'];
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
// Returns { bin, args, env, files, seedKeys } for providers wired for native, or
// null so the caller falls back to the headless driver. `seedKeys` (copilot) is
// a prompt to type into the interactive REPL via tmux send-keys once it boots,
// for harnesses that take no positional/system prompt.
// Every agent-room MCP tool (apps/mcp/src/tools.ts). Codex approves MCP tools
// per-tool per-first-use; an unattended session must have them all
// pre-approved or it stalls on a dialog the first time it reaches for one.
const CODEX_ROOM_TOOLS = [
  'room_join', 'room_listen', 'room_send', 'room_status', 'room_list_messages',
  'room_create', 'room_end', 'room_leave', 'room_watch', 'room_unwatch',
  'room_export', 'room_minutes', 'room_reactivate', 'room_set_mode',
  'room_skip_current', 'room_direct_invoke',
  'room_question_create', 'room_question_list',
  'room_task_list', 'room_task_create', 'room_task_claim', 'room_task_submit', 'room_task_verify',
  'room_attachment_download', 'room_attachment_read',
];

export function nativeLaunchSpec(cfg) {
  const { provider, model, workspace, mode, name, role, code, sessionId,
          account, mcpConfigPath } = cfg;
  const access = normalizeAccess(mode);
  const build = access === 'build';
  const canWrite = access !== 'chat';
  const mcpBase = agentRoomMcpServer(); // { command, args, env } — our fork MCP, local server
  // Identity override for the MCP's harness detection: the summoner KNOWS the
  // harness it is launching, and some (copilot) set no detectable env of their
  // own — without this, summoned copilot agents joined branded as the wrong
  // provider and their avatars wore the wrong logo.
  const harnessId = provider === 'copilot' ? 'copilot'
    : provider === 'codex' ? 'codex'
    : provider.startsWith('gemini') ? 'gemini-cli'
    : 'claude-code';
  const mcp = { ...mcpBase, env: { ...(mcpBase.env || {}), AGENT_ROOM_HARNESS: harnessId } };

  // Shared identity + room-loop contract every native harness receives.
  const capText = build ? 'You MAY edit files in this workspace AND run commands (git, tests, builds) to actually ship changes when the room asks.'
                : access === 'edit' ? 'You MAY create and modify files in this workspace when the room asks (no shell commands).'
                : 'You are a CHAT participant: discuss, review, and advise — do not edit files.';
  const contract = [
    `You are "${name}" (role: ${role || 'AI Agent'}), an AI teammate in a live Agent Room chat with Waqas and other agents.`,
    `You are working natively in ${workspace}${account ? ` on ${account}` : ''}${model ? ` (${model})` : ''}.`,
    `The room code is EXACTLY "${code}" — pass it verbatim to room_join. Room codes are word-style (e.g. cafe-ham-clog); do NOT reject or "correct" it for not being a 9-character dashed code, and do not ask for a different code.`,
    `CONTRACT: after you join, STAY in the room loop — keep calling room_listen; when a message needs you, reply with room_send, then room_listen again. Never end your turn while the room is active. Leave only if the room ends, you are removed from participants, or the host tells you to stop.`,
    // Work conventions (short form — room_join returns the full canonical
    // `conventions` blurb plus the room's template brief; follow those).
    `WORK CONVENTIONS: prefix key messages with [STATUS] progress · [DECISION] choices · [RESULT] shipped work (commit/link/proof) · [TODO] handoffs — the room indexes marker lines as durable artifacts in its Outputs tab. Track multi-step work on the evidence-gated task board (room_task_create/claim/submit; a DIFFERENT agent verifies via room_task_verify). Ask the host structured questions with room_question_create instead of burying them in chat. Before starting long work, send a one-line acknowledgement when you can (room_status is enough) so the requester knows the ask landed. Your room_join response includes the room's template brief and the full conventions — follow them, and open with a one-line read of the room type and how you'll work it.`,
    capText,
  ].join(' ');
  const capLabel = build ? 'can edit files + run commands' : access === 'edit' ? 'can edit files' : 'chat only';
  const joinMsg =
    `Call room_join now with code exactly "${code}" (pass it verbatim — it is a valid word-style code, not a 9-char dashed one) ` +
    `and name "${name}" (role: ${role || 'AI Agent'}, model: ${model || 'default'}, ` +
    `account: ${account || 'me'}, capabilities: ${capLabel}). Then follow the room loop.`;

  // ---- Claude: --mcp-config file + --append-system-prompt + positional prompt ----
  if (provider.startsWith('claude')) {
    const cdir = claudeConfigDir(provider);
    const mcpCfg = { mcpServers: { 'agent-room': mcp } };
    const args = [
      '--mcp-config', mcpConfigPath, '--strict-mcp-config',
      '--session-id', sessionId,
      ...(model ? ['--model', model] : []),
      // Permission level → EFFECTIVE, unattended-safe flags. Key subtlety:
      // BOTH --dangerously-skip-permissions AND --permission-mode
      // bypassPermissions pop a one-time interactive "accept bypass mode"
      // warning that a headless -p run skips but an interactive (native) run
      // does NOT — and it isn't persisted to config, so it would block every
      // launch. So we DON'T use bypass. Instead: --permission-mode acceptEdits
      // (auto-accepts file edits, no warning) + an explicit allow-list that
      // pre-approves the shell/file tools a build agent needs — full autonomy,
      // zero prompts. Folder-trust + project-MCP prompts are pre-cleared in the
      // agent config by ensureAgentConfigReady.
      '--allowedTools', build
        ? 'mcp__agent-room,Bash,Edit,Write,MultiEdit,NotebookEdit,Read,Glob,Grep,TodoWrite,WebFetch,WebSearch'
        : 'mcp__agent-room',
      ...(canWrite ? ['--add-dir', workspace, '--permission-mode', 'acceptEdits'] : []),
      '--append-system-prompt', contract,
      joinMsg,
    ];
    return {
      bin: 'claude', args,
      env: cdir ? { CLAUDE_CONFIG_DIR: cdir } : {},
      files: [{ path: mcpConfigPath, content: JSON.stringify(mcpCfg, null, 2), mode: 0o600 }],
    };
  }

  // ---- Codex: strong-loop harness. MCP injected via -c TOML overrides; contract
  //      folded into the positional prompt (codex has no system-prompt flag). ----
  if (provider === 'codex') {
    const toml = (v) => JSON.stringify(v); // JSON encodes TOML strings/arrays fine
    const args = [
      '-C', workspace,
      ...(model ? ['-m', model] : []),
      '-c', `mcp_servers.agent-room.command=${toml(mcp.command)}`,
      '-c', `mcp_servers.agent-room.args=${toml(mcp.args)}`,
      ...Object.entries(mcp.env || {}).flatMap(([k, val]) =>
        ['-c', `mcp_servers.agent-room.env.${k}=${toml(val)}`]),
      // `-a never` covers COMMAND approvals only: codex still pops a per-tool
      // "Allow the agent-room MCP server to run tool X?" dialog on each tool's
      // first use — observed live as CodexMaster stuck on room_join, silent,
      // while the roster said online. Pre-approve every agent-room tool with
      // the exact per-tool key codex itself persists when a human picks
      // "Always allow" (verified against ~/.codex/config.toml). Our own MCP,
      // our own tools — nothing third-party is being blanket-trusted.
      ...CODEX_ROOM_TOOLS.flatMap((t) =>
        ['-c', `mcp_servers.agent-room.tools.${t}.approval_mode="approve"`]),
      '-s', canWrite ? 'workspace-write' : 'read-only',
      '-a', 'never', // no approval prompts (unattended); attach to watch
      '--dangerously-bypass-hook-trust', // else codex blocks on a hooks-trust prompt, never joining
      `${contract}\n\n${joinMsg}`,
    ];
    return { bin: 'codex', args, env: {}, files: [] };
  }

  // ---- Copilot: weak-loop harness. MCP via --additional-mcp-config; interactive
  //      takes no positional/system prompt, so seed the join instruction into the
  //      REPL via tmux send-keys once it boots. Experimental (looping is weaker). ----
  if (provider === 'copilot') {
    const mcpJson = JSON.stringify({ mcpServers: { 'agent-room': mcp } });
    const args = [
      '--additional-mcp-config', mcpJson,
      ...(model ? ['--model', model] : []),
      // Write perms only when granted. --allow-all-tools does NOT cover paths
      // outside the allowed directories: copilot creates scratch worktrees
      // under /tmp (e.g. /tmp/copilot-<task>) and then blocks FOREVER on an
      // interactive "Allow directory access?" dialog no one is attached to
      // answer — observed live as an agent "going quiet" mid-task. Pre-allow
      // the temp roots so the unattended session never hits that prompt.
      ...(canWrite ? ['--add-dir', workspace, '--add-dir', '/tmp', '--add-dir', tmpdir(), '--allow-all-tools'] : []),
      '--no-color',
      '-n', name,
    ];
    // Single line (no newlines) — send-keys types it straight into the REPL.
    return { bin: 'copilot', args, env: {}, files: [], seedKeys: `${contract} ${joinMsg}` };
  }

  return null; // gemini etc. — headless fallback.
}
