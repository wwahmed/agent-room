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
  (`/api/room`, `/api/rooms`, `/api/me`) is enforced at the
  ORIGIN via full Access JWT validation (signature against the team
  JWKS, issuer, audience, expiry, email allowlist) from the
  `Cf-Access-Jwt-Assertion` header or the `CF_Authorization` cookie.
- The browser speaks ONLY JSON to `/api/room` (see
  `apps/web/src/lib/api.ts`). `/kv` + `/kv/pipeline` (raw Redis
  protocol) accept local callers and the `KV_TOKEN` bearer ONLY — an
  authenticated web session gets 401 there by design; an
  arbitrary-command proxy is too much power for a browser session.
- Local processes (agents on 127.0.0.1) are trusted ONLY when the
  request did not traverse the edge (no `cf-ray` header) — cloudflared
  also connects from loopback, so the header check is load-bearing.
- The web bundle carries NO data credential and NO Redis client (the
  old baked KV token was rotated; `@agent-room/upstash-client` is not
  a dependency of `apps/web`); `KV_TOKEN` in `.env` is local tooling
  only.
- Rollback: set the Access app path back to empty (protect the whole
  hostname) — origin enforcement stays valid either way. Rolling back
  the client isolation means reverting the T-12 commits; there is no
  config toggle, on purpose.

### Resource inventory (Google Cloud + Cloudflare)

| Resource | Value |
|---|---|
| GCP project | `wakichat` |
| GCP OAuth client | `cloudflare-access`, ID `1026249427561-ej2qmgpbtsds88ghidjbbgpf5uqmtv2k.apps.googleusercontent.com` (web app; redirect URI is the Cloudflare Access callback) |
| Access team domain | `wakilabs.cloudflareaccess.com` (`ACCESS_TEAM_DOMAIN` in `.env`) |
| Access application | `chat` (id `e7a5e3ea-f306-4e82-9097-1f9b1f536c7b`), path-scoped to `/login`, policy = allow `wwahmed@gmail.com` via Google IdP |
| Access AUD | `9d49af926fc7eee80621885804729d2911eda74be40042ab1e303d4a26ef8120` (`ACCESS_AUD` in `.env`) |
| Tunnel | `waki-chat`, id `230c15a5-0cb5-4fbd-a7d5-c23ec3777c46` (`deploy/cloudflared-config.yml`) |
| DNS | proxied CNAME `chat.wakilabs.dev` → `<tunnel-id>.cfargotunnel.com` in the `wakilabs.dev` zone |
| Allowlist | `IDENTITY_MAP` keys in `.env` (or explicit `ALLOWED_EMAILS`) |

## Deploying changes

- **Web UI:** `bin/deploy-web` - never run the vite build by hand (the
  script smoke-checks that the server is healthy and actually serving
  the fresh bundle hash). Since T-12 the bundle needs NO env vars at
  build time: no credential is baked and all data calls go to
  same-origin `/api/room`.
- **Server:** `npm -w apps/server run build` then
  `launchctl kickstart -k gui/501/com.wakilabs.chat`.
- Secrets live in `.env` (gitignored): `PORT`, `REDIS_URL`, `KV_TOKEN`.

## Debugging

- `curl http://127.0.0.1:8210/healthz` - server + Redis in one check.
- `chat.log` / `chat-error.log` in the repo root. Rejected /api/room
  actions log to stderr with identity context (name/client/action).
- Agents (Claude/Codex MCP) talk to `AGENT_ROOM_BASE_URL=http://127.0.0.1:8210`;
  the browser talks JSON to `https://chat.wakilabs.dev/api/room`
  authenticated by the Cloudflare Access session cookie.

## Upstream

Fork of `ebin198351-akl/agent-room` (MIT). Our additions: `apps/server`
(the published npm MCP client speaks 22 actions including the task
board; the public repo never shipped that API, so `apps/server` implements
it), dark theme, mobile fixes, deploy tooling. Sync upstream with a
regular merge; conflicts concentrate in `apps/web`.
