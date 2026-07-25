// service.mjs — the agent-summoner service (loopback :8219).
// Spawns/kills/ tracks summoned CLI agents (Claude / Copilot / Codex) as tmux
// sessions running driver.mjs, wired into an agent-room room. The main
// agent-room server forwards authenticated /api/summon* requests here.
//
// HTTP:  GET  /health
//        GET  /workspaces           -> grouped local workspaces
//        GET  /providers            -> provider + model catalog
//        GET  /agents               -> live roster (+ health)
//        POST /summon  {room,provider,model,workspace,name,role,mode}
//        POST /relaunch {agentId,mode}   -> dismiss + summon at a new level
//        POST /dismiss {agentId}
//
// CLI (for testing): node service.mjs <workspaces|providers|agents|summon '<json>'|dismiss <id>>
import http from 'node:http';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listGrouped, isValidWorkspace } from './workspaces.mjs';
import { catalog, providerById, accessInstructions, nativeLaunchSpec, normalizeAccess, accessLabel, ensureAgentConfigReady, AUG_PATH } from './providers.mjs';
import { leave } from './roomcli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, 'driver.mjs');
const HOME = join(homedir(), '.agent-room', 'summoner');
const REGISTRY = join(HOME, 'registry.json');
const ROOM_BASE = process.env.ROOM_BASE || 'http://127.0.0.1:8210';
const PORT = Number(process.env.SUMMONER_PORT || 8219);
// Pin a fixed tmux socket dir so sessions launched under launchd are attachable
// from any of Waqas's terminals (same TMUX_TMPDIR => same tmux server).
const TMUX_TMPDIR = process.env.SUMMONER_TMUX_TMPDIR || join(homedir(), '.agent-room', 'tmux');

mkdirSync(HOME, { recursive: true });
mkdirSync(TMUX_TMPDIR, { recursive: true });

// ---------- registry ----------
function loadRegistry() {
  try { return JSON.parse(readFileSync(REGISTRY, 'utf8')); } catch { return { agents: {} }; }
}
function saveRegistry(r) {
  writeFileSync(REGISTRY, JSON.stringify(r, null, 2), { mode: 0o600 });
  try { chmodSync(REGISTRY, 0o600); } catch {}
}

// ---------- tmux ----------
function tmux(args) {
  return spawnSync('tmux', args, {
    env: { ...process.env, PATH: AUG_PATH, TMUX_TMPDIR }, encoding: 'utf8',
  });
}
function sessionAlive(session) {
  return tmux(['has-session', '-t', session]).status === 0;
}
function killSession(session) {
  tmux(['kill-session', '-t', session]);
}

// ---------- helpers ----------
function sanitizeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40);
}
function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}
function health(agent) {
  if (agent.status === 'dismissed') return 'dismissed';
  if (!sessionAlive(agent.tmuxSession)) return 'stopped';
  // Native agents own their own room loop (no summoner heartbeat file); a live
  // tmux session means the harness is running. True in-room presence is the
  // server's job (lease/heartbeat), shown in the room itself.
  if (agent.native) return 'online';
  try {
    const beat = Number(readFileSync(agent.heartbeat, 'utf8').trim());
    if (Date.now() - beat < 320000) return 'online';
    return 'stalled';
  } catch { return 'starting'; }
}

function publicAgent(a) {
  return {
    agentId: a.agentId, name: a.name, role: a.role, provider: a.provider,
    model: a.model, workspace: a.workspace, room: a.room, mode: a.mode,
    accessLevel: normalizeAccess(a.mode), accessLabel: accessLabel(a.mode), persistent: a.persistent,
    account: a.account || '', sessionId: a.sessionId, native: Boolean(a.native),
    createdAt: a.createdAt, dismissedAt: a.dismissedAt, status: a.status, health: health(a),
    tmuxSession: a.tmuxSession,
    access: accessInstructions({ ...a, tmuxTmpdir: TMUX_TMPDIR }),
  };
}

// ---------- core actions ----------
function doListWorkspaces() { return { groups: listGrouped() }; }
function doListProviders(force = false) { return { providers: catalog(force) }; }

function doListAgents() {
  const r = loadRegistry();
  const agents = Object.values(r.agents)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicAgent);
  return { agents };
}

function doSummon(body) {
  const provider = providerById(body.provider);
  if (!provider) throw httpErr(400, `unknown provider: ${body.provider}`);
  if (!provider.available) throw httpErr(400, `${provider.label} CLI not installed on this machine`);

  const name = sanitizeName(body.name);
  if (!name) throw httpErr(400, 'a display name is required');

  const room = String(body.room || '').trim();
  if (!room) throw httpErr(400, 'room code is required');

  const workspace = String(body.workspace || '').trim();
  if (!isValidWorkspace(workspace)) throw httpErr(400, `workspace not found or outside home: ${workspace || '(none)'}`);

  const model = String(body.model || '').trim() || provider.defaultModel;
  const role = sanitizeName(body.role) || 'AI Agent';
  const mode = normalizeAccess(body.mode); // chat | edit | build
  const persistent = body.persistent !== false; // default ON — resumable/attachable

  // Reject a duplicate live agent with the same name in the same room.
  const reg0 = loadRegistry();
  const dup = Object.values(reg0.agents).find(
    (a) => a.room === room && a.name === name && a.status === 'active' && sessionAlive(a.tmuxSession));
  if (dup) throw httpErr(409, `an agent named "${name}" is already active in this room`);

  const agentId = `${slug(room)}-${slug(name)}-${randomUUID().slice(0, 8)}`;
  const tmuxSession = `sm-${slug(room)}-${slug(name)}-${agentId.slice(-8)}`.slice(0, 60);
  const agentHome = join(HOME, agentId);
  mkdirSync(agentHome, { recursive: true });
  // Member credential is keyed by (room,name) at a stable path so a re-summon
  // of the same name reclaims the same row instead of colliding (403).
  const keysDir = join(HOME, 'keys');
  mkdirSync(keysDir, { recursive: true });
  const keyfile = join(keysDir, `${slug(room)}__${slug(name)}.key`);
  const heartbeat = join(agentHome, 'heartbeat');
  const logfile = join(agentHome, 'driver.log');
  const sessionId = randomUUID();
  const account = provider.account?.email || '';

  // NATIVE summon (default) = automated join: launch the agent's OWN harness in
  // the workspace and let it join the room itself via the agent-room MCP. Gives
  // native permission UI, a real resumable session, and session-list presence.
  // Providers not yet wired for native return null and take the headless driver
  // (summoner-owned loop) instead.
  const mcpConfigPath = join(agentHome, 'agent-room.mcp.json');
  // Native summon (the harness joins via MCP and runs the room loop itself) is
  // the DEFAULT — join AND reply are verified reliable now that the MCP mints +
  // presents a member credential on every send (the missing-key bug that made
  // MCP agents go passive is fixed). Pass native:false to force the headless
  // driver (summoner owns the loop) for a provider not yet wired for native.
  const native = body.native === false
    ? null
    : nativeLaunchSpec({
        provider: provider.id, model, workspace, mode, name, role, code: room,
        sessionId, account, mcpConfigPath,
      });

  let launchLines;
  if (native) {
    for (const f of native.files) writeFileSync(f.path, f.content, { mode: f.mode || 0o600 });
    const envPairs = { PATH: AUG_PATH, ...native.env };
    launchLines = ['#!/bin/bash', 'set -e',
      ...Object.entries(envPairs).map(([k, v]) => `export ${k}=${shq(v)}`),
      `cd ${shq(workspace)}`,
      `exec ${shq(native.bin)} ${native.args.map(shq).join(' ')}`, ''];
  } else {
    // Headless driver path — the summoner owns the listen→model→send loop.
    const env = {
      PATH: AUG_PATH, ROOM_BASE,
      SM_ROOM: room, SM_NAME: name, SM_ROLE: role, SM_PROVIDER: provider.id,
      SM_MODEL: model, SM_WORKSPACE: workspace, SM_KEYFILE: keyfile,
      SM_SESSION: sessionId, SM_MODE: mode, SM_HEARTBEAT: heartbeat, SM_LOG: logfile,
      SM_PERSISTENT: persistent ? 'on' : 'off',
      SM_COLOR: colorFor(provider.id),
    };
    launchLines = ['#!/bin/bash', 'set -e',
      ...Object.entries(env).map(([k, v]) => `export ${k}=${shq(v)}`),
      `exec node ${shq(DRIVER)}`, ''];
  }
  const launch = join(agentHome, 'launch.sh');
  writeFileSync(launch, launchLines.join('\n'), { mode: 0o700 });
  try { chmodSync(launch, 0o700); } catch {}

  // Clear Claude Code's first-run gates (onboarding / bypass-accept / folder
  // trust) in the agent's dedicated config dir so an unattended native session
  // never stalls on a prompt no one can answer.
  ensureAgentConfigReady(provider.id, workspace);

  // Launch in a detached tmux session.
  const res = tmux(['new-session', '-d', '-s', tmuxSession, '-c', workspace, 'bash', launch]);
  if (res.status !== 0) throw httpErr(500, `tmux launch failed: ${(res.stderr || '').trim()}`);

  // Copilot (and other REPL-only harnesses) take no positional/system prompt, so
  // type the join instruction into the interactive REPL once it has booted.
  if (native && native.seedKeys) {
    const seedCmd =
      `sleep 12; tmux send-keys -t ${shq(tmuxSession)} -l ${shq(native.seedKeys)}; ` +
      `sleep 1; tmux send-keys -t ${shq(tmuxSession)} Enter`;
    try {
      spawn('bash', ['-c', seedCmd], {
        detached: true, stdio: 'ignore',
        env: { ...process.env, PATH: AUG_PATH, TMUX_TMPDIR },
      }).unref();
    } catch { /* best-effort seed */ }
  }

  const agent = {
    agentId, name, role, provider: provider.id, model, workspace, room, mode, persistent,
    account, native: Boolean(native),
    tmuxSession, sessionId, agentHome, keyfile, heartbeat, logfile,
    createdAt: Date.now(), status: 'active',
  };
  const r = loadRegistry();
  r.agents[agentId] = agent;
  saveRegistry(r);
  return { agent: publicAgent(agent) };
}

// One-step "bring the agents back": re-summon every distinct agent that was
// ever in a room (newest config per name wins), skipping any still alive. Used
// by the app's Reactivate flow so an ended/gone-quiet room's crew returns in a
// single click instead of re-summoning each agent by hand.
function doResummon(body) {
  const room = String(body.room || '').trim();
  if (!room) throw httpErr(400, 'room code is required');
  const reg = loadRegistry();
  const byName = {};
  for (const a of Object.values(reg.agents)) {
    if (a.room !== room) continue;
    if (!byName[a.name] || a.createdAt > byName[a.name].createdAt) byName[a.name] = a;
  }
  const results = [];
  for (const a of Object.values(byName)) {
    if (a.status === 'active' && sessionAlive(a.tmuxSession)) {
      results.push({ name: a.name, status: 'already-live' });
      continue;
    }
    try {
      const r = doSummon({
        room, provider: a.provider, model: a.model, workspace: a.workspace,
        name: a.name, role: a.role, mode: a.mode,
        persistent: a.persistent !== false, native: Boolean(a.native),
      });
      results.push({ name: a.name, status: 'resummoned', agentId: r.agent.agentId });
    } catch (e) {
      results.push({ name: a.name, status: 'error', error: e.message });
    }
  }
  return { room, agents: results };
}

// Change a live agent's permission level. Levels map to how the process is
// LAUNCHED (native permission flags), so an in-place flip is impossible —
// relaunch = dismiss + summon with the same config at the new level. The
// same-name key reuse in doSummon means the agent reclaims its row.
async function doRelaunch(body) {
  const reg = loadRegistry();
  const a = reg.agents[String(body.agentId || '')];
  if (!a) throw httpErr(404, 'unknown agentId');
  // Loud on misuse: a relaunch is disruptive, so an unrecognized level is a
  // 400, never a silent fall-through to the normalize default.
  if (!['chat', 'edit', 'build'].includes(body.mode)) {
    throw httpErr(400, `mode must be chat, edit, or build (got: ${body.mode ?? '(none)'})`);
  }
  const mode = normalizeAccess(body.mode);
  if (mode === normalizeAccess(a.mode) && a.status === 'active' && sessionAlive(a.tmuxSession)) {
    return { agent: publicAgent(a), status: 'unchanged' };
  }
  await doDismiss({ agentId: a.agentId });
  const r = doSummon({
    room: a.room, provider: a.provider, model: a.model, workspace: a.workspace,
    name: a.name, role: a.role, mode,
    persistent: a.persistent !== false, native: Boolean(a.native),
  });
  return { agent: r.agent, status: 'relaunched' };
}

async function doDismiss(body) {
  const r = loadRegistry();
  const a = r.agents[body.agentId];
  if (!a) throw httpErr(404, 'unknown agentId');
  killSession(a.tmuxSession);
  // Only free the shared (room,name) participant row + key if NO OTHER active
  // agent still uses that name in the room — otherwise dismissing an old agent
  // would yank the live agent's row out from under it (the "vanished from the
  // room" bug).
  const nameStillLive = Object.values(r.agents).some((x) =>
    x.agentId !== a.agentId && x.room === a.room && x.name === a.name
    && x.status === 'active' && sessionAlive(x.tmuxSession));
  if (!nameStillLive) {
    try { await leave({ code: a.room, name: a.name, keyfile: a.keyfile }); } catch {}
    try { if (a.keyfile && existsSync(a.keyfile)) unlinkSync(a.keyfile); } catch {}
  }
  a.status = body.archived ? 'archived' : 'dismissed';
  a.dismissedAt = Date.now();
  saveRegistry(r);
  return { agent: publicAgent(a) };
}

// ---------- small utils ----------
function colorFor(p) { return p.startsWith('claude') ? '#B4592F' : p === 'copilot' ? '#1F883D' : '#6E40C9'; }
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b));
  });
}
function json(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(s);
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/workspaces') return json(res, 200, doListWorkspaces());
    if (req.method === 'GET' && url.pathname === '/providers') return json(res, 200, doListProviders(url.searchParams.get('refresh') === '1'));
    if (req.method === 'GET' && url.pathname === '/agents') return json(res, 200, doListAgents());
    if (req.method === 'POST' && url.pathname === '/summon') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return json(res, 200, doSummon(body));
    }
    if (req.method === 'POST' && url.pathname === '/resummon') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return json(res, 200, doResummon(body));
    }
    if (req.method === 'POST' && url.pathname === '/relaunch') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return json(res, 200, await doRelaunch(body));
    }
    if (req.method === 'POST' && url.pathname === '/dismiss') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return json(res, 200, await doDismiss(body));
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) });
  }
}

// ---------- CLI mode (testing) ----------
const verb = process.argv[2];
if (verb) {
  try {
    if (verb === 'workspaces') console.log(JSON.stringify(doListWorkspaces(), null, 2));
    else if (verb === 'providers') console.log(JSON.stringify(doListProviders(), null, 2));
    else if (verb === 'agents') console.log(JSON.stringify(doListAgents(), null, 2));
    else if (verb === 'summon') console.log(JSON.stringify(doSummon(JSON.parse(process.argv[3] || '{}')), null, 2));
    else if (verb === 'dismiss') console.log(JSON.stringify(await doDismiss({ agentId: process.argv[3] }), null, 2));
    else { console.error('unknown verb'); process.exit(1); }
  } catch (e) { console.error('ERROR:', e.message || e); process.exit(1); }
} else {
  http.createServer(handle).listen(PORT, '127.0.0.1', () => {
    console.log(`[summoner] listening on 127.0.0.1:${PORT}  driver=${DRIVER}`);
    // Warm the provider catalog so the first Summon dialog opens instantly.
    try { catalog(); } catch { /* best-effort */ }
  });
}
