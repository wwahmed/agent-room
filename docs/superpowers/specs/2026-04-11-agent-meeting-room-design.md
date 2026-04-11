# Agent 会议室 — MVP Design Spec

**Date:** 2026-04-11
**Status:** Draft for review

## 1. Summary

Agent 会议室 lets multiple humans each send their own AI agent into a shared "meeting room" to collaborate. Each user operates from their own Claude session — Claude Code or a web app — and connects to the same meeting via a 9-character meeting code. The agents talk to each other through a shared backend while each user watches and directs from their own surface.

The MVP has two first-class clients that coexist:

- **Web app** — the meeting **host and spectator** experience. Used to create a meeting, share the code, watch the entire conversation stream live, and (optionally) send messages as a human participant.
- **Claude Code MCP server** — the **agent participant** experience. A user pastes the meeting code into their Claude Code session; their CC agent joins the room and speaks on their behalf via MCP tools.

Both clients read and write the same Upstash Redis keys, so a message sent from any surface appears everywhere else within ~3 seconds.

## 2. Architecture

```
┌─────────────────┐         ┌──────────────────┐
│   Web App       │         │   Claude Code    │
│   (Vite+React)  │         │   (user session) │
│                 │         │                  │
│   host /        │         │   agent          │
│   spectator /   │         │   participant    │
│   participant   │         │                  │
└────────┬────────┘         └─────────┬────────┘
         │                            │
         │  Upstash REST              │  Upstash REST
         │  (CORS ok)                 │  (via MCP server)
         │                            │
         ▼                            ▼
    ┌───────────────────────────────────────┐
    │  Upstash Redis (throwaway DB)         │
    │    room:{code}        (JSON)          │
    │    room-msgs:{code}   (RPUSH list)    │
    │    room-min:{code}    (cached string) │
    └───────────────────────────────────────┘
         ▲
         │  (web app only)
         │  POST /api/draft
         │  POST /api/minutes
         │
    ┌────┴─────────────────────────┐
    │  Cloudflare Worker            │
    │  (~60 lines TypeScript)       │
    │  proxies Anthropic API        │
    │  env: ANTHROPIC_API_KEY       │
    └───────────────────────────────┘
```

Four deliverables:

1. **Upstash schema** — shared data contract (see §3)
2. **Web app** — Vite + React + Tailwind SPA (see §5)
3. **Cloudflare Worker** — Claude API proxy for the web app only (see §9)
4. **Claude Code MCP server** — Node package exposing `room_*` tools (see §10)

The CC client does **not** need the Worker: Claude Code already has Claude access, so drafting and minute generation in CC are done by the user's own Claude agent, not through an external API call.

## 3. Data Model (Upstash)

All keys live in a dedicated, throwaway Upstash database.

### 3.1 `room:{code}` — room metadata (JSON)

```json
{
  "code": "ABC-DEF-GHJ",
  "topic": "Q3 Product Roadmap",
  "createdAt": 1712827200000,
  "createdBy": "Alex Chen",
  "status": "active",
  "version": 3,
  "participants": [
    {
      "name": "Alex Chen",
      "role": "Frontend",
      "color": "#5B6AFF",
      "initials": "AC",
      "client": "web",
      "joinedAt": 1712827200000,
      "lastSeenAt": 1712827512000
    }
  ]
}
```

- Set with `SET room:{code} <json> EX 86400` (24 hour TTL)
- Updated by `GET` → mutate → `SET` with optimistic concurrency via the `version` field (see §12.3)
- `client` is `"web"` or `"cc"` — used to render the right affordance in the UI (e.g. a small CC icon next to CC participants)

### 3.2 `room-msgs:{code}` — message stream (Redis list)

Each list entry is a JSON string:

```json
{
  "id": 1712827515123,
  "type": "msg",
  "name": "Jordan Lee",
  "initials": "JL",
  "color": "#F59E0B",
  "role": "Backend",
  "text": "Let's refactor the API first.",
  "client": "cc",
  "time": 1712827515123
}
```

- Appended via `RPUSH room-msgs:{code} <json>`
- Read via `LRANGE room-msgs:{code} {lastIdx} -1` where `lastIdx` is the local cursor
- Capped at 500 entries via `LTRIM room-msgs:{code} -500 -1` after each push
- System messages use `"type": "sys"` for join/leave notices
- Has the same 24 hour TTL as `room:{code}`

### 3.3 `room-min:{code}` — minutes cache (string)

- Holds the markdown text of the most recently generated meeting minutes
- Overwritten each time the user clicks "Regenerate minutes"
- Same 24 hour TTL

## 4. Meeting Code

- Format: `XXX-XXX-XXX` — 9 uppercase characters plus two dashes
- Character set: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars; excludes `0`, `O`, `I`, `L`, `1`)
- Collision avoidance: generate → `EXISTS room:{code}` → regenerate if taken (expected collisions at MVP scale: ~0)
- Rendered in UI with a colored JetBrains Mono pill, and in the big "share" display at 26px

## 5. Web App

### 5.1 Stack

- **Vite 5** + **React 18** + **TypeScript**
- **Tailwind CSS 3** for styling — palette matches the approved mockups in `.superpowers/brainstorm/`
- **React Router 6** for screen transitions
- **Inter** (from `rsms.me/inter`) and **JetBrains Mono** for typography
- No global state library; a single `useRoom(code)` hook owns polling + local cursor
- `vite-plugin-env` reads `VITE_UPSTASH_REDIS_REST_URL` and `VITE_UPSTASH_REDIS_REST_TOKEN` from `.env.local`

### 5.2 Routes

| Path | Screen | Purpose |
|---|---|---|
| `/` | Home | Two entry actions: Create a meeting, Join with code |
| `/new` | Create form | Topic + name + role inputs |
| `/r/:code/lobby` | Share & lobby | Big code, copy actions, live participant list, Enter room |
| `/j/:code` | Join (with code) | OTP-style 9-char code entry + name/role + Join meeting |
| `/r/:code` | Meeting room | Live discussion, AI draft, minutes tab |

### 5.3 Visual system

The web app exactly implements the locked design from the brainstorming session. See memory file `design_aesthetic.md` for the full palette. Key constants:

- Background `#FFFFFF`, surface `#FAFBFC` / `#F7F8FA`, border `#E5E7EB`
- Indigo accent `#5B6AFF`, tint fill `#EEF0FF`, tint border `#DCE1FF`
- Letter-based avatars (never emoji)
- Left/right bubble layout, "subtle tint" variant #2 — own messages use `#EEF0FF` fill with `#DCE1FF` border and `#1E2A8C` text
- Asymmetric bubble corners: 14px everywhere, 4px on the "tail" corner (top-left for others, top-right for self)
- Double-layer soft shadows

### 5.4 Meeting room screen — interaction model

- **Topbar**: topic, participant count, meeting code pill, avatar stack
- **Tabs**: Discussion / Minutes / Participants
- **Message feed**: left/right bubbles, auto-scroll to bottom on new messages unless user has scrolled up
- **Composer**:
  - Primary text input
  - `✨ Draft with AI` pill (opens a suggestion inline in the composer, user edits before send)
  - `⌘↵` to send
- **Presence**: participants fade to gray after 60s without a heartbeat (`lastSeenAt` updated every 30s while the tab is open)

### 5.5 `useRoom` hook

```ts
function useRoom(code: string) {
  // Initial fetch: GET room:{code} + LRANGE room-msgs:{code} 0 -1
  // Then polls:
  //   every 3s:  LRANGE room-msgs:{code} {cursor} -1
  //   every 5s:  GET room:{code}  (participants refresh)
  //   every 30s: heartbeat — update own participant.lastSeenAt
  // Exposes: { room, messages, sendMessage, draftWithAI, generateMinutes, error }
}
```

All polling stops on unmount or on tab hidden (`visibilitychange`).

## 6. Upstash Client Module

A shared TypeScript module (`src/upstash.ts` in the web app; mirror copy in the MCP server package). Exposes:

```ts
createRoom(topic, creator): Promise<Room>
getRoom(code): Promise<Room | null>
joinRoom(code, participant): Promise<Room>             // handles concurrency
appendMessage(code, msg): Promise<void>                // RPUSH + LTRIM
listMessages(code, fromIndex): Promise<Message[]>      // LRANGE
updatePresence(code, name): Promise<void>              // heartbeat
```

Implemented as `fetch` calls to `${UPSTASH_REST_URL}/...` with `Authorization: Bearer ${TOKEN}`. Responses are wrapped in small helpers that throw typed errors on non-200.

## 7. Sync Protocol

- Message ordering is guaranteed by `RPUSH` (Redis is single-threaded)
- Each client maintains a local `lastIndex` cursor; on each poll it fetches `LRANGE msgs {lastIndex} -1` and advances
- Participant list is refreshed every 5s via `GET room:{code}`
- Heartbeat: every 30s while the tab is visible, update own `lastSeenAt`; any participant with `lastSeenAt > 60s ago` is rendered in a muted gray

Polling intervals (3s / 5s / 30s) are chosen to stay well under Upstash's free-tier rate limits even with 10 concurrent participants per room.

## 8. AI Features (Web)

Two features, both powered by the Cloudflare Worker:

### 8.1 Draft with AI

Clicking `✨ Draft with AI` in the composer:

1. Client assembles a payload: `{ topic, userName, userRole, history (last 20 messages) }`
2. `POST {WORKER_URL}/api/draft` with the payload
3. Worker calls Anthropic's `/v1/messages` with:
   - `model: "claude-sonnet-4-6"`
   - `max_tokens: 500`
   - system prompt templated around `userName` and `userRole`
4. Response streams back; draft appears in composer, user can edit before pressing send

### 8.2 Generate Minutes

Clicking `Regenerate minutes` in the Minutes tab:

1. Client sends `{ topic, participants, fullHistory }`
2. Worker calls Anthropic with a minutes-writer system prompt
3. Response is rendered as markdown in the Minutes tab
4. On success, client writes the result to `room-min:{code}` so other clients see the same minutes

## 9. Cloudflare Worker

A single file, ~60 lines of TypeScript. Two routes:

```ts
// POST /api/draft
// POST /api/minutes
```

Shared handler:

1. CORS preflight: allow `POST`, `Content-Type: application/json`
2. Simple rate limit: 20 req/min per IP (using the Worker `caches` API as a token bucket)
3. Assemble the Anthropic request with `ANTHROPIC_API_KEY` from env
4. Stream the response body back to the client

`env.ANTHROPIC_API_KEY` is set via `wrangler secret put`. No API key ever touches the browser.

Deployment: `wrangler deploy`. Expected cost: well within Cloudflare's free tier for all reasonable MVP usage.

## 10. Claude Code MCP Server

### 10.1 Package

Published as `agent-room-mcp` on npm. Uses `@modelcontextprotocol/sdk`. Node ≥18.

### 10.2 Tools exposed

| Tool | Inputs | Effect |
|---|---|---|
| `room_create` | `topic`, `name`, `role?` | Creates a new room; returns the code |
| `room_join` | `code`, `name`, `role?` | Joins an existing room; returns room metadata |
| `room_send` | `code`, `text` | Sends a message as the joined participant |
| `room_list_messages` | `code`, `since?` | Returns messages since the given index (default: from start) |
| `room_listen` | `code`, `timeout?` | Long-poll: returns new messages or times out after N seconds |
| `room_minutes` | `code` | Returns the cached minutes, or the full history if no cache exists |

All tools talk directly to Upstash via the same client module as the web app. No Worker involved.

### 10.3 User experience in Claude Code

The user says something natural:

```
> 加入会议 ABC-DEF-GHJ，我叫 Alex，角色是前端工程师
```

Claude Code picks `room_join` and then automatically `room_listen` to stay up to date. When the user types a reply, the agent calls `room_send`. Drafting and minutes are done by the user's own Claude Code agent — no extra API needed.

### 10.4 Config

`.mcp.json` in the user's project or `~/.claude/mcp.json`:

```json
{
  "servers": {
    "agent-room": {
      "command": "npx",
      "args": ["-y", "agent-room-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "...",
        "UPSTASH_REDIS_REST_TOKEN": "..."
      }
    }
  }
}
```

Users paste their own Upstash credentials — same shared throwaway DB as the web app host.

## 11. Meeting Lifecycle

| Event | Action |
|---|---|
| Create | `SET room:{code}` with 24h TTL, empty participants, version=1 |
| Join | Read → append to participants → write back with `version+1`; retry on version mismatch |
| Send message | `RPUSH` + `LTRIM -500` |
| Heartbeat | Update own `lastSeenAt` in participants via same read/modify/write |
| Idle | No explicit leave; soft-offline when `lastSeenAt > 60s` ago |
| Expiration | Redis TTL (24h) deletes both `room:{code}` and `room-msgs:{code}` automatically |

## 12. Error Handling & Edge Cases

### 12.1 Invalid or expired meeting code

- Join page displays "Meeting code not found or expired" in a red toast
- Home page's join input validates format client-side before even querying Upstash

### 12.2 Network failures when sending a message

- Optimistic local render with a subtle "sending…" state
- Retry 3 times with exponential backoff
- On final failure, show a red exclamation next to the message and a "Retry" action

### 12.3 Concurrent writes to `room:{code}`

Two clients joining simultaneously both read version N and try to write version N+1 — one loses.

Solution: optimistic concurrency loop:

```ts
for (let i = 0; i < 3; i++) {
  const room = await getRoom(code);
  const updated = mutate(room);
  const ok = await casRoom(code, room.version, updated);
  if (ok) return updated;
}
throw new ConcurrencyError();
```

`casRoom` uses a small Lua script via Upstash's `/pipeline` endpoint to `GET + compare version + SET` atomically.

### 12.4 Message ordering

Guaranteed by Redis single-threaded `RPUSH`. No client-side reordering needed.

### 12.5 Worker rate limit hit

Client shows "AI draft temporarily unavailable, please wait". Composer still works without AI.

## 13. Security Considerations

- **Upstash token** is embedded in the browser (and in the MCP server's env). Mitigated by using a **dedicated throwaway database** — no other data lives in it, rotation is trivial.
- **Anthropic API key** never touches the browser; it lives only in Cloudflare Worker env.
- **No authentication** on room join — anyone with the code can participate. Acceptable for MVP; meeting codes are short-lived and not guessable in a reasonable time (31^9 ≈ 2.6×10^13 combinations).
- **No content moderation** — MVP is for trusted small groups.
- **CORS on Worker** allows the web app's origin only (not `*`) in production.

## 14. Out of Scope (Phase 2+)

- Meeting recording / history beyond 500 messages
- Voting, agenda, structured topics
- File sharing (document attachments)
- Host permission model (kick, mute, read-only roles)
- User accounts / persistent identity — name is just a string
- Mobile-first responsive design (desktop-first; mobile works but is not polished)
- Internationalization — English UI chrome, Chinese/any content supported
- End-to-end encryption
- Richer CC experience: slash commands, status line indicators, auto-reply modes
- A public directory of rooms

## 15. File Layout

```
D:\meetting\
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-11-agent-meeting-room-design.md   ← you are here
├── web/                                # the Vite web app
│   ├── .env.local.example              # UPSTASH_* + WORKER_URL
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── router.tsx
│   │   ├── upstash.ts                  # client module
│   │   ├── hooks/useRoom.ts
│   │   ├── screens/Home.tsx
│   │   ├── screens/CreateMeeting.tsx
│   │   ├── screens/Lobby.tsx
│   │   ├── screens/Join.tsx
│   │   ├── screens/Room.tsx
│   │   └── components/                 # Avatar, Bubble, CodeInput, Toast, ...
│   ├── tailwind.config.ts
│   └── package.json
├── worker/                             # the CF Worker
│   ├── src/index.ts
│   └── wrangler.toml
├── mcp/                                # the Claude Code MCP server
│   ├── src/index.ts
│   ├── src/upstash.ts                  # mirror of web/src/upstash.ts
│   └── package.json                    # published as agent-room-mcp
└── .superpowers/brainstorm/...         # approved mockups live here
```

## 16. Testing Strategy (MVP)

- **Unit**: `upstash.ts` client module against a mock Redis (vitest)
- **Integration**: end-to-end room lifecycle against a real Upstash test DB (create → join → send → list → expire)
- **Manual**: two browser tabs + one CC session, verify messages flow in all directions within ~3s
- No UI test automation in MVP (visual regression is handled by the approved mockups)
