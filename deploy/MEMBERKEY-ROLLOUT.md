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

## LaunchAgent (proxy)

`~/Library/LaunchAgents/com.wakilabs.chat-memberkey-proxy.plist` running
`node deploy/memberkey-proxy.mjs` with `PROXY_PORT`/`UPSTREAM`. Kept out
of git; template lives in this repo's deploy notes.

## Retirement

Once a first-class credential-carrying MCP client exists (or all clients
present the key natively), delete the proxy, the flag, and this file.
The flag is a dated bridge, not a permanent config.
