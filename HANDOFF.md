# AI Room — Session Handoff

> Living context for whoever picks this up next (future Claude session, Codex, Robin himself, anyone). When this doc and the code disagree, code wins — but read this first to understand **why** the code looks the way it does.

Last full update: 2026-05-01 (session that landed Vercel→R2 swap, custom domain, mute model, freemium watermark, Clerk wiring).

---

## 1. What this is

AI Room is the meeting room **where AI agents collaborate**. Multiple agents (Claude Code / Cursor / Codex CLI / Gemini CLI / Cline / Claude Desktop) join the same room via MCP; humans join via the web at `www.agent-room.com`. Output is a structured delivery report (Markdown + shareable URL) the host can hand to their client.

Strategic report at `z.html` (local, gitignored) — Robin should re-read it whenever drift is suspected.

---

## 2. Production state (as of this handoff)

| Surface | URL / version | Notes |
|---|---|---|
| Web | https://www.agent-room.com | Vercel-hosted SPA. apex `agent-room.com` 307→ www |
| Old web URL | https://agentroom.vercel.app | Still works (kept for backward compat); not advertised |
| MCP package | `ai-room-mcp@0.14.1` on npm | Published from `apps/mcp/` |
| Web hosting | Vercel (project: `agent-room`, team: `robins-projects-c9021b21`) | Robin's account |
| API routes | Vercel Functions in `/api/` (`upload.ts`, `delete-room-blobs.ts`) | Node runtime, multipart parser hand-rolled |
| AI proxy | Cloudflare Worker `apps/worker/` | `/api/draft`, `/api/minutes` proxying Anthropic |
| Room state | Upstash Redis (env: `VITE_UPSTASH_REDIS_REST_*`) | 24h TTL on rooms |
| Attachments | Cloudflare R2 bucket `agent-room` (account `4b1d47a794061271f52edec42a5b6526`) | public R2.dev URL `https://pub-29d616a4cdcd4a5da648e83c523c3e41.r2.dev` |
| Auth | Clerk (project `agent-room`, Robin's personal workspace) | Wired via `<ClerkProvider>` in main.tsx; **no SignInButton placed yet** — invisible until pay-to-unlock lands |
| Payments | **Not yet** — Robin in Stripe NZ KYC flow as Sole Trader | Pilot uses mailto: + manual PayPal/WeChat/Alipay |

Required Vercel env vars (Production / Preview / Development all):
- `VITE_UPSTASH_REDIS_REST_URL`, `VITE_UPSTASH_REDIS_REST_TOKEN`
- `VITE_WORKER_URL` (Cloudflare Worker base URL)
- `VITE_CLERK_PUBLISHABLE_KEY` (`pk_test_...` or `pk_live_...`)
- `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `VITE_STRIPE_PAYMENT_LINK` — Stripe Payment Link URL (test or live)
- `UNLOCK_SECRET` — server-only, ~32 random hex chars; rotates invalidates ALL outstanding unlock URLs
- `STRIPE_WEBHOOK_SECRET` — `whsec_...` from Stripe webhook config
- `RESEND_API_KEY` — `re_...` from resend.com
- `RESEND_FROM_EMAIL` — verified sender, e.g. `noreply@agent-room.com`

---

## 3. Architecture map

```
Browser (any visitor) ─── www.agent-room.com (Vercel SPA)
   │
   ├─ /api/upload          → R2 PutObject (S3 SDK pointed at r2.cloudflarestorage.com)
   ├─ /api/delete-room-blobs → R2 ListObjectsV2 + DeleteObjects (called from host's "End meeting")
   ├─ Upstash REST (direct from browser)  ── room state, messages, reports cache
   └─ Clerk Provider (invisible until payment flow asks)

MCP client (Claude Code / Cursor / Codex / Gemini / Cline / Claude Desktop)
   └─ ai-room-mcp@0.14.1 → Upstash REST (same room state)
        ├─ tools: room_create, room_join, room_send, room_listen, room_leave,
        │         room_list_messages, room_export, room_end, room_reactivate,
        │         room_minutes, room_watch, room_unwatch
        └─ hook (Stop / UserPromptSubmit / SessionStart) keeps agents listening
              actively across turn boundaries

Cloudflare Worker (apps/worker)
   └─ /api/draft, /api/minutes → Anthropic API (server-side key)
```

---

## 4. Key design decisions (the "why")

### 4.1 Mute model, not approval model
Earlier we shipped a "host approves new joiners" gate (canSpeak default false, host clicks ✓). Friction killed productivity in fast-moving rooms. Robin replaced it with: **everyone joins canSpeak=true; host can mute (`setMuted(target, client, muted)`) anyone they need to silence**. Same Slack/Zoom mental model.

`packages/upstash-client/src/rooms.ts` `joinRoom` materializes `canSpeak=true` for everyone. `appendMessage` still gates on `canSpeak !== false` — that's how a mute actually takes effect server-side. `MutedError` (with `NotApprovedError` as a deprecated alias).

Web UI: 🔇 Mute / 🔊 Unmute button on the host's view of each non-self participant. Self-mute banner says "You've been muted by the host" not "Waiting for approval".

### 4.2 Host-name lock via hostKey
Anyone with the room code can join with any name — but **not the host's name**, unless they hold the original `hostKey` (random secret generated at `createRoom`). Web stores it in `localStorage` at `room:CODE:hostKey`; MCP stores it in PPID-scoped state.

Why localStorage not sessionStorage: we want the host's accidentally-closed-tab → reopen-link → reactivate flow to work. sessionStorage dies on tab close.

`verifyHostKey()` is a pre-flight that callers MUST run before `joinRoom` when claiming `name === createdBy`. Without it: `HostNameTakenError`.

### 4.3 Persistent agent listening — Stop hook + room_listen long-poll
The biggest piece of behavior we engineered. Agents previously stopped listening after one response, missing later web messages. Fixed by:

- `room_listen` blocks up to 30s server-side waiting for messages, returns immediately on activity.
- Stop hook (`apps/mcp/src/hook.ts`) fires whenever an agent's turn ends. With ANY active room in PPID state, the hook holds open another 30s poll, then returns `{decision: 'block', reason: 'call room_listen now'}`. Bound at `MAX_BLOCKS_PER_CYCLE = 12` (~6 minutes of guaranteed presence).
- `bumpBlockStreak` advances per consecutive idle block; `resetBlockStreak` when real messages arrive (productive activity isn't penalized).
- `room_listen` periodically checks room state — returns `terminated: 'room_ended'` or `terminated: 'kicked'` and clears local state, so agents stop cleanly.
- `room_leave` tool added in 0.14.1 — agent calls this when host explicitly says "exit" / "退出会议" / "you can leave". Self-removes server-side and clears PPID state.

If you ever debug "agent stops listening", the order of investigation is:
1. Is the MCP client actually running 0.12.0+? (older versions don't have the hook upgrade)
2. Are hooks installed? (Stop / UserPromptSubmit / SessionStart in the client config)
3. Is `~/.ai-room/state-PPID.json` showing the room? (if not, hook can't keep alive)
4. Is `MAX_BLOCKS_PER_CYCLE` exhausted? (state.blockStreak ≥ 12 means cap hit)

### 4.4 Storage: R2, not Vercel Blob
Originally shipped Vercel Blob. Robin's Vercel account hit a 2FA recovery wall that locks the Storage tab; Blob couldn't be provisioned. **Swapped to Cloudflare R2** (S3-compatible, zero egress, cheaper at scale, doesn't need any Vercel security verification).

Implementation: `@aws-sdk/client-s3` pointed at `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`. R2.dev subdomain enabled for public reads. Object path is `rooms/{code}/{uuid}/{name}` so `delete-room-blobs` can prefix-scan + bulk-delete when the host ends the meeting.

The 5 R2 env vars in `R2_*` family handle config. Fallback: if any missing, `/api/upload` returns 503 with a clear "set these env vars" message — won't crash silently.

### 4.5 Custom domain
Bought `agent-room.com` from GoDaddy. DNS config: A `@ 216.198.79.1`, CNAME `www cname.vercel-dns.com` (Vercel later recommended a project-specific CNAME `c93ec2be665068a4.vercel-dns-017.com`; either still works). www is canonical, apex 307→www. `agentroom.vercel.app` still works but isn't advertised.

All hardcoded URLs in code (MCP `room_create` joinUrl, `room_export` reportUrl, README, INSTALL.md, scripts) point at `https://www.agent-room.com`. Verified post-deploy that `agentroom.vercel.app` shows up 0 times in production bundle.

### 4.6 Six MCP clients supported
Claude Code, Claude Desktop, Cursor / Windsurf, Codex CLI, Gemini CLI, Cline (VS Code). All use the same `mcpServers` JSON shape; only path varies. `npx ai-room-mcp init` has 7 options (6 install targets + print-only). The "Works with the agent stack you already use" hero strip on Home.tsx shows all 6 with branded badges.

### 4.7 Templates
5 room templates in `apps/web/src/lib/templates.ts`: Blank, Code Review, Incident Response, Strategy / Brainstorm, Delivery Planning, plus Feature Build (greenfield dev) and Bug Fix (reproduce → root-cause). 7 total. CreateMeeting picker autofills topic seed and suggests roles. When the host enters an empty room, opener message is sent once with `[DECISION]/[TODO]/[STATUS]/[RESULT]` marker conventions inline.

### 4.8 Structured artifacts → delivery report
`[DECISION] / [TODO] / [STATUS] / [RESULT]` markers in messages get parsed by `extractArtifacts()` (in `packages/shared/src/artifacts.ts`). Web Bubble inline-renders each marker as a colored chip; sidebar Outputs panel rolls last 8; `/r/CODE/report` page groups by kind. `buildRoomReport()` (in `packages/upstash-client/src/reports.ts`) prefers tagged decisions/todos over LLM heuristics — deterministic delivery output.

### 4.9 Six client lineup as the "neutral bus" pitch
Strategic report (`z.html` §3) calls neutrality the long-term moat. The Hero "Works with" strip on Home.tsx makes this concrete: Claude Code, Claude Desktop, Cursor, Codex, Gemini, Cline. Don't drop one — the lineup IS the differentiation vs Cursor / Replit / single-vendor stacks.

---

## 5. Pricing strategy (decided this session)

**Three-tier freemium, value captured at delivery moment:**

```
Free (forever, anonymous, no signup)
└─ Unlimited rooms, all features, 24h TTL
   Reports carry "Made with AI Room" watermark + 30-day URL TTL

$19 per report (one-time, sign in to pay)
└─ Unlock specific report: remove watermark, lifetime URL,
   add custom logo + client name, custom short link
   Use case: AI consultant delivering a project to a client

$99 / month (Team)
└─ Unlimited reports, 90-day retention, team workspace,
   Slack/飞书 webhooks, priority support
   Use case: Dev team running review/incident/planning rooms continuously
```

Why we DIDN'T pick:
- Per-agent / per-message / per-minute: granular, customer mental-model mismatch, hard to predict billing
- Per-room-count: discourages experimentation
- Pure subscription: high friction for ad-hoc consultants

What we DID pick: capture value at the **moment the user gets concrete value** (handing report to their customer). Free tier exists to drive adoption and earn organic distribution via the watermark.

Implementation status:
- ✅ Watermark in report HTML page (FreeTierFooter component)
- ✅ Watermark line in Markdown export
- ✅ Pricing section on landing page (USD, both tiers)
- ✅ Clerk wired (invisible until used)
- ✅ Unlock-token URL flow (`/r/CODE/report?unlock=TOKEN`) — HMAC-SHA256 over room code with `UNLOCK_SECRET`, validated server-side via `/api/unlock-verify`, persisted in localStorage
- ✅ Stripe Payment Link integration in FreeTierFooter (passes room code as `client_reference_id`)
- ✅ `/r/unlock-pending` redirect target after successful checkout
- ✅ Stripe webhook (`/api/stripe-webhook`) — signature verified, extracts code + email, sends unlock URL via Resend
- ✅ End-to-end manual flow tested in sandbox with test card 4242 (commit 6a971b1, validated 2026-05-01)
- ⏳ Stripe live mode (KYC in review at handoff time)
- ⏳ Resend account + domain verification (`agent-room.com` SPF/DKIM)

---

## 5b. Payment infrastructure runbook

### Pilot manual flow (when webhook isn't wired or down)
1. Customer clicks "Unlock $29" on report page → goes to Stripe with `?client_reference_id=ROOMCODE`
2. Customer pays
3. Robin sees payment in Stripe dashboard → 交易 tab → click into the payment → note `client_reference_id` and `customer_email`
4. Robin runs locally:
   ```bash
   ROOM=THE-ROOM-CODE
   SECRET=$UNLOCK_SECRET   # set in shell from Vercel env
   TOKEN=$(node -e "console.log(require('crypto').createHmac('sha256','$SECRET').update('$ROOM').digest('hex').slice(0,16))")
   echo "https://www.agent-room.com/r/$ROOM/report?unlock=$TOKEN"
   ```
5. Robin emails the URL to the customer

### Automated flow (with webhook + Resend)
1. Customer clicks Unlock → pays → Stripe redirects to `/r/unlock-pending`
2. Stripe sends `checkout.session.completed` event to `/api/stripe-webhook`
3. Webhook verifies signature → extracts code + email → computes HMAC unlock token
4. Webhook sends email via Resend API (templated HTML + plain text)
5. Customer opens unlock URL → /api/unlock-verify validates → localStorage persists → watermark drops
6. Customer shares the clean `/r/CODE/report` URL with their client

### Sandbox → Live mode switch
1. KYC must be approved (Stripe dashboard top-right; banner clears when done)
2. Stripe dashboard top-left dropdown → switch from "AI Room 沙盒" to "AI Room"
3. Live mode is a SEPARATE object space — recreate everything:
   - 产品目录 → + 创建产品 → "AI Room — Per Report Unlock" → US$29 一次性
   - + 创建付款链接 → with `重定向到 URL: https://www.agent-room.com/r/unlock-pending`
   - Get the live URL (no `test_` prefix)
4. Set up live webhook:
   - 开发人员 → Webhooks → 添加端点
   - URL: `https://www.agent-room.com/api/stripe-webhook`
   - Events: `checkout.session.completed`
   - Save → copy the **Signing secret** (`whsec_...`)
5. Update Vercel env vars:
   - `VITE_STRIPE_PAYMENT_LINK` → live URL
   - `STRIPE_WEBHOOK_SECRET` → live `whsec_...`
6. Vercel **Deployments** → Redeploy to inject the new env vars

### Resend setup (one-time)
1. [resend.com](https://resend.com) → sign up (5 min, free tier 3K emails/month)
2. Domains → Add Domain → `agent-room.com` → follow the DNS instructions:
   - In GoDaddy DNS, add the SPF / DKIM / DMARC TXT records Resend shows
   - Wait ~30 min for propagation, then click Verify
3. API Keys → Create API Key → copy `re_...` value
4. Set in Vercel:
   - `RESEND_API_KEY` = the `re_...` value
   - `RESEND_FROM_EMAIL` = `noreply@agent-room.com` (or whatever you verified)

If Resend domain verification gets stuck, fall back to `RESEND_FROM_EMAIL=onboarding@resend.dev` for testing — emails come from a Resend-owned domain but go through fine.

### Pricing decision (decided 2026-05-01, revised same day after Stripe NZ went live)
- **$19 USD per report** (revised down from $29 NZD — Stripe charges NZD, but landing/Payment Link priced in USD for global discoverability)
- **$99 USD/mo Team** (revised from $149)
- Strategic report §7 quoted $19-99 range; we now sit at both ends of it (entry + ceiling)
- Targeting AI consultants charging $1.5k-5k per project: $19 is 0.4-1.3% of their bill, near-zero friction
- After 3 paid pilots, ASK each customer: too high / right / too low. Adjust empirically (likely → $29 or $39 if "right" / "too low").
- Stripe Live product MUST mirror this — if landing says $19 and Stripe charges $29, refund storm.

### Free vs Paid principle (decided 2026-05-01)

The split rule, in one sentence: **"use it, free; give it to your client, $19."**

| Capability | Lives in Free | Why |
|---|---|---|
| Create rooms, send messages, host agents | Yes | Core UX — paywall here would kill adoption |
| All 6 MCP integrations | Yes | Cross-vendor neutrality is the moat; gating it kills the pitch |
| Image / file attachments | Yes | R2 free tier carries it cheaply |
| Room templates + structured artifacts | Yes | Differentiation, not a premium feature |
| **Markdown export** | Yes — and **clean (no watermark)** | The user's own data; we don't own a billboard on it |
| Transcript view | Yes | Self-use, no premium tier needed |

| Capability | Paid only | Why |
|---|---|---|
| Watermark removed from the **shareable report URL** | Yes | This is the moment value is captured — the customer's customer sees the brand |
| Permanent URL (vs 24h TTL) | Yes | Real increment: free reports expire from `/r/CODE/report` |
| Custom logo + client name in header | Yes | Brand-on-brand for the deliverable |

We do NOT artificially limit messages-per-room, agents-per-room, rooms-per-day, or transcript length. Those would damage core UX without buying meaningful conversion.

**Markdown export is unconditionally clean** — earlier versions had a "_Made with AI Room — pay $29_" footer. Removed because the Markdown is the user's own data; promotional copy on it is hostile UX. Front-matter in the YAML (`room: CODE`, `exported: ...`) provides provenance without being adversarial.

## 6. Customer validation plan (per strategic report §4)

**30-day target: 3 paid pilots. < 3 → reconsider positioning.**

What Robin needs to do (admin-side, not code):
1. Open NZ Sole Trader Stripe (in progress)
2. Set up PayPal me + WeChat + Alipay codes for pilot manual collection
3. Reach out to 10–20 candidates (AI consultants, dev teams, automation studios — global, mostly EN-speaking)
4. For each that engages: free pilot project, watch them use it, ask for $29 if they like the report
5. Track in spreadsheet: customer email, contact date, paid date, plan, churn reason

What's already in place to support sales:
- Pricing page on landing (`/#pricing`)
- Open Agent Room Protocol doc (`docs/AGENT_ROOM_PROTOCOL.md`) — "neutrality moat" credibility
- Cross-client install picker (6 options) — proof of cross-vendor support
- Six room templates — shows variety of use cases

What Robin should NOT do during pilot:
- Form a Limited Company (premature, NZ Sole Trader is fine for < $60k/year)
- Build full Stripe Checkout (mailto: + manual is enough until 3 paid)
- Add features that don't directly serve "ship a report to a paying customer"
- Migrate to AWS / GCP / Azure (none of these unblock pilot validation)

---

## 7. Operational gotchas

| Issue | Why | What to do |
|---|---|---|
| Vercel Storage tab is locked behind 2FA verification on Robin's account | He lost the recovery code | Don't try to use Vercel Blob; we're on R2. Recovery: open Vercel support case (24-72h), but not urgent |
| `agentroom.vercel.app` still resolves | Kept for backward compat after domain switch | Don't advertise it. New marketing → `www.agent-room.com` only |
| Codex / Claude Code may run old MCP version after our publish | They cache the npm package on session start | After publishing a new ai-room-mcp version, **restart the client** to pick it up. Force-refresh: `rm -rf ~/.npm/_npx` |
| Stop hook firing infinitely with no end | Local state still has the room after host says "exit" verbally | Newer 0.14.1 has `room_leave` tool — agents call it on host exit signal. Older versions: hand-edit `~/.ai-room/state-PPID.json` |
| Stripe NZ Tax — DON'T enable yet | Charges 0.5%/transaction or $75/mo, NZ Sole Trader < $60k/year doesn't owe GST | Uncheck Stripe Tax during onboarding. Re-enable only after passing NZ$60k threshold (and registering for GST with IRD) |
| Stripe Payment Link KYC delay | NZ Stripe KYC takes hours-to-24h | Use PayPal me / WeChat / Alipay during the wait. Test mode keys work immediately for code integration |
| The `npx ai-room-mcp init` command requires user to restart their MCP client | MCP servers load at parent process start | Document this in INSTALL.md (already done) |

---

## 8. What's next (priority order)

### Immediate (this week)
1. **Robin**: Finish Stripe NZ KYC, confirm PayPal me link, test manual collection flow
2. **Code**: Add `/r/CODE/report?unlock=TOKEN` flow — host pastes a magic URL after manual payment, watermark drops. Token can be hardcoded in env or stored in Upstash. ~1 hour work.
3. **Code**: Pricing page on landing — already has section, double-check it's prominent and CTAs work
4. **Robin**: Reach out to first 5 pilot candidates

### After 1-3 paid pilots
5. **Code**: Stripe Payment Link integration (replace mailto in FreeTierFooter)
6. **Code**: Webhook handler that auto-unlocks reports after Stripe payment
7. **Robin**: Lemon Squeezy backup as alternative for non-NZ customers

### After 5+ paid pilots
8. **Code**: Team plan + subscriptions
9. **Code**: Custom branding (client logo + name) on paid reports
10. **Code**: 90-day retention for paid reports (vs 24h for free)

### Backlog (don't do until forced)
- Migrate Upstash Redis → Cloudflare DO (only if WebSocket streaming is the differentiator)
- AWS / Azure / GCP migration (not until enterprise customer demands it)
- Mobile native client (web is enough)
- Self-hosted MCP option (only after enterprise interest)

---

## 9. Recent commit log (this session)

Roughly chronological:
- `a64edf2` Landing page redesign (max-w-3xl → max-w-6xl)
- `6e61945` Input UX (Enter to send, auto-grow), host kick, share-link identity fix, MCP presence contract
- `6472ed8` Structured artifacts + Markdown export
- `160dbcc` Participant listening status (presence indicator)
- `d604382` Room templates + presence
- `0d8e52a` Agent Room Protocol v0.1
- `bbfde51` Pilot pricing on landing
- `d5dbd93` Pricing in USD (was CNY)
- `b0dba4b` Install card height alignment fix
- `e36353b` ai-room-mcp 0.10.0 bump
- `0a8496f` Cline (VS Code) as 6th MCP client
- `278e95f` Feature Build + Bug Fix templates
- `9635e74` Durable host re-entry (localStorage hostKey) + auto-approve agents
- `de8a5ee` Vercel Blob attachments (initial — locked out)
- `fae41fb` Vercel Function format fix (504 timeout → @vercel/node)
- `edda45a` R2 swap (Blob → R2 via S3 SDK)
- `2ca382a` Domain migration (vercel.app → www.agent-room.com)
- `78d9736` Cleanup accidentally-tracked files
- `e8b30fa` Mute model (replace approval gate)
- `c10fc16` `room_leave` tool + self-removal
- `cff03de` Clerk auth wiring + free-tier report watermark

MCP versions published this session: 0.10.0, 0.11.0, 0.11.1, 0.12.0, 0.12.1, 0.13.0, 0.14.0, 0.14.1.

---

## 10. How to use this doc

- **Resume same project, same agent (me)**: I'll re-read this and the relevant code files. Skip re-explaining decisions; just tell me the next thing.
- **Hand off to Codex**: Give them this doc + ask "what's the next task per §8?"
- **Onboard a new contributor**: This doc + the protocol spec + a 30-min walkthrough of the codebase.
- **Robin debugging alone**: §7 (gotchas) is the most useful section.

If you make a non-trivial change, **update this doc** in the same commit. Stale handoff notes are worse than no notes.
