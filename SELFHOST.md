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

## Project-backed rooms (T-18)

- Registry: `deploy/projects.json` is GITIGNORED (machine-specific
  absolute paths never leave this Mac; the repo carries only
  `deploy/projects.example.json`). Override location with
  `PROJECTS_FILE`. Maps slug ids to `{ name, root, docs: { role:
  relative/path } }`. Browsers/MCP clients only ever send project IDS;
  every path resolves server-side with realpath containment under
  `root` — `..`, absolute paths, and symlink escapes are all denied,
  and containment is re-checked immediately before the atomic rename.
- Canonical-source rule: the project's `tasks` doc (e.g.
  `docs/TASKS.md`) is the DURABLE ledger; the room's Redis board is the
  fast LIVE view (24h TTL). Task mutations in a project-attached room
  are DURABLE-FIRST: the ledger is written synchronously with the
  post-mutation board BEFORE Redis, so a ledger conflict or write error
  fails the mutation (409 LedgerConflictError) with the live board
  untouched — no silent split-brain. If Redis fails after a successful
  ledger write, the durable side is ahead (safe); the next sync
  reconverges. The managed section carries the human-readable tasks
  plus an embedded machine JSON block used to resume the board in
  future rooms (`attachProject` hydrates an empty board).
- Writes are atomic (tmp + rename) and only replace the marker-fenced
  section; all other file content is preserved. Hand-edits INSIDE the
  markers are detected via a hash EMBEDDED IN THE SECTION ITSELF
  (`wakichat:hash` line) — purely file-derived, so Redis restarts,
  restores, or room expiry can never silently authorize an overwrite.
  Resolve conflicts by reviewing the file and calling `projectSync`
  with `force: true`.
- Backup/rollback: the ledger is a normal tracked file — `git diff`
  audits every sync and `git checkout -- docs/TASKS.md` rolls back.
  The server never commits; committing stays deliberate.
- Registry is STRICT: a malformed file or any invalid entry makes every
  project API fail closed with a `ProjectRegistryError` (503) naming
  the problem; startup logs the validation result. A missing file is a
  valid empty registry.
- Writes hold an advisory `<ledger>.lock` (wx-created, pid+timestamp,
  stale >30s taken over with a warning) around the whole
  read → integrity → write sequence; the tmp file is wx-created 0600
  and unlinked on failure. A managed section WITHOUT a hash line
  ("legacy") is fail-closed like a tamper — `force` migrates it.
- Onboarding a project: pick "Create from a discovered repo" in New
  room or the Project tab — the server scans `PROJECT_SCAN_ROOTS`
  (default `~/workspaces`, colon-separated) for git repos and writes
  the registry entry itself (browser never sends paths); or hand-edit
  `deploy/projects.json`. Only the `tasks` role is ever written; all
  other roles are read-only through `/api/project/doc`.
- Tests: `npm -w apps/server test` covers malformed/invalid registry,
  traversal/absolute/symlink/symlink-swap denial, tamper + legacy
  fail-closed + force migration, idempotence, lock discipline (fresh
  lock refusal, stale takeover), serialization, and onboarding key
  forgery.

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
