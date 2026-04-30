# Known Gaps — MVP v0.1 (2026-04-11)

Findings from the final-implementation code review that we **intentionally did not fix** in the MVP. Each entry records what the spec claimed, what the code actually does, and the reasoning behind shipping with the gap.

If you come back to harden this into production, this file is the starting checklist.

## 1. `ALLOWED_ORIGIN` hardcoded to localhost in committed `wrangler.toml`

- **Spec §13:** "CORS on Worker allows the web app's origin only (not `*`) in production."
- **Reality:** `apps/worker/wrangler.toml` sets `ALLOWED_ORIGIN = "http://localhost:5173"` and has no `[env.production]` stanza. Deploying to a real domain will reject browser requests.
- **Why shipped:** MVP runs the web app from `localhost:5173` against a deployed Worker for dev. Fixing this requires deciding on a production domain, which hasn't happened. When you take the Worker to a real host, add `[env.production]` with the real origin or set it as a secret.

## 2. `casRoom` is not atomic — Lua script deferred

- **Spec §12.3:** "uses a small Lua script via Upstash's `/pipeline` endpoint to `GET + compare version + SET` atomically."
- **Reality:** `packages/upstash-client/src/rooms.ts` implements a plain read-mutate-write loop with a 3-attempt retry. The race window is real but small.
- **Why shipped:** Only the `participants` field ever goes through `casRoom`. Messages use atomic RPUSH. With typical MVP usage (a handful of humans per room, agents joining at most a few times a minute), the race is vanishingly rare and the worst case is a dropped heartbeat update. A Lua script is the right fix when you outgrow this.

## 3. Participants tab not implemented — resolved

- **Spec §5.4:** "Tabs: Discussion / Minutes / Participants"
- **Original reality:** `apps/web/src/screens/Room.tsx` had only Discussion and Minutes. Participants were visible only via the avatar stack in the header (max 5 shown).
- **Resolved:** Room now has a dedicated People panel with participant list, role, client type, host badge, kick controls, and presence status.

## 4. Presence staleness (gray-out after 60s) not rendered — resolved

- **Spec §5.4:** "participants fade to gray after 60s without a heartbeat."
- **Original reality:** `PRESENCE_STALE_MS` was defined in constants and `lastSeenAt` was updated via heartbeat, but nothing in the UI compared it for rendering.
- **Resolved:** The People panel now shows Listening, Online, or Idle using `listenUntil`, `lastSeenAt`, and `PRESENCE_STALE_MS`; idle avatars render muted.

## 5. AI draft response is buffered, not streamed

- **Spec §8.1:** "Response streams back; draft appears in composer."
- **Reality:** `apps/worker/src/handlers.ts` does `await anthropicResp.json()` and returns a single JSON payload. `apps/web/src/lib/ai.ts` also awaits the full response. A 500-token draft at ~70 tokens/sec takes ~7s to appear.
- **Why shipped:** Buffered is much simpler, works correctly, and most drafts are under 500 tokens = ~7s wait. Upgrade to SSE or a `ReadableStream` when UX latency is a real complaint.

## 6. `EXISTS room:{code}` collision check skipped

- **Spec §4:** "generate → `EXISTS room:{code}` → regenerate if taken"
- **Reality:** Both `CreateMeeting.tsx` and `room_create` in the MCP server just call `generateCode()` and `SET` the room. With 31⁹ ≈ 2.6×10¹³ combinations and ≤24h TTL, collision probability is negligible at MVP scale.
- **Why shipped:** Not worth the extra round trip for a non-problem.

## 7. `room_minutes` tool does not return cached minutes

- **Spec §10.2:** tool "returns the cached minutes, or the full history if no cache exists"
- **Reality:** `apps/mcp/src/tools.ts` always returns the raw transcript plus topic and participant list — never reads `room-min:{code}`.
- **Why shipped:** The spec's "cached minutes" semantics assume the MCP server invokes AI. In the implemented design the CC user's own Claude Code agent summarizes the transcript directly (it has native Claude access), so caching on the MCP side would be redundant. The cache still serves the web app at `room-min:{code}`. The tool description in `tools.ts` accurately describes the actual behavior; only the spec framing is stale.

## 8. `any` cast in MCP tool dispatch

- **Location:** `apps/mcp/src/tools.ts` — `const a = (args ?? {}) as Record<string, any>`
- **Why shipped:** The MCP SDK exposes `arguments` as `unknown` at the type level. A properly-typed per-tool interface would eliminate the cast. Worth doing when the tool set grows; MVP has 6 tools and they're all covered by the inputSchema declarations.

## 9. Toast.tsx dynamic-import warning at Vite build

- **Symptom:** Vite prints a warning that `Toast.tsx` is both statically imported (from `router.tsx` and `copy.ts`) and dynamically imported (from `Room.tsx`'s send-failure path), so it can't be split into its own chunk.
- **Why shipped:** Benign. Toast is in the main bundle either way. Pick one import style if the warning becomes annoying.
