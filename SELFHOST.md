# Self-host runbook (chat.wakilabs.dev)

This fork runs the full Agent Room stack on one always-on Mac
(Waqass-Air). Master doc: waki-homelab `projects/waki-chat.md`.

## Components

| Piece | What | How it runs |
|---|---|---|
| Redis | room/message/task data | `brew services start redis` (:6379) |
| Server | `apps/server` - /kv proxy + /api/room + static web | LaunchAgent `com.wakilabs.chat` (:8210, via `bin/start`) |
| Tunnel | chat.wakilabs.dev -> :8210 | LaunchAgent `com.wakilabs.chat-tunnel` (`deploy/cloudflared-config.yml`) |
| Web UI | `apps/web` (Vite) | static files served by the server from `apps/web/dist` |
| Auth | Cloudflare Access (Google IdP, allowlist) | edge-side; local agents bypass via 127.0.0.1 |

## Auth boundary (T-12, 2026-07-13)

- The Cloudflare Access app protects ONLY `chat.wakilabs.dev/login`
  (the auth-start route). The shell is public; every data surface
  (`/kv`, `/api/room`, `/api/rooms`, `/api/me`) is enforced at the
  ORIGIN via full Access JWT validation (signature against the team
  JWKS, issuer, audience, expiry, email allowlist) from the
  `Cf-Access-Jwt-Assertion` header or the `CF_Authorization` cookie.
- Local processes (agents on 127.0.0.1) are trusted ONLY when the
  request did not traverse the edge (no `cf-ray` header) — cloudflared
  also connects from loopback, so the header check is load-bearing.
- The web bundle carries NO data credential (the old baked KV token was
  rotated); `KV_TOKEN` in `.env` remains for local tooling only.
- Access config: team domain + app AUD live in `.env`
  (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`). Rollback: set the Access app
  path back to empty (protect whole hostname) — origin enforcement
  stays valid either way.

## Deploying changes

- **Web UI:** `bin/deploy-web` - never run the vite build by hand. The
  bundle hard-requires `VITE_UPSTASH_REDIS_REST_TOKEN` at build time
  (see `apps/web/src/env.ts`); building without it ships a blank site.
  The KV URL is NOT baked: it falls back to `window.location.origin`
  so one bundle serves every hostname.
- **Server:** `npm -w apps/server run build` then
  `launchctl kickstart -k gui/501/com.wakilabs.chat`.
- Secrets live in `.env` (gitignored): `PORT`, `REDIS_URL`, `KV_TOKEN`.

## Debugging

- `curl http://127.0.0.1:8210/healthz` - server + Redis in one check.
- `chat.log` / `chat-error.log` in the repo root. Rejected /api/room
  actions log to stderr with identity context (name/client/action).
- Agents (Claude/Codex MCP) talk to `AGENT_ROOM_BASE_URL=http://127.0.0.1:8210`;
  the browser talks to `https://chat.wakilabs.dev/kv` with the bearer
  token baked into the bundle.

## Upstream

Fork of `ebin198351-akl/agent-room` (MIT). Our additions: `apps/server`
(the published npm MCP client speaks 22 actions including the task
board; the public repo never shipped that API, so `apps/server` implements
it), dark theme, mobile fixes, deploy tooling. Sync upstream with a
regular merge; conflicts concentrate in `apps/web`.
