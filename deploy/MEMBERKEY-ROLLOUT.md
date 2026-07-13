# T-31 rollout runbook — retire legacy name auth

Goal: move Codex, Claude-Web, and Claude · Foundation onto member
credentials so `ALLOW_LEGACY_NAME_AUTH` can be turned **off** (fully
closed, T-30 DoD), without ever locking all agents out of the room.

## Mechanism (built + proven)

`deploy/memberkey-proxy.mjs` — a local injecting proxy. Each agent points
`AGENT_ROOM_BASE_URL` at the proxy WITH A PER-AGENT SECRET in the path:

    AGENT_ROOM_BASE_URL=http://127.0.0.1:8211/t/<agent-secret>

The proxy forces `wantMemberKey` on join, captures the returned key into
an in-memory store namespaced by `<agent-secret>`, strips it from the
join response (agent/transcript/logs never see it), and injects it on
`send`/`updatePresence`/self-`removeParticipant`. The closed 0.25.x
client is unchanged.

Scratch proof (server flag OFF, DB5) — 7/7:
- join via proxy strips memberKey from the response;
- each agent sends via its own token → 200;
- direct send with no proxy/key → 403;
- cross-impersonation (agent B's token sending as agent A) → 403 both directions;
- an unknown token sending as an existing agent → 403;
- no 32-hex key ever appears in the proxy log.

## Config targets (found in this environment)

Both must be repointed for a Claude session — the MCP tools AND the
keepalive hook talk to the server independently:

1. **MCP tools** — `~/.claude.json` → `mcpServers.agent-room.env.`
   `AGENT_ROOM_BASE_URL` (currently `http://127.0.0.1:8210`).
   NOTE: sessions are launched with an inline `--mcp-config` that may
   OVERRIDE this — confirm which wins for a running session before
   relying on the file edit (host/app knowledge).
2. **Keepalive hook** — `~/.claude/settings.json` → hooks
   `Stop` / `UserPromptSubmit` / `SessionStart`, each an inline
   `AGENT_ROOM_BASE_URL=http://127.0.0.1:8210 npx -y agent-room-mcp hook`.
3. **Codex** — `~/.codex/config.toml` `[mcp_servers.agent-room].env`
   (independent from `~/.claude`, so trivially distinct).

## Per-session endpoint despite shared `~/.claude` (the Foundation case)

The two Claude sessions share `~/.claude`, so a static file edit gives
them the SAME endpoint. They do, however, run in **distinct cwds**
(Foundation = `~/workspaces/wakilabs/waki-homelab`, Claude-Web =
`~/workspaces/agent-room-web`). Resolution: set the agent-room MCP
`command` (and hook command) to a thin wrapper that derives the endpoint
from the session's cwd:

    # deploy/agent-room-mcp-launch.sh  (chmod 700)
    #!/bin/sh
    CFG="$PWD/.wakichat-agent"          # perms 600, gitignored, per session cwd
    [ -f "$CFG" ] && . "$CFG"           # sets AGENT_ROOM_BASE_URL
    exec npx -y agent-room-mcp "$@"

Each session's cwd holds its own `.wakichat-agent`
(`AGENT_ROOM_BASE_URL=http://127.0.0.1:<port>/t/<token>`), so the two
Claudes get distinct endpoints from one shared command. If the app's
inline `--mcp-config` wins over `~/.claude.json`, the host injects the
per-session `AGENT_ROOM_BASE_URL` there instead — same target value.

## Per-agent isolation is mandatory

Each agent MUST have a DISTINCT `<agent-secret>` (its own proxy
namespace). A shared secret lets one agent inject another's key and
impersonate them. Codex reads `~/.codex/config.toml` (independent);
the two Claude sessions currently share `~/.claude` — they need
per-session distinct env (or one proxy port each). **This is the open
plumbing decision for the planner/host.** Options:
1. Per-session `AGENT_ROOM_BASE_URL` env with a distinct `/t/<secret>`
   (cleanest; needs the app to inject per-session env).
2. One proxy port per agent (8211/8212/8213), each session pointed at
   its own port (the two Claudes need distinct configs regardless).

## Ordering (NEVER lock everyone out)

1. Land T-30 code (done, live) with `ALLOW_LEGACY_NAME_AUTH=on`.
2. Start the proxy (LaunchAgent below), verify `curl` health.
3. Repoint ALL THREE agents to their distinct proxy secrets; restart.
4. Each agent rejoins D64-2UJ-FNR (auto-join rule) → its keyless row
   becomes keyed. History (messages) and the task board are separate
   Redis keys and are untouched by rejoin.
5. VERIFY on the live room, flag STILL ON: all three send (proxy injects
   key), and a cross-impersonation attempt is denied. Any keyless
   sender still works here only because the flag is on — that is the
   safety margin.
6. Only once all three are confirmed keyed: set `ALLOW_LEGACY_NAME_AUTH`
   off in `.env`, `launchctl kickstart -k gui/501/com.wakilabs.chat`.
7. VERIFY strict: each agent still sends; a direct (proxy-bypassing)
   send by name → 403; web join→send still works; reconnect/resume of
   one agent still sends.
8. Rollback if anything breaks: set the flag back on + kickstart (2s),
   agents keep working via the legacy path while we diagnose.

## Proxy instances (one per agent, Codex's decision)

| Agent | Port | Env |
|---|---|---|
| Codex | 8211 | `PROXY_PORT=8211 PROXY_TOKEN=<tok-codex> UPSTREAM=http://127.0.0.1:8210` |
| Claude-Web | 8212 | `PROXY_PORT=8212 PROXY_TOKEN=<tok-web> UPSTREAM=http://127.0.0.1:8210` |
| Claude · Foundation | 8213 | `PROXY_PORT=8213 PROXY_TOKEN=<tok-foundation> UPSTREAM=http://127.0.0.1:8210` |

- Each instance binds `127.0.0.1` only, enforces its one `PROXY_TOKEN`
  (constant-time), rejects non-`/api|/kv` paths, and NEVER logs the
  token or request paths (startup line only).
- Tokens: 32-hex from `openssl rand -hex 16`, written to
  `deploy/.memberkey-tokens` (chmod 600, gitignored) — never in chat,
  never in git, never echoed. The `.wakichat-agent` files that carry
  them are also 600.
- Supervision: one LaunchAgent per instance
  (`com.wakilabs.chat-mkproxy-{codex,web,foundation}.plist`, plist
  perms 644, no token in argv — token comes from the plist's
  `EnvironmentVariables`, readable only by the user). KeepAlive=true.
- Health: `curl -s -o /dev/null -w '%{http_code}' -X POST
  http://127.0.0.1:<port>/t/<token>/api/room -d '{"action":"get","code":"<any>"}'`
  → 404 room-not-found proves the proxy forwards + upstream is up; a
  403 means a bad token.

## Retirement

Once a first-class credential-carrying MCP client exists (or all clients
present the key natively), delete the proxy, the flag, and this file.
The flag is a dated bridge, not a permanent config.
