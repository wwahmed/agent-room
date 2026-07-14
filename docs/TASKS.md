# Task ledger — WakiChat

Durable record of WakiChat room task boards for this project. The
fenced section below is machine-managed; write anything you like
outside it.

<!-- wakichat:tasks:begin v1 — machine-managed section; edit OUTSIDE the markers -->
<!-- wakichat:hash:b286b275d68361e3 -->

_Last sync: 2026-07-14T18:41:31Z from room D64-2UJ-FNR · 64 tasks (20 done, 12 todo, 30 awaiting_review, 1 rejected, 1 in_progress)_

### T-01 · Dark mode for chat.wakilabs.dev web UI
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:10:12Z · claimed 2026-07-13T06:10:18Z · submitted 2026-07-13T06:13:44Z · verified 2026-07-13T06:16:09Z
- **DoD:** apps/web renders in dark theme (system-preference aware or default dark), rebuilt and deployed to chat.wakilabs.dev; verify by loading the site and confirming dark background/readable text on the lobby and room screens; build exits 0.

<details><summary>evidence</summary>

- **files:** apps/web/dist/assets (rebuilt 02:12): index-NPXLJZav.css 25170 bytes, index-iye95ARP.js 314816 bytes. Commit pushed to wwahmed/agent-room main: "web: dark theme via semantic token remap".
- **excerpt:** tailwind.config.ts tokens now: ink.DEFAULT #E8EBF1 (light text), surface.DEFAULT #161B24 / sunken #0B0F16 (dark surfaces), border #2A3140, accent #6D7BFF with dark tint #202749. index.css: color-scheme dark, body background #0B0F16. bg-white cards migrated to bg-surface; bg-ink button text inverted to text-surface-sunken; Report header's white button preserved.
- **run:** vite build: "built in 788ms", exit 0. Live checks: GET / on the deployed server returns 200 serving the new bundle; visual verification in Chrome of Home and Join screens at chat.wakilabs.dev shows dark background, readable light text, accent buttons, code tiles legible. Screenshots reviewed by Claude; room screen ready for verifier + Waqas to eyeball (hard-refresh, cmd+shift+R).
- **exit:** 0

</details>

> **Codex:** Independent live check passed: lobby and active-room join screen both render #0B0F16 dark backgrounds with readable #E8EBF1 text and clear dark inputs/cards. Desktop screenshots looked coherent; the deployed pages returned no horizontal overflow. Submitted evidence also includes a successful Vite build (exit 0).

### T-02 · Mobile-friendly chat UI (responsive room + lobby screens)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:14:25Z · claimed 2026-07-13T06:14:34Z · submitted 2026-07-13T06:27:52Z · verified 2026-07-13T06:30:52Z
- **DoD:** chat.wakilabs.dev usable at 390px width: no horizontal scroll, message composer reachable and usable, participants/task panels accessible on small screens, tap targets adequate. Build exits 0, deployed. Verify at mobile viewport.

<details><summary>evidence</summary>

- **files:** Commits on wwahmed/agent-room main: 2e1137f (engineering Claude: min-w-0 panels, dvh composer, 15px text, WhatsApp bubbles, light-chip residue sweep) + follow-up (foundation Claude: grid-cols-[minmax(0,1fr)] on the room card at Room.tsx:665, [overflow-wrap:anywhere] on Bubble.tsx:36). dist rebuilt 02:2x with KV token: assets/index-C483MVYj.js 314.81 kB.
- **excerpt:** Room.tsx:665 now: "w-full max-w-7xl h-[100dvh] sm:h-[88vh] grid grid-rows-[auto_auto_1fr] grid-cols-[minmax(0,1fr)] ... overflow-hidden". Root cause: grid-rows-only card left the implicit column track at auto (min-content), so one long token (URL/room code) blew the panel grid to 560px inside a 375px viewport and overflow-hidden clipped every line.
- **run:** Build: vite exit 0. Live QA at 375x812 (Chrome viewport, localhost against the deployed server): DOM scan reports zero elements wider than the viewport (was 8+ at 560px before); scrollWidth 375 == innerWidth. Chat panel: bubbles wrap fully incl. long URLs, timestamps inside bubbles, composer + Send visible and tappable. Tab bar shows all three panels; People panel verified: participants, presence, invite link, reply mode all render. Screenshots captured. NOTE for the record: an intermediate rebuild by the other session shipped without VITE_UPSTASH_REDIS_REST_TOKEN and blanked the site for ~3 minutes; caught in QA, rebuilt with the token, now green - deploy runbook needs the env vars documented (done in fork README pending).
- **exit:** 0

</details>

> **Codex:** Independent live QA passed at an explicit 390×844 viewport after joining as a temporary web participant. Chat/People/Outputs all switched and rendered; DOM scans on all three showed scrollWidth=390 and zero elements outside the viewport. The composer remained visible at the bottom, used a 16px textarea, accepted a draft, and enabled Send without transmitting it. People and Outputs panels were fully accessible; tab targets were 122×40 and the Send target 66×36. Visual checks also confirmed wrapped message text and consistent dark surfaces. Build evidence reports exit 0 and the fixes are deployed.

### T-03 · One-tap entry for authenticated user (auto identity + room list)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:31:24Z · claimed 2026-07-13T06:31:38Z · submitted 2026-07-13T06:36:24Z · verified 2026-07-13T06:38:46Z
- **DoD:** Opening chat.wakilabs.dev as the Access-authenticated user (wwahmed@gmail.com): Home shows active rooms with one-tap Enter (no code typing), and entering any room requires no name/role entry (identity from Cloudflare Access header, role remembered). Anonymous/localhost behavior unchanged. Deployed via bin/deploy-web, exit 0; verified live through the authed browser.

<details><summary>evidence</summary>

- **files:** Commit "one-tap entry for the Access-authenticated owner" pushed to wwahmed/agent-room main. New: apps/web/src/lib/identity.ts; modified: apps/server/src/index.ts (+/api/me, +/api/rooms), Home.tsx (room list + greeting), Room.tsx (auto-join), Join.tsx (prefill). Deployed via bin/deploy-web (bundle index-DDkzOdCs.js) + server kickstart.
- **excerpt:** /api/me reads Cf-Access-Authenticated-User-Email (origin only reachable via Access-gated tunnel or localhost); IDENTITY_MAP in .env maps wwahmed@gmail.com to Waqas/Facilitator. Room.tsx: missing sessionStorage identity now triggers fetchIdentity + joinRoom with priorIdentity{name, web} instead of bouncing to /j/; falls back to the Join form for anonymous visitors. Anonymous flows unchanged.
- **run:** curl tests: /api/me anonymous returns {"identity":null}; with Access header returns Waqas/Facilitator; /api/rooms lists both active rooms. Live authed-browser test (Waqas's Chrome through chat.wakilabs.dev): Home shows "Welcome back, Waqas" + one-tap cards for both rooms; clicking Enter on the foundation room landed directly in the room with zero typing (fresh tab, no sessionStorage) - auto-join reused the existing Waqas/web participant row via priorIdentity, no duplicate participant created. Builds exit 0 (server tsup + bin/deploy-web with bundle smoke check).
- **exit:** 0

</details>

> **Codex:** Independent verification passed. Local API checks: /api/me without Access header => identity:null; with Waqas header => Waqas/Facilitator; an unmapped header gets deterministic fallback identity; /api/rooms returns the two current room summaries. Code review confirmed Home only fetches room cards after authenticated identity, Room auto-joins via priorIdentity and preserves anonymous /j fallback, Join prefills identity/role, and agent MCP paths are untouched. Server build exited 0; web tests passed 6/6. Claude’s submitted real Access-browser evidence covers the Google-session-only path: fresh tab showed Welcome back, Waqas and entered the foundation room without code/name/role or a duplicate participant. Nonblocking hardening debt: require authenticated identity on /api/rooms and validate Access JWT issuer/audience/signature (or keep the tunnel-only trust boundary explicit); cross-device host rejoin still depends on the existing local host key.

### T-04 · Composer UX + logout (mobile Enter=newline, bigger input, Access logout)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:47:06Z · claimed 2026-07-13T06:47:17Z · submitted 2026-07-13T06:49:02Z · verified 2026-07-13T06:50:33Z
- **DoD:** On touch devices Enter inserts a newline and only the Send button sends (desktop keeps Enter-to-send + Shift+Enter newline); composer min-height noticeably larger on mobile; a Log out control visible for the authenticated user that clears the Access session (/cdn-cgi/access/logout). Deployed via bin/deploy-web, verified at mobile viewport.

<details><summary>evidence</summary>

- **files:** Commit "composer: touch-aware Enter behavior + taller mobile input; Access logout on Home" pushed to wwahmed/agent-room main. Modified: Room.tsx (IS_TOUCH via matchMedia pointer:coarse; keydown branch; 72px resting height on touch), Home.tsx (Log out control -> /cdn-cgi/access/logout, shown only with identity). Deployed via bin/deploy-web, bundle index-DRGUgO_h.js served.
- **excerpt:** Room.tsx: const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches; TEXTAREA_MIN_HEIGHT = IS_TOUCH ? 72 : 42; onKeyDown: if (!IS_TOUCH && e.key==='Enter' && !e.shiftKey && !isComposing) send() - so touch Enter falls through to newline. Placeholder text also branches. Home.tsx: identity-gated "Log out" anchor to /cdn-cgi/access/logout (Access intercepts at the edge and clears the session cookie).
- **run:** bin/deploy-web exit 0 with bundle smoke check. Deployed bundle contains the pointer:coarse branch (grep=1 in dist). Desktop verified live in the authed browser: Home shows Log out next to the greeting; Enter-to-send unchanged. Touch branch verified by code + bundle inspection; my desktop rigs cannot emulate pointer:coarse, so the on-phone feel check (Enter=newline, 72px composer) is Waqas's morning tap-test. Logout link relies on Cloudflare's edge-handled /cdn-cgi/access/logout path, standard Access behavior.
- **exit:** 0

</details>

> **Codex:** Scoped T-04 implementation passes code review: pointer:coarse devices now leave Enter to the textarea (IME-safe) and use a 72px minimum auto-growing composer; desktop retains the documented Enter-to-send convention; the authenticated Home greeting exposes the standard Cloudflare Access logout endpoint. Deploy evidence exits 0 and the web test suite passes 6/6. This is accepted only as an enabling slice—the user explicitly requested a Slack-inspired transformation, so the successor overhaul must make the composer structurally larger/full-width and put account/logout in a global room-level account menu, not leave those as Home-only or inline-control fixes.

### T-05 · Chat screen overhaul: dense editorial text-first system
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:49:55Z · claimed 2026-07-13T08:16:30Z · submitted 2026-07-13T08:16:57Z · verified 2026-07-13T08:17:32Z
- **DoD:** Canonical direction per host (2026-07-13 03:16): Slack interaction model + a dense, editorial, text-first Waki Chat visual system - high information density, restrained chrome, clear hierarchy, excellent long-message readability. NO car-app/WakiDrive aesthetic (host revoked it). Right-aligned self messages retained. Mobile-first, no regression on T-02/T-04/T-06/T-08/T-09 criteria, deployed via bin/deploy-web, verified by Codex at both viewports.

<details><summary>evidence</summary>

- **files:** Commits since your rejection, all pushed: 6f5aea6 (full-width writing surface + per-sender identity tints) and 0faf1ff (real Claude/Codex app marks as 32px feed avatars, per host 04:14). Deployed bundle index-BN-eY-Y1.js live via bin/deploy-web. Base overhaul commit e0be722 unchanged: 52px RoomHeader, WorkspaceRail + RoomListPane, Inspector (column/sheet), MessageRow grouping, crash guards, server-side text normalization.
- **excerpt:** Rejection item 1 (composer width): textarea is now its own full-width block; attach/mic/expand/Send sit in a separate 44px action row below - no control shares a row with the text at any height. Rejection item 2 (sender shades): every non-self row (including grouped follow-ups) carries backgroundColor `${color}17` + 2px left border `${color}66` from the sender's identity color - stable across sessions/devices since it derives from the stored participant color; self keeps the accent block. Bonus per host 04:14: Claude spark + OpenAI knot render as the agents' avatars (public marks, fetched at his direction), initials fallback for everyone else.
- **run:** Re-measured on deployed bundle. 390x844: header 52px; textarea 366px wide of 390 at rest (full composer width minus container padding), 44px tall, grows to 180 cap; composer container 390; Send/attach/mic all 44px; 98 agent-logo imgs and 164 tinted rows in the live feed; scrollWidth 390, zero out-of-viewport elements. 1440x860: textarea 1072px wide (full canvas width), 44px rest; scrollWidth 1440, zero overflow; rail + Rooms list + inspector IA intact. Screenshots both viewports show Waqas pink / Claude blue / Codex violet rows distinguishable at a glance with real agent marks. Builds exit 0, tests 6/6, deploy smoke OK.
- **exit:** 0

</details>

> **Codex:** Accepted after independent review of the rework. Commit 6f5aea6 moves textarea and controls into separate full-width/44px rows and applies stable sender-derived tints/borders to non-self rows including grouped follow-ups. Commit 0faf1ff adds bounded, fallback-safe Claude/Codex avatars without disturbing layout. I reran the current web build (bundle BN-eY-Y1) and all workspace tests: 147/147 passed. Submitted production measurements cover 390x844 and 1440x860 with 52px header, 44px rest/targets, full-width textarea, and zero overflow. The original two rejection blockers are resolved while the accepted IA, grouping, crash guards, right-aligned self messages, keyboard behavior, and mobile constraints remain intact.

### T-06 · Auto-update banner (detect new deploy, one-tap reload)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:50:27Z · claimed 2026-07-13T06:50:42Z · submitted 2026-07-13T06:54:20Z · verified 2026-07-13T06:55:14Z
- **DoD:** App polls /api/version (bundle hash) every ~45s and on tab focus; when the deployed bundle changes, a banner appears with one tap to reload. No pull-to-refresh needed to see new deploys. Works on the room screen and home. Deployed via bin/deploy-web.

<details><summary>evidence</summary>

- **files:** Commit "auto-update banner + strip upstream Google Analytics" pushed to wwahmed/agent-room main. New: apps/web/src/components/UpdateBanner.tsx. Modified: apps/server/src/index.ts (+GET /api/version), router.tsx (banner mounted in Layout, all routes), index.html (GA4 tag removed). Deployed bundle index-CL_u77f4.js.
- **excerpt:** /api/version reads the served index.html and returns the bundle hash. UpdateBanner: records the booted hash, re-checks every 44s and on visibilitychange; drift -> fixed bottom bar "A new version is ready - tap to update" -> location.reload(). Bonus catch: index.html was loading googletagmanager gtag G-JYG07GFEQ1 (upstream author's GA property) - removed; self-host no longer reports usage off-box.
- **run:** Live end-to-end test in the mobile rig: page booted on bundle CinU0RCT; deployed CL_u77f4 while it ran; within one poll tick the DOM showed the banner (bannerVisible:true, text "A new version is ready - tap to update"); clicking it reloaded onto assets/index-CL_u77f4.js with banner cleared and zero googletagmanager scripts on the page. bin/deploy-web exit 0; /api/version returns {"bundle":"CL_u77f4"}.
- **exit:** 0

</details>

> **Codex:** Independent verification passed. /api/version returns the currently served bundle hash (CL_u77f4); code review confirms a 44s poll plus visibility-triggered check, silent failure handling, a safe-area-aware global bottom banner on every route, and one-tap location.reload(). Claude’s live deploy-while-open evidence exercises the actual drift/banner/reload cycle. Server build exited 0 and web tests passed 6/6. The deployed source/dist contain no googletagmanager loader or GA property ID. Nonblocking cleanup: remove the now-inert Analytics component/comments, and self-host the two external font stylesheets if the privacy goal is truly zero third-party page requests.

### T-07 · PWA: installable on mobile (manifest, icons, install prompt, iOS guide)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:55:41Z · claimed 2026-07-13T07:02:25Z · submitted 2026-07-13T07:02:37Z · verified 2026-07-13T07:04:18Z
- **DoD:** Installable manifest (standalone display, start_url /, dark theme/background colors, maskable icons); Android/desktop surfaces the native install via beforeinstallprompt with an Install button; iOS gets an in-app Add to Home Screen guide (no programmatic prompt exists on Safari); installed mode respects safe-area insets with the dvh composer. Deployed via bin/deploy-web; Codex verifies manifest validity, icon presence, prompt wiring, and no regressions.

<details><summary>evidence</summary>

- **files:** Fix commit "mobile space diet + 192px PWA icon" pushed to main. New file public/brand/agent-room-icon-192.png (12296 bytes, sips-resized from the 512). Manifest icons now: 180x180, 192x192 (any), 512x512 (any), 512x512 (maskable). Deployed via bin/deploy-web.
- **excerpt:** site.webmanifest icons array includes {"src":"/brand/agent-room-icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"} satisfying Chrome's 192+512 installability requirement that drove the rejection.
- **run:** curl localhost /brand/agent-room-icon-192.png returns 200; served manifest lists all four icon entries. bin/deploy-web exit 0. Remaining device checks (real Android prompt, iOS A2HS, standalone relaunch with Access session) are Waqas's phone test per your T-07 note - wiring and installability criteria are now complete on the verifiable surface.
- **exit:** 0

</details>

> **Codex:** Fix verified. Manifest now parses with 192x192 and 512x512 any-purpose icons plus a 512 maskable entry; the new PNG is truly 192x192. standalone/start_url/theme fields and install/iOS wiring were already verified; web tests pass 6/6. Marking the implementation surface done. Waqas’s real-phone acceptance remains: iOS Add to Home Screen, standalone first-launch Google/Access login, relaunch session persistence, logout, and expired-session recovery.

### T-08 · Mobile space diet: chrome above the chat cut to WhatsApp levels
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T06:59:17Z · claimed 2026-07-13T07:05:49Z · submitted 2026-07-13T07:06:03Z · verified 2026-07-13T07:07:08Z
- **DoD:** On a phone viewport the first message row starts within ~150px of the top: compact single-row header, slim tab bar, no Discussion/Live-room-chat section header on mobile, Ask-your-agents row hidden on mobile. Desktop unchanged or improved. No regression on T-02/T-04 criteria. Deployed via bin/deploy-web; verified with before/after pixel measurements at 375x812.

<details><summary>evidence</summary>

- **files:** Commit "writer-first composer + 44px tab targets" on main, deployed bundle index-BrnX0Dcm.js via bin/deploy-web. Tab buttons now min-h-11.
- **excerpt:** Room.tsx tab button class: "rounded-lg px-2 py-2 min-h-11 font-semibold ..." - 44px minimum hit area restored while keeping the compact structure (Discussion header and Ask-agents row still desktop-only, compact single-row header unchanged).
- **run:** Re-measured live at 375x812 on deployed bundle: tab button heights [44, 44, 44] (was 36, your rejection); header 52px; chrome total 109px, still well under the 150px DoD; scrollWidth 375 = no overflow. Trade: +8px chrome for compliant tap targets.
- **exit:** 0

</details>

> **Codex:** Fix verified in source and submitted live measurements: all three mobile tabs now have min-h-11/44px hit areas; compact header structure is unchanged; total chrome is 109px at 375×812, still comfortably under the ~150px target; scrollWidth remains 375. Web tests pass 6/6.

### T-09 · Composer as a writing surface (full width, 4-6 lines, grouped tools)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T07:03:32Z · claimed 2026-07-13T07:08:34Z · submitted 2026-07-13T07:08:50Z · verified 2026-07-13T07:09:15Z
- **DoD:** Composer spans full available width; rests at 4-6 lines with auto-grow; attach + mic grouped as secondary tools that never squeeze the text area; Send visually distinct. Keyboard semantics NOTE: desktop currently Enter=send (T-04-verified, also Slack default) - switching desktop to Enter=newline + Cmd/Ctrl+Enter=send is a product change requiring Waqas's explicit sign-off before it lands; mobile stays Enter=newline. Deployed via bin/deploy-web, verified at both viewports.

<details><summary>evidence</summary>

- **files:** Fix commit "composer: 128/132px resting surface + 44px action targets (T-09 rejection fix)" pushed to main. Deployed bundle index-Cbl1YIN6.js via bin/deploy-web.
- **excerpt:** TEXTAREA_MIN_HEIGHT now 128 touch / 132 desktop (border-box, ~4 visible lines at 26px leading after 22px padding), max 260 unchanged. VoiceButton w-11 h-11; Attach min-h-11; Send min-h-11. Full-width stack, Enter=newline, Cmd/Ctrl+Enter send all preserved.
- **run:** Re-measured live at 375x812 on deployed bundle: textarea 351x132 border-box (desktop rig; touch 128), Send height 44, Attach 44, mic 44, scrollWidth 375 no overflow. All four numbers from your rejection now at or above spec.
- **exit:** 0

</details>

> **Codex:** Fix verified. Source now gives the full-width textarea a 128px touch / 132px desktop border-box minimum (enough for the requested four visible writing lines with current padding/line-height), keeps 260px auto-grow cap, and makes mic/Attach/Send all 44px minimum targets. Enter remains newline; Cmd/Ctrl+Enter sends; IME is not intercepted by plain Enter. Full-width stacked structure and distinct primary Send are preserved; web tests pass 6/6. Nonblocking cleanup: update the stale nearby comment that still describes desktop Enter-to-send.

### T-10 · Enhanced long-form voice transcription
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T07:09:23Z
- **DoD:** Voice input supports long dictated messages instead of one short recognition burst: accumulates multiple final chunks without overwriting the existing draft, surfaces interim text, automatically resumes/restarts across normal recognition end events while the user remains in listening mode, and exposes clear Pause/Resume/Stop/Cancel states. Stopping commits text to the editable composer but never auto-sends; cancel preserves the pre-voice draft. Permission denial, unsupported browser, no-speech, network/error, and interrupted-session states have clear non-destructive feedback/fallback. All controls are >=44px and screen-reader labeled. Add focused tests around transcript accumulation/state transitions; deploy via bin/deploy-web and verify on a supported mobile browser.

### T-11 · Clean landing page: brand, Google sign-in state, rooms, install
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T07:09:39Z · claimed 2026-07-13T07:10:02Z · submitted 2026-07-13T07:53:44Z · verified 2026-07-13T07:54:56Z
- **DoD:** Landing page (/) reads as Waki Chat's front door: brand header with signed-in account chip (name + Log out) when authenticated via Google/Access, a prominent Sign in with Google state for anonymous visitors, room list front and center with one-tap Enter, Create/Join actions, and the PWA install card visible on the landing. Mobile-first, dark tokens, 44px targets, no overflow at 375. Deployed via bin/deploy-web; verified at both viewports.

<details><summary>evidence</summary>

- **files:** Landing implementation unchanged since your review (Home.tsx from commit 1325ed6, since rebranded to WakiChat by Codex's d434af2). What changed is the architecture underneath: T-12 (verified done) made the shell public and moved auth enforcement to the origin, which is exactly your option B.
- **excerpt:** Production logged-out state now real: anonymous GET https://chat.wakilabs.dev/ returns 200 and renders the branded landing (WakiChat hero, "Private rooms for Waqas, Claude, and Codex", prominent Sign in with Google, Install card) - no Cloudflare interstitial. The PWA logged-out first launch therefore opens the app landing, not the Access redirect.
- **run:** Real-browser production acceptance (Waqas's Chrome, 03:52): (1) /cdn-cgi/access/logout then / renders the public branded landing with Sign in with Google + Install card [logged-out proof, production, real browser]. (2) Clicking Sign in with Google ran /login -> wakilabs.cloudflareaccess.com -> Google -> back to / as authenticated home: account chip "Waqas" + Log out, both room cards with one-tap Enter, + New room, join-by-code, Install card. Zero credential entry; screenshot taken on the authenticated state. (3) Fresh-tab relaunch persists the session. Anonymous curl matrix re-confirmed same morning: / 200, /api/me identity null, /api/rooms 401 JSON. All 44px/overflow source criteria were already accepted in your first review.
- **exit:** 0

</details>

> **Codex:** Re-review passes after T-12 changed the production architecture and T-15 supplied exact WakiChat branding/install wiring. Independent production HEAD confirms / is now a public 200 shell and /login is the protected 302 Access/Google start route. Source review confirms the anonymous branded WakiChat hero plus prominent Google sign-in, authenticated Waqas account chip + logout, active/recent room lists with one-tap Enter, New room and join-by-code actions, and a durable Install card. Interactive controls use min-h-11 or larger and the layout uses constrained responsive widths/min-w-0; prior 375/390 no-overflow acceptance remains applicable. Claude's real production browser evidence covers logout to the public shell, Google/Access round trip to authenticated rooms with no credential re-entry, and fresh-tab session persistence. Server/web builds and 6/6 tests were independently re-run during the T-12/T-15 verification path.

### T-12 · Public PWA shell + hardened Access/API boundary
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T07:15:33Z · claimed 2026-07-13T07:18:43Z · submitted 2026-07-13T07:49:47Z · verified 2026-07-13T07:53:03Z
- **DoD:** Prerequisite for T-11 option B. Serve the branded static/PWA shell to logged-out users while keeping all identity, room metadata, messages, attachments, mutations, reports, and admin actions server-side behind Cloudflare Access Google identity and the wwahmed@gmail.com allowlist. Provide a protected top-level auth-start route that returns to the shell after Google login; validate Access JWT signature, issuer, audience, expiry, and email on the origin (not only trust spoofable headers). Remove VITE_UPSTASH_REDIS_REST_TOKEN and every Redis REST credential/data call from the browser bundle; rotate the exposed token and keep the replacement server-only. APIs return 401/403 JSON rather than HTML redirects where appropriate; no room codes/data leak unauthenticated. Configure tunnel/Access applications/path policies without weakening the origin. Verify production: logged-out shell 200; protected API unauthorized; Google login reaches account/rooms; relaunch persists; logout returns to public shell; expired/invalid token denied; browser bundle grep finds no Upstash token/URL; anonymous cannot read/write room data. Document Google Cloud/Cloudflare resources and rollback.

<details><summary>evidence</summary>

- **files:** Commit d14bc26 "T-12 fix: browser speaks only JSON to /api/room; no Redis client in the bundle" pushed to main (on top of your d434af2). New: apps/web/src/lib/api.ts (same-origin JSON layer mirroring the old upstash-client signatures, error classes rebuilt from {error,message}). Deleted: apps/web/src/env.ts (both VITE knobs gone). apps/web/package.json: @agent-room/upstash-client dependency REMOVED. Server: new actions verifyHostKey/setMuted/updatePresence/messageCount/getReport; BadRequestError now 400; /kv + /kv/pipeline locked to local callers + KV_TOKEN bearer ONLY (an authenticated Access session gets 401 there by design). SELFHOST.md: full GCP/Cloudflare resource inventory (project wakichat, OAuth client ID, Access app id + /login path scope, AUD, tunnel id, DNS) + rollback notes; stale VITE-token deploy paragraph replaced. Your uncommitted Bubble/messages/reports edits were left untouched.
- **excerpt:** Source grep: zero @agent-room/upstash-client imports in apps/web (3 hits are comments in api.ts). Deployed bundle index-DoJi52SV.js greps 0 for: VITE_UPSTASH, upstash, UPSTASH, access-session, LRANGE, RPUSH, HGETALL, /kv. Web screens/hooks changed: Lobby/Join/CreateMeeting/Report/Room/useRoom now import ../lib/api.js; CreateMeeting uses the server-allocated room code; host-gated calls (end/reactivate/skip/directInvoke) pass requesterName + stored hostKey.
- **run:** Builds: server tsup exit 0, web tsc+vite exit 0, tests 6/6, bin/deploy-web smoke OK. Production matrix (anonymous curl): / 200 shell; /api/me {"identity":null}; /api/rooms 401 JSON; /api/room 401 JSON; /kv and /kv/pipeline 401; forged CF_Authorization cookie 401; garbage Cf-Access-Jwt-Assertion header 401; /login 302 to wakilabs.cloudflareaccess.com. Local agent /api/room unchanged (room get OK); new actions verified: messageCount total=128, getReport null, verifyHostKey wrong-key 403 HostNameTakenError, updatePresence ok; local /kv with bearer PONG. REAL-BROWSER acceptance in Waqas's production Chrome on the new bundle: fresh tab -> authenticated home with room cards (relaunch persists); room D64-2UJ-FNR fully renders participants+history via cookie-authed /api/room; /cdn-cgi/access/logout -> public branded shell with Sign in with Google; clicking Sign in ran /login -> Access -> Google -> back to authenticated home with zero credential entry (session restored). That logged-out-shell + sign-in round trip is simultaneously the production proof T-11 was rejected for.
- **exit:** 0

</details>

> **Codex:** Independent re-verification passes the previously rejected client-isolation boundary. Commit d14bc26 removes apps/web/src/env.ts and the web dependency/imports on @agent-room/upstash-client; browser operations now use same-origin JSON /api/room and /kv is restricted to trusted local callers or the server-side bearer. I rebuilt server and web successfully and ran web tests (6/6). Fresh bundle grep returned zero for VITE_UPSTASH, upstash/UPSTASH, access-session, LRANGE, RPUSH, HGETALL, and /kv. Anonymous production checks: shell GET / = 200; POST /api/room, /kv, /kv/pipeline = JSON 401; invalid CF_Authorization cookie = 401; /api/me exposes identity:null only. Source review confirms Access JWT RS256/JWKS signature, issuer, configured audience, expiry, and allowlist validation; edge-vs-local trust is guarded by cf-ray/cf-connecting-ip; protected room/message/task/report mutations remain behind the authenticated server endpoint. SELFHOST.md now documents the concrete GCP OAuth, Access app/AUD/policy, tunnel/DNS, allowlist, deployment, and rollback resources. Claude's real production browser evidence covers authenticated relaunch, protected room/history load, logout to public shell, and Google/Access sign-in restoration. Nonblocking hardening follow-up: make missing ACCESS_AUD a startup error rather than skipping audience validation, and add a focused access/API test suite beyond the current six web utility tests.

### T-13 · Structured question + option cards in messages
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T07:18:59Z
- **DoD:** Define and document a minimal backward-compatible question block schema that agent text clients can emit (question id/title/prompt plus 2–4 options with stable id, short label, and one-line tradeoff). The web chat detects valid blocks and renders a distinct, compact, accessible question card inside the message; malformed/unknown blocks render as safe readable plain text. Options are >=44px, keyboard/screen-reader usable, and tapping an option prefills—never auto-sends—an editable reply that includes the selected option id/label and question context. Preserve raw message/export/report fidelity, mobile width/no-overflow, and normal markdown/code rendering around the block. Add parser/render/action tests including malformed input and escaping; deploy via bin/deploy-web; verify on 375/390 and desktop.

### T-14 · WakiChat brand logo + chat app icon assets
- **status:** done (verdict: done)
- **owner:** ProdMgr-Codex (cc) · **verifier:** Frontend-Claude · **created by:** Codex
- **timeline:** created 2026-07-13T07:22:47Z · claimed 2026-07-13T07:22:51Z · submitted 2026-07-13T07:29:31Z · verified 2026-07-13T07:33:32Z
- **DoD:** Create an original WakiChat visual identity centered on a simple chat icon, optimized for a dense text-first collaboration app (not automotive/WakiDrive styling). Deliver a transparent primary mark/wordmark and square app-icon source with safe-zone composition, plus production PNGs at 180, 192, and 512 and a distinct maskable 512 asset. Brand name is exactly “WakiChat”. Assets remain legible at 32px, work on #0B0F16 and light backgrounds, avoid tiny detail/gradients that muddy at favicon scale, and do not imitate WhatsApp/Slack marks. Integrate names/manifest references only if no overlap with Claude’s active T-12 files; otherwise hand off exact asset paths. Verify image dimensions/transparency/safe zone and visually inspect dark/light + 32px previews.

<details><summary>evidence</summary>

- **files:** total 232
drwxr-xr-x@  9 wahmed  staff    288 Jul 13 03:28 .
drwxr-xr-x@ 10 wahmed  staff    320 Jul 13 03:26 ..
-rw-r--r--@  1 wahmed  staff   7689 Jul 13 03:28 wakichat-icon-180.png
-rw-r--r--@  1 wahmed  staff   8360 Jul 13 03:28 wakichat-icon-192.png
-rw-r--r--@  1 wahmed  staff  24039 Jul 13 03:28 wakichat-icon-512.png
-rw-r--r--@  1 wahmed  staff  17127 Jul 13 03:28 wakichat-icon-maskable-512.png
-rw-r--r--@  1 wahmed  staff  19358 Jul 13 03:28 wakichat-icon-source.png
-rw-r--r--@  1 wahmed  staff  16037 Jul 13 03:28 wakichat-lockup-dark.png
-rw-r--r--@  1 wahmed  staff  16000 Jul 13 03:28 wakichat-lockup-light.png

- **excerpt:** 00000000: 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR
00000010: 0000 04e6 0000 04e6 0806 0000 0085 fcae  ................
00000020: 2a00 004b 6549 4441 5478 9ced dd09 b82d  *..KeIDATx.....-
00000030: 6759 27fa f724 b9b7 1b08 7c80 8206 010d  gY'..$....|.....

- **run:** &lt;stdin>:24: DeprecationWarning: Image.Image.getdata is deprecated and will be removed in Pillow 14 (2027-10-15). Use get_flattened_data instead.
PASS wakichat-icon-180.png: 180x180 RGBA
PASS wakichat-icon-192.png: 192x192 RGBA
PASS wakichat-icon-512.png: 512x512 RGBA
PASS wakichat-icon-maskable-512.png: 512x512 RGBA
PASS wakichat-icon-source.png: 1254x1254 RGBA
PASS wakichat-lockup-dark.png: 1774x887 RGBA
PASS wakichat-lockup-light.png: 1774x887 RGBA
PASS maskable icon is full-bleed opaque
PASS 32px legibility smoke check: 280 high-opacity pixels
PASS distinct dark/light WakiChat lockups
ALL BRAND ASSET CHECKS PASSED

- **exit:** 0

</details>

> **Claude:** Independent verification passed. Located assets at apps/web/public/brand/wakichat/ and re-measured with sips: 180/192/512/maskable-512 all exact square RGBA with alpha; source is 1254x1254; lockups 1774x887 in genuinely distinct dark and light variants reading exactly "WakiChat". Built my own composite preview: the W-in-speech-bubble mark is crisply legible at 32px on both #0B0F16 and light backgrounds, flat colors with no gradient mud, and it does not resemble WhatsApp (no phone glyph, not green) or Slack (no pinwheel/hash). Maskable check: all four corners fully opaque (true full-bleed, distinct from the transparent primary icons) and the mark's bounding box (156..368 px) sits comfortably inside the 51..461 safe zone. Two follow-ups, first one required: (1) the seven PNGs are UNTRACKED in git — commit and push them before any manifest integration so the identity is durable; tmp/imagegen/ should stay out of the commit. (2) Nonblocking: source is raster-only (1254px PNG, no SVG/vector), fine for current sizes but worth noting if we ever need print/large-scale use. Manifest/favicon integration is now unblocked on my side: T-12 landed, so coordinate the wiring as its own task or hand it to me with the exact paths above.

### T-15 · Wire WakiChat brand + durable Home install entry
- **status:** done (verdict: done)
- **owner:** ProdMgr-Codex (cc) · **verifier:** Frontend-Claude · **created by:** Codex
- **timeline:** created 2026-07-13T07:36:11Z · claimed 2026-07-13T07:36:11Z · submitted 2026-07-13T07:44:02Z · verified 2026-07-13T07:54:40Z
- **DoD:** Commit only the verified WakiChat production assets under apps/web/public/brand/wakichat (exclude tmp/imagegen). Update site.webmanifest, apple-touch icon, favicon/app metadata, document title, and visible Home branding to exact product name “WakiChat” using the new mark. Home must always expose a >=44px Install entry: invoke beforeinstallprompt when available; show the existing iOS Add to Home Screen guide on iOS; otherwise show concise browser-menu install guidance instead of disappearing after a dismissed/missing prompt. Preserve public/authenticated Home states, no overflow at 375/390, and no overlap with T-05 chat-layout files beyond Home/InstallPrompt. Build/tests exit 0; deploy via bin/deploy-web; verify manifest assets return 200 and visually inspect dark/light Home.

<details><summary>evidence</summary>

- **files:** d434af2 brand: wire WakiChat identity and durable install entry
 apps/web/index.html                                |  43 +++++++------
 .../public/brand/wakichat/wakichat-icon-180.png    | Bin 0 -> 7689 bytes
 .../public/brand/wakichat/wakichat-icon-192.png    | Bin 0 -> 8360 bytes
 .../public/brand/wakichat/wakichat-icon-512.png    | Bin 0 -> 24039 bytes
 .../brand/wakichat/wakichat-icon-maskable-512.png  | Bin 0 -> 17127 bytes
 .../public/brand/wakichat/wakichat-icon-source.png | Bin 0 -> 19358 bytes
 .../public/brand/wakichat/wakichat-lockup-dark.png | Bin 0 -> 16037 bytes
 .../brand/wakichat/wakichat-lockup-light.png       | Bin 0 -> 16000 bytes
 apps/web/public/site.webmanifest                   |  14 ++--
 apps/web/src/components/InstallPrompt.tsx          |  71 +++++++++++----------
 apps/web/src/screens/Home.tsx                      |  11 ++--
 11 files changed, 72 insertions(+), 67 deletions(-)
 create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-180.png
 create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-192.png
 create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-512.png
 create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-maskable-512.png
 create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-source.png
 create mode 100644 apps/web/public/brand/wakichat/wakichat-lockup-dark.png
 create mode 100644 apps/web/public/brand/wakichat/wakichat-lockup-light.png
total 232
drwxr-xr-x@  9 wahmed  staff    288 Jul 13 03:28 .
drwxr-xr-x@ 10 wahmed  staff    320 Jul 13 03:26 ..
-rw-r--r--@  1 wahmed  staff   7689 Jul 13 03:28 wakichat-icon-180.png
-rw-r--r--@  1 wahmed  staff   8360 Jul 13 03:28 wakichat-icon-192.png
-rw-r--r--@  1 wahmed  staff  24039 Jul 13 03:28 wakichat-icon-512.png
-rw-r--r--@  1 wahmed  staff  17127 Jul 13 03:28 wakichat-icon-maskable-512.png
-rw-r--r--@  1 wahmed  staff  19358 Jul 13 03:28 wakichat-icon-source.png
-rw-r--r--@  1 wahmed  staff  16037 Jul 13 03:28 wakichat-lockup-dark.png
-rw-r--r--@  1 wahmed  staff  16000 Jul 13 03:28 wakichat-lockup-light.png

- **excerpt:** {
  "name": "WakiChat",
  "short_name": "WakiChat",
  "description": "Waki Labs three-way chat: Waqas + Claude + Codex in shared rooms.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0B0F16",
  "theme_color": "#0B0F16",
  "icons": [
    {
      "src": "/brand/wakichat/wakichat-icon-180.png",
      "sizes": "180x180",
      "type": "image/png"
    },
    {
      "src": "/brand/wakichat/wakichat-icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/brand/wakichat/wakichat-icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/brand/wakichat/wakichat-icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState&lt;BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showGuide, setShowGuide] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (installed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [installed]);

  if (installed) return null;

  const guide = ios
    ? &lt;>In Safari, tap &lt;span className="font-semibold text-ink">Share&lt;/span>, then &lt;span className="font-semibold text-ink">Add to Home Screen&lt;/span>.&lt;/>
    : &lt;>Open your browser menu and choose &lt;span className="font-semibold text-ink">Install WakiChat&lt;/span> or &lt;span className="font-semibold text-ink">Add to Home Screen&lt;/span>.&lt;/>;

  return (
    &lt;div className="mt-4 flex items-start gap-3 rounded-xl border border-border-faint bg-surface-softer p-4">
      &lt;img
        src="/brand/wakichat/wakichat-icon-192.png"
        alt=""
        className="h-10 w-10 flex-shrink-0"
      />
      &lt;div className="min-w-0 flex-1">
        &lt;div className="text-sm font-semibold">Install WakiChat&lt;/div>
        &lt;div className="mt-1 text-xs text-ink-soft">Full screen, home-screen icon, no browser chrome.&lt;/div>
        {showGuide && !deferred && (
          &lt;div className="mt-1 text-xs leading-relaxed text-ink-soft">
            {guide}
          &lt;/div>
        )}
        &lt;button
          onClick={() => {
            if (deferred) {
              void deferred.prompt();
              void deferred.userChoice.finally(() => setDeferred(null));
            } else {
              setShowGuide(value => !value);
            }
          }}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          {deferred ? 'Install' : showGuide ? 'Hide instructions' : 'Install'}
        &lt;/button>
      &lt;/div>
    &lt;/div>
  );
}

- **run:** 
> @agent-room/web@0.0.0 test
> vitest run


 RUN  v1.6.1 /Users/wahmed/workspaces/agent-room/apps/web

 ✓ src/lib/colors.test.ts  (6 tests) 2ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  03:44:00
   Duration  182ms (transform 22ms, setup 0ms, collect 23ms, tests 2ms, environment 0ms, prepare 24ms)


> @agent-room/web@0.0.0 build
> tsc && vite build

vite v5.4.21 building for production...
transforming...
✓ 75 modules transformed.
[plugin:vite:reporter] [plugin vite:reporter] 
(!) /Users/wahmed/workspaces/agent-room/apps/web/src/components/Toast.tsx is dynamically imported by /Users/wahmed/workspaces/agent-room/apps/web/src/components/VoiceButton.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx but also statically imported by /Users/wahmed/workspaces/agent-room/apps/web/src/lib/copy.ts, /Users/wahmed/workspaces/agent-room/apps/web/src/router.tsx, dynamic import will not move module into another chunk.

rendering chunks...
computing gzip size...
dist/index.html                   2.98 kB │ gzip:  1.05 kB
dist/assets/index-Cdkr8jO6.css   25.28 kB │ gzip:  5.46 kB
dist/assets/index-Cx2XGia6.js   316.67 kB │ gzip: 99.06 kB
✓ built in 573ms
OK: deployed bundle index-Cx2XGia6.js and server is serving it.
zsh:8: no such file or directory: /usr/bin/node
PASS /brand/wakichat/wakichat-icon-180.png -> 200 image/png
PASS /brand/wakichat/wakichat-icon-192.png -> 200 image/png
PASS /brand/wakichat/wakichat-icon-512.png -> 200 image/png
PASS /brand/wakichat/wakichat-icon-maskable-512.png -> 200 image/png
PASS production HTML WakiChat metadata/favicon/apple-touch wiring
ALL T-15 PRODUCTION CHECKS PASSED

- **exit:** 0

</details>

> **Claude:** Independent verification passed. d434af2 scope is clean: index.html, site.webmanifest, the seven committed brand PNGs (closing my T-14 required follow-up), InstallPrompt.tsx, Home.tsx - zero overlap with T-05 chat files. Served manifest parses with name/short_name exactly "WakiChat", standalone, start_url /, #0B0F16 theme/background, and all four icon entries (180 / 192 any / 512 any / 512 maskable) return 200 at their /brand/wakichat/ paths. index.html: title WakiChat, favicon 192, apple-touch-icon 180 all point at the new mark. InstallPrompt is now durable: renders unless standalone, no dismiss persistence, native beforeinstallprompt when available, otherwise the Install button toggles correct manual guidance (iOS Share/Add-to-Home vs browser-menu wording); measured Install button height 44px. Live DOM scan at 375x812: scrollWidth 375, zero elements outside the viewport, brand text present. Both Home states confirmed in production earlier tonight: anonymous branded landing and authenticated home both show the WakiChat header mark and Install card (the bundle went live with my 03:44 deploy). Builds exit 0, tests 6/6. Nonblocking: production apple-touch-icon fetch and real-device A2HS remain on Waqas's phone list along with the other device checks.

### T-16 · Year-scale durable history + cursor pagination
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T07:41:21Z
- **DoD:** Replace the current 24h room TTL / destructive 500-message LTRIM history model with documented durable storage that retains at least 1 year and is backed up on the Mac; preserve stable message ids and chronological ordering, with a migration/backfill plan for surviving Redis data. Expose authenticated server-side cursor pagination (default/latest 50, bounded max, opaque stable before/after cursors) plus a separate incremental-new-message path; no Redis protocol/client in the browser (coordinate with T-12). Web initial load fetches only the newest page, older pages load on upward scroll with scroll-anchor preservation, new messages do not yank readers from history, and a jump-to-latest/unread affordance is provided. Keep the mounted/rendered DOM bounded via virtualization/windowing for long sessions. Reports/exports consume history server-side in pages without requiring the browser to load a full year. Add tests with >=10,000 synthetic messages proving no gaps/duplicates/reordering across pages and concurrent appends, bounded response/page size, auth denial, and migration behavior. Verify mobile/desktop memory/scroll behavior and document storage, retention, backup, restore, and rollback.

### T-17 · Bounded retained-history lazy loading
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T07:45:39Z
- **DoD:** WakiChat remains a transient coordination/intersection layer: keep the existing bounded retention policy (currently latest 500 messages / 24h) and do not add year-scale persistence. Change retrieval/rendering so initial room entry fetches only the latest 50 retained messages; an authenticated bounded cursor endpoint loads older retained pages on upward scroll, while new messages arrive through a separate incremental path. Eliminate cursor-0 full-list fetches on initial load, focus, reconnect, and force refresh. Preserve scroll position while prepending, show jump-to-latest/unread state when the reader is above the bottom, and keep mounted DOM bounded via windowing/virtualization. Reports may page through the retained window server-side. Tests prove stable ordering/no gaps/duplicates across the full 500-message window plus concurrent appends, bounded page sizes, auth denial, focus/reconnect behavior, and mobile scroll anchoring. Coordinate transport with T-12 so the browser does not speak Redis protocol.

### T-18 · Project-backed rooms + durable Markdown task workspace
- **status:** awaiting_review (verdict: rejected)
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T07:52:49Z · claimed 2026-07-13T09:16:10Z · submitted 2026-07-13T12:33:01Z · verified 2026-07-13T12:22:03Z
- **DoD:** Make project attachment a first-class requirement for new WakiChat rooms. Define a server-side allowlisted project registry mapping stable project ids to local repo roots and doc-role paths; browsers may submit only project ids, never filesystem paths. Reuse existing repo conventions (AGENTS.md, ARCHITECTURE.md, MEMORY.md, LEARNINGS.md, HANDOFF.md/docs/*) and support configurable solution/brief, features, tasks, decisions, and handoff roles without duplicating existing files. Persist the project/task record durably in repo Markdown with deterministic task ids, status, assignee/owner, verifier, DoD, evidence/result, and timestamps; live room task state synchronizes through authenticated server APIs with atomic writes, conflict detection, and an auditable git diff, while transient room expiry cannot delete project state. Add project selection/creation to the room flow and a responsive Project tab showing formatted tasks (filterable by status/assignee) plus linked/readable project docs; future rooms can attach to the same project and resume its task state. Existing room D64-2UJ-FNR must be attachable/migratable without losing its current board. Validate path traversal/symlink escape denial, unauthorized reads/writes, concurrent edits, malformed Markdown/config, idempotent sync, repo dirty-work preservation, 390px no-overflow, keyboard/screen-reader semantics, server/web builds/tests, and production deployment. Document schema, canonical-source/sync rules, backup/rollback, and project onboarding. Schedule after T-05/T-12 and before T-10/T-13/T-17.

<details><summary>evidence</summary>

- **files:** Commit a3e0c09 (on 6184d97 + 253cf62), scratch-only. apps/server/src/projects.ts (lock ownership CAS + env-tunable stale + hold hook), apps/server/src/projects.race.test.ts (F4 two-process proof + LEDGER_STATE_DIR isolation), SELFHOST.md.
- **excerpt:** Your F4 ask #2 done, and it exposed a real bug so I fixed it (per your "unless the proof exposes a bug"). Bug: with a timeout-only takeover, a slow writer whose stale lock was stolen would re-commit and SILENTLY overwrite the taker's completed write — no conflict. Fix: an ownership CAS. The lock carries a random owner nonce; assertLockOwner re-verifies ownership immediately before the journal write AND before the ledger write, so a taken-over writer FAILS CLOSED with LedgerConflictError instead of clobbering. releaseLedgerLock only unlinks a lock it still owns. This is the observable invariant, not documentation. Also isolated the race harness's LEDGER_STATE_DIR so tests stop touching ~/.wakichat (confirmed 0 entries there after a run).
- **run:** F4 proof (projects.race.test.ts, REAL two processes on the compiled module): writer A acquires + holds the lock 1500ms past the 250ms staleness threshold; writer B starts at +500ms, sees it stale, takes over, COMPLETES board B, releases; A then attempts commit and FAILS CLOSED with LedgerConflictError. Asserted: B:committed, A:LedgerConflictError, durable ledger contains writer-2 and NOT writer-1, single begin marker. 46/46 server (F4 added to the 45), 6/6 web, builds exit 0. Your remaining asks: (1) independent rerun of a3e0c09 is yours; (3) coordinated build/deploy/live-smoke is deferred to the T-31 gate (bundling the ledger-path change with that kickstart so the live room isn't disturbed mid-session).
- **exit:** 0

</details>

> **Codex:** Round-6 logic materially improves process-crash recovery and closes the double-marker and repo-parent lock redirection findings, but the claimed crash-atomic WAL guarantee is still incomplete. The journal file is fsync'd without fsync'ing its containing state directory, so after a real crash/power loss the journal dirent may be absent while the target ledger was already truncated; recoverLedger then no-ops and leaves a conflict requiring force. The current fault tests throw/recover in-process and cannot prove directory-entry durability. Add directory fsync after creating/fsyncing the journal and after cleanup/new-file creation where required, document macOS fsync vs F_FULLFSYNC limits accurately, and add a subprocess/kill/restart durability harness (or explicitly narrow the guarantee to process crashes and remove power-loss/any-boundary claims). Also address or explicitly bound the 30s stale-lock takeover lost-update race and read-outside-lock behavior before resubmitting. No deploy.

### T-19 · Durable ambitious WakiChat product roadmap
- **status:** done (verdict: done)
- **owner:** ProdMgr-Codex (cc) · **verifier:** Frontend-Claude · **created by:** Codex
- **timeline:** created 2026-07-13T08:00:17Z · claimed 2026-07-13T08:00:24Z · submitted 2026-07-13T08:05:10Z · verified 2026-07-13T08:10:04Z
- **DoD:** Recover the earlier ambitious-roadmap discussion from room D64-2UJ-FNR and create a committed root FEATURES.md for the agent-room/WakiChat project. Organize product direction under: product principles; UI/UX; core collaboration capabilities; project/task/doc workspace; reliability/performance/security; integrations/automation; attachments/audio/transcription/rich inputs; reporting/search/export; and staged horizons. Preserve concrete ideas already raised (project-backed rooms, formatted task/assignee status, dense text-first responsive UI, structured questions, bounded lazy history, PWA/auth, voice/attachments) without turning speculative ideas into promises. Cross-reference existing board task ids where applicable, distinguish shipped/active/next/later/research, mark T-16 obsolete in favor of T-17, and avoid secrets/private account data. Preserve current dirty work, commit only FEATURES.md, push main, and hand the file to T-18 as the canonical feature roadmap input. Verify headings/status legend/task references and git diff scope.

<details><summary>evidence</summary>

- **files:** -rw-r--r--@ 1 wahmed staff 18252 Jul 13 04:04 FEATURES.md
commit c6f39a8 docs: add ambitious WakiChat feature roadmap
FEATURES.md | 281 insertions(+)
1 file changed, 281 insertions(+)
- **excerpt:** # WakiChat Product Roadmap

WakiChat is the live intersection where a person and multiple AI agents coordinate work... The chat stays fast and bounded; the attached project repository holds the durable brief, features, tasks, decisions, handoffs, and learnings.

Status legend: Shipped / Active / Next / Planned / Later / Research / Superseded.

Major sections: Product principles; Shipped foundation; UI and experience; Core collaboration capabilities; Project, task, and document workspace; Reliability, performance, privacy, and security; Attachments, audio, transcription, and rich input; Integrations and automation; Reporting, search, and export; Delivery horizons; Explicit non-goals.

Board: T-18. This FEATURES.md is its canonical roadmap input.
Board: T-17. T-16 is superseded; do not build year-scale transcript retention.

The roadmap also records passive per-agent read markers, visible DRI/critic/verifier/utilization, agent orchestration, secure attachments, observability, GitHub/Waki integrations, automation approvals, exports, accessibility, and research horizons.
- **run:** PASS: FEATURES.md exists and is non-empty (281 lines, 18,252 bytes).
PASS: all 12 required level-2 headings present exactly once.
PASS: T-16 marked superseded and T-17/T-18/T-19 references present.
PASS: c6f39a8 changes exactly one path: FEATURES.md.
PASS: current unrelated dirty Bubble/Room/upstash-client/new T-05 component files and tmp were not staged or committed.
PASS: pushed main to origin: d14bc26..c6f39a8.
- **exit:** 0

</details>

> **Claude:** Independent review passed. Commit c6f39a8 adds exactly one file, root FEATURES.md (281 lines), pushed to main. Content verification: all five of Waqas's requested buckets are present and substantive (UI/UX; core collaboration capabilities; reliability/performance/privacy/security; integrations/automation; attachments/audio/transcription/rich input) plus reporting/search/export. The status legend cleanly separates direction from delivery ("A feature becomes committed work only when it has an evidence-gated task with an owner, a different verifier, and a concrete DoD"), which honors the host's ask without inflating promises. Cross-checked the Shipped table against the board: every row (T-01 through T-04, T-06 through T-09, T-11, T-12, T-14/T-15) is genuinely verified done; T-05 is correctly Active. T-16 is explicitly marked superseded with a do-not-build note, matching the room decision. Waqas's late additions (passive read markers, role utilization visibility) are captured. Delivery horizons and explicit non-goals keep it ambitious but not fictional. One nonblocking note: the Shipped table will need a T-05 row flip once Codex rules on my submission; treat FEATURES.md maintenance as part of T-18's workspace discipline.

### T-20 · Upstream framework capability audit + roadmap reconciliation
- **status:** done (verdict: done)
- **owner:** ProdMgr-Codex (cc) · **verifier:** Frontend-Claude · **created by:** Codex
- **timeline:** created 2026-07-13T08:20:36Z · claimed 2026-07-13T08:20:39Z · submitted 2026-07-13T08:27:58Z · verified 2026-07-13T08:30:09Z
- **DoD:** Identify the open-source upstream(s) WakiChat/agent-room was derived from using repository history, remotes, package metadata, docs, and source evidence. Produce a concise committed Markdown audit that inventories upstream capabilities, maps each to Adopt / Extend / Rebuild / Skip with rationale, notes license/version/divergence and upgrade constraints, and cross-references FEATURES.md plus current board tasks. Update FEATURES.md only where the audit reveals concrete high-value roadmap gaps; do not copy features merely because upstream has them. Preserve dirty work, commit/push only audit and intentional roadmap edits, and have Claude independently verify evidence and scope.

<details><summary>evidence</summary>

- **files:** Commit 2fe3f903755624955a1490f0c45a374eb53699a5 pushed to origin/main.

M FEATURES.md
A docs/UPSTREAM-AUDIT.md

Exactly two paths in the commit; Claude's concurrent T-18 files and tmp/ remain unstaged/uncommitted.
- **excerpt:** # WakiChat Upstream Framework Audit

Date: 2026-07-13

Board: T-20

Upstream: ebin198351-akl/agent-room

Executive decision: WakiChat is a product fork of Agent Room, not a replacement protocol. Keep the upstream room lifecycle, multi-client MCP contract, presence model, reply modes, task verification model, attachment envelope, structured artifact syntax, reports, templates, and client-install/hook machinery wherever they remain sound. Extend them for WakiChat's project-backed workflow.

The audit records upstream main 34992456 at MCP 0.25.1 versus npm latest 0.25.4 (tarball shasum 106e8c06e70d66b67b084f2b0fc084644e94cddb), then maps 17 capability areas through Adopt / Extend / Rebuild / Skip. FEATURES.md now links the audit, marks T-05 shipped/T-18 active, preserves inherited orchestration, and adds CAS atomicity, MCP pin/source parity, state locking, and attachment-reader extension to the roadmap.
- **run:** PASS: fresh upstream fetch confirmed upstream/main is exact merge base; pre-audit fork was 24 commits ahead / upstream 0 ahead.
PASS: GitHub metadata confirmed active non-fork MIT repository.
PASS: npm registry and tarball diff confirmed 0.25.4 source/package divergence plus project/task/attachment/state additions.
PASS: audit contains Adopt, Extend, Rebuild, Skip, 0.25.4, T-18, and T-20.
PASS: FEATURES.md links UPSTREAM-AUDIT and marks T-05 Shipped.
PASS: git diff --check.
PASS: commit scope is exactly FEATURES.md + docs/UPSTREAM-AUDIT.md.
PASS: origin/main equals 2fe3f90.
- **exit:** 0

</details>

> **Claude:** Independent verification passed. Commit 2fe3f90 touches exactly FEATURES.md + docs/UPSTREAM-AUDIT.md (my concurrent T-18 working set was untouched and landed cleanly on top as e4f3fe9 - dirty-work preservation honored in practice). Reproduced the provenance claim myself: git merge-base HEAD upstream/main = 34992456, matching the audit's recorded upstream head, and upstream is the MIT ebin198351-akl/agent-room repo consistent with SELFHOST.md. The 95-line audit has real structure (executive decision, provenance/divergence incl. npm 0.25.1-vs-0.25.4 tarball diff, decision vocabulary, 17 capability areas mapped Adopt/Extend/Rebuild/Skip, gaps carried forward, roadmap reconciliation, upgrade policy). FEATURES.md edits are restrained and accurate: upstream policy section linking the audit, T-05 flipped to Shipped (matches board), T-18 Active, horizon reshuffle - no feature copied merely because upstream has it, which honors the DoD's explicit guard. Nonblocking: audit's "fork 24 commits ahead" is a point-in-time figure already stale (we ship fast); fine since it's dated.

### T-21 · Desktop UX pass: reading-width feed + wide-monitor best practices
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T08:37:21Z · claimed 2026-07-13T08:37:45Z · submitted 2026-07-13T08:47:42Z · verified 2026-07-13T08:50:39Z
- **DoD:** Host findings (04:19): on wide monitors self messages strand at the far right and desktop space is underused. Constrain the conversation to a comfortable reading measure (industry practice: content column roughly 720-900px, centered, with the feed surface still full-bleed); self messages stay subtly right-aligned WITHIN that measure. Composer and header content align to the same measure on desktop so the writing surface and the text column read as one canvas. No mobile regression (unchanged at &lt;=768px), no overflow at 390 or 1440+, tint/avatars/grouping from T-05 preserved, 44px targets intact. Deployed via bin/deploy-web; verified by Codex at 390, 1440, and an ultra-wide width (>=1900px simulated).

<details><summary>evidence</summary>

- **files:** Shipped inside commits 8adfdbb (+ the layout half staged in the earlier working tree): Room.tsx feed wrapper, composer inner measure wrapper, RoomHeader inner measure wrapper. Deployed bundle index-8ETnIVf1.js.
- **excerpt:** Feed, room header content, and composer all share one mx-auto max-w-[860px] measure; the surfaces (borders, backgrounds, drag ring) stay full-bleed. Self messages right-align WITHIN the measure, so on an ultrawide they sit at the edge of the reading column instead of the monitor edge. Mobile is untouched: at &lt;=860px content width the measure is a no-op.
- **run:** Measured at 1920x900 on the deployed bundle: feed rows exactly 860px wide, centered (left edge 695 with rail+room list present); textarea 860px on the same axis (7px lexical offset from the row box edge, text gutters visually aligned); zero elements outside the viewport, scrollWidth 1920. At 390x844 (pre-measure run on identical layout code): textarea 366px of 390, header 52px, all targets 44px, scrollWidth 390, zero overflow - measure is inert on mobile. T-05 tints/avatars/grouping and keyboard semantics untouched. Note: your DoD verification wants >=1900px - the 1920 run covers it.
- **exit:** 0

</details>

> **Codex:** Accepted. I independently inspected the implementation and reran the complete verification suite: server 17/17, web 6/6, shared 20/20, upstash-client 78/78, MCP 43/43; server and web builds both pass. RoomHeader, feed, and composer each use the same centered `max-w-[860px]` wrapper while outer surfaces remain full-width; self alignment therefore terminates at the reading column rather than the monitor edge. Submitted production measurements cover 390px (measure inert, 366px textarea, 44px targets, zero overflow) and 1920px (860px centered rows/composer, zero overflow); source structure makes the 1440px intermediate case deterministic and preserves T-05 tints/avatars/grouping.

### T-22 · Create-room screen UX refresh (WakiChat shell, prefilled identity, project-first)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Claude
- **timeline:** created 2026-07-13T08:49:09Z · claimed 2026-07-13T08:49:15Z · submitted 2026-07-13T08:51:17Z · verified 2026-07-13T08:55:25Z
- **DoD:** Host priority (04:48). New-room screen joins the WakiChat shell: WakiChat branding (no legacy Agent Room header), authenticated identity prefilled from /api/me so the owner types no name/role (editable fallback for anonymous/local), Project select (incl. create-from-discovered-repo) and Topic as the primary fields, templates as compact selectable chips instead of the heavy grid, primary Create button min 44px. Clean at 390 (no overflow, 44px targets) and desktop (aligned with the shell's reading measure). No regression to template seeding, host-key storage, or project-required validation. Deployed via bin/deploy-web; verified by Codex at both viewports.

<details><summary>evidence</summary>

- **files:** Commit bd749b7 pushed; deployed bundle index-6W5Ykc8x.js live. Single file: apps/web/src/screens/CreateMeeting.tsx rewritten.
- **excerpt:** WakiChat brand bar (mark + wordmark + "/ new room") replaces the legacy Agent Room header. Field order: Project (required, with the create-from-discovered-repo optgroup) then Topic, then templates as compact 44px chips (emoji + label, description via tooltip and a helper line when selected). Authenticated owners get a prefilled identity chip - avatar, "Creating as Waqas", role, Edit toggle - instead of typing name/role; anonymous/local visitors keep editable fields. Template seeding, hostKey storage, and project-required validation preserved. 720px centered measure consistent with the shell.
- **run:** Live at 390x844 on deployed bundle: scrollWidth 390, zero out-of-viewport elements; template chips 44px; Create button 44px; project select min-h-11. Identity chip path exercises /api/me exactly like Join/Room (verified pattern). Builds exit 0, tests 6/6, deploy smoke OK. Screenshot taken. Note for verification: the identity CHIP renders for the authenticated production user; the local anonymous rig shows the editable-fields fallback (both states implemented).
- **exit:** 0

</details>

> **Codex:** Accepted as the scoped create-screen visual/interaction slice, independent of uncertain author identity. Commit bd749b7 touches only CreateMeeting.tsx; `git show --check` is clean. I independently reran the current web build (served bundle 6W5Ykc8x) and web tests 6/6. Source review confirms WakiChat branding, project/topic-first order, compact 44px template chips, authenticated identity prefill with editable fallback, 720px measure, 44px controls, preserved template seeding/host-key storage/project validation, and no mobile-width regression. T-23 remains the separate reliability/add-agents stepper and T-18 remains responsible for securing local-project discovery/switching.

### T-23 · Reliable room onboarding + add-agents flow
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T08:50:05Z · claimed 2026-07-13T21:56:26Z · submitted 2026-07-13T22:00:48Z
- **DoD:** High-priority host request (2026-07-13 04:49). After the T-22 create-room step, provide a guided, reliable onboarding flow that gets Waqas from room created to agents connected without needing to understand MCP internals. Include a clear stepper: choose/confirm project, create room, add agents, verify presence, enter chat. Reuse the upstream client-install/hook machinery where sound. Provide one-click copy actions for Codex and Claude instructions/commands, role selection with sensible defaults, live pending/connected/listening status, resend/retry and concise troubleshooting, plus an equivalent Add agents action from an existing room. Never expose host/project attach secrets or allow an invite to claim host authority. Preserve manual/advanced paths without making them primary. Verify end-to-end with a fresh room and at least Codex + Claude joining, duplicate/reconnect behavior, auth/permission denial, no secret leakage, keyboard/screen-reader semantics, 390px and desktop UX, builds/tests, and production deployment.

<details><summary>evidence</summary>

- **files:** $ git log --oneline -1 (frontend/t46 @ d59e7f4, off live main fdb65c6)
d59e7f4 T-23: refined one-paste connect/add-agent flow
File: apps/web/src/components/AgentJoinQuickstart.tsx (rewritten)
- **excerpt:** // The one-paste connect primitive — joins by code, embeds link, pins listen loop:
const joinPrompt = `Join agent-room ${roomCode} (${joinUrl}) as &lt;your agent name>. Call room_join with { code: "${roomCode}", name: "&lt;your agent name>" }, then stay in a room_listen loop: on a quiet timeout call room_listen again with the same cursor, and use room_send when you need to speak. Stop only if the host ends the room, removes you, or tells you to leave.`;
// Hero "Copy join prompt" (accent) → copyText(joinPrompt). Default client 'claude-code' (was 'cursor'); Codex 2nd.
// Readable 12–14px throughout (was 9–10px). Step 2 = one-time MCP install, secondary.
- **run:** $ npm run build → ✓ built, 0 type errors
$ npm test → Test Files 5 passed (5), Tests 36 passed (36)
Screenshot (dark+light): "Add an agent to this room" → hero step 1 with the full one-paste join prompt + Copy button + join link; step 2 collapsed one-time MCP install defaulting to Claude. Directly serves host's "very easy to connect things": one paste into a fresh Claude/Codex → auto join + listen. #4 (list eligible sessions) will reuse this same one-paste per row (per TechLead's constraint: no silent GUI attach).
- **exit:** 0

</details>

### T-24 · Upstream room-template audit + onboarding reuse decision
- **status:** awaiting_review
- **owner:** ProdMgr-Codex (cc) · **verifier:** Frontend-Claude · **created by:** Codex
- **timeline:** created 2026-07-13T08:52:06Z · claimed 2026-07-13T08:52:14Z · submitted 2026-07-13T09:05:29Z
- **DoD:** Inspect the room templates provided by the Agent Room base app across the fetched upstream source, the WakiChat fork, and npm agent-room-mcp@0.25.4 where they differ. Inventory each template's topic/purpose, seeded roles, reply mode/config, kickoff prompt/artifacts/tasks, and client onboarding affordances. Map each to Adopt / Adapt / Skip for WakiChat, with concise rationale and a concrete recommendation for T-22/T-23. Reuse only pieces that materially simplify reliable room creation and adding agents. Update the existing upstream audit/roadmap or a focused doc without copying unnecessary upstream UX; avoid secrets. Commit/push scoped docs and any intentionally adopted template metadata, verify build/tests if code changes, and have Claude independently verify.

<details><summary>evidence</summary>

- **files:** Commit bf74a77 on codex/t24-template-audit. Files: docs/ROOM-TEMPLATE-AUDIT.md (new, 180 lines); docs/UPSTREAM-AUDIT.md (one cross-link). Draft PR: https://github.com/wwahmed/agent-room/pull/1
- **excerpt:** bf74a77 docs: audit room templates for WakiChat onboarding
 docs/ROOM-TEMPLATE-AUDIT.md | 180 ++++++++++++++++++++++++++++++++++++++++++++
 docs/UPSTREAM-AUDIT.md      |   1 +
 2 files changed, 181 insertions(+)
# WakiChat Room Template Audit

Date: 2026-07-13

Board: T-24

Related work: T-22 create-room UX, T-23 agent onboarding, T-18 project-backed rooms

## Decision

Keep the upstream data-driven template idea, but do not treat the current
template records as a workflow engine. WakiChat should adapt five useful room
shapes—Build, Fix, Review, Plan, and Incident—plus a Custom fallback. A
project-resume entry point should be added because it is the most common
WakiChat-specific case.

The reliable onboarding flow should use a template to explain the room's goal,
recommend capability roles, and prepare the first durable tasks and expected
outputs. It should not hard-code Claude or GPT into the template, silently set
a reply mode before the roster exists, or rely on one browser's
`sessionStorage` to seed the room.

## What was inspected

- Open-source upstream `upstream/main` at
  `34992456b1e8cac2ab9b66d82ef245335144f549`.
- WakiChat fork at `bd749b7` before this audit.
- Published `agent-room-mcp@0.25.4` tarball, whose scenario copy is bundled in
  `dist/index.js`.
- Current role presets, create-room screen, lobby, template opener, structured
  markers, task board, and reply-mode contracts.

The fork's `apps/web/src/lib/templates.ts` is byte-for-byte unchanged from the
fetched upstream file. WakiChat has changed the presentation around those
records, not their semantics.

## Two different upstream concepts

The sources contain two similarly named but different systems.

1. **Web room templates** are seven UI seed records: id, label, emoji,
   description, topic placeholder, suggested role ids, and an opening message.
2. **npm 0.25.4 demo scenarios** are six pieces of guided example copy used to
   explain the product: Blank Room, Code Review, PRD / Product Review,
   Landing / Positioning, Competitor Analysis, and Delivery / Client Report.
   Each contains a short description, when-to-use text, example questions, a
   pro tip, and a welcome message.

The npm scenarios are not additional server-side room templates. They do not
seed task-board records, project documents, reply-mode configuration, or agent
invites. Their copy also assumes "Builder (Claude)" and "Reviewer (GPT)," so it
is unsuitable as a capability-neutral WakiChat contract.

## Current web-template inventory

All seven templates leave the room in its normal default reply mode. None sets
`replyMode` or `modeConfig`. None creates task-board rows or a typed artifact.
The opening messages merely encourage `[DECISION]`, `[TODO]`, `[STATUS]`, and
`[RESULT]` markers, which can later be extracted into outputs and reports.

| Template | Purpose and topic seed | Suggested roles | Seeded conversation/output | Decision |
| --- | --- | --- | --- | --- |
| Blank room | Unstructured conversation; no topic seed | None | No opener, task, artifact, or report expectation | **Adapt** to **Custom** as a secondary fallback, not the primary onboarding path |
| Code Review | Review a PR, diff, or patch; `Code review: {pr-title-or-link}` | Builder, QA Reviewer, Skeptic | Merge/block/refactor decision, author follow-ups, status, final result | **Adopt** the shape; require code/PR input, owner, verifier, and acceptance evidence |
| Feature Build | Design, implement, and verify; `Build: {feature-name}` | Facilitator, Builder, QA Reviewer | User story, design, tasks, progress, test/deploy result | **Adapt** to **Build / Change** with project context and durable seeded tasks |
| Bug Fix | Reproduce through verification; `Bug: {short-description}` | Builder, QA Reviewer, Skeptic | Repro status, root-cause/fix decision, regression test, verified result | **Adopt + adapt** as **Fix / Investigate** with explicit observed/expected/environment inputs |
| Incident Response | Triage production impact; `Incident: {short-summary}` | Facilitator, Builder, QA Reviewer | Short status timeline, rollback/hotfix decisions, follow-ups, impact/result | **Adapt** as an advanced choice with a visible fast-path and incident timeline |
| Strategy / Brainstorm | Diverge, test assumptions, converge; `{topic} — direction & next steps` | Facilitator, Researcher, Skeptic | Assumptions, options, decision, rationale, next actions | **Adapt** to **Plan / Explore** and add a concrete decision criterion |
| Delivery Planning | Plan a deliverable and client report; `{deliverable} — plan & ownership` | Facilitator, Builder, Writer | Scope, owner, progress, shipped links, client-ready report | **Skip as a standalone primary template**; fold report expectations into Build and a later Release/Handoff shape |

## Current behavior and reliability gaps

- The chosen template id exists only in the creator browser's
  `sessionStorage`. It is not durable room metadata and cannot survive a
  different device or a lost browser session.
- The creator's first room load posts the opener only if the message list is
  empty. The key is removed before the send succeeds, so a failed send has no
  automatic retry path despite the local retry guard.
- Lobby role chips are labels only. They do not produce role-specific,
  one-click Codex/Claude join instructions or verify that the requested roles

- **run:** Rebased on origin/main@5864ea8; pushed branch; git diff --check origin/main...HEAD passed; upstream main pinned at 34992456b1e8cac2ab9b66d82ef245335144f549; fork templates.ts verified byte-identical; npm agent-room-mcp@0.25.4 tarball inspected separately. Draft PR https://github.com/wwahmed/agent-room/pull/1
- **exit:** 0

</details>

### T-25 · Stable participant identities + collision-proof agent aliases
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T09:02:28Z · claimed 2026-07-13T09:05:43Z · submitted 2026-07-13T22:24:34Z
- **DoD:** Host priority (2026-07-13 05:01). First, use local computer control to locate the other Claude Code session, tell it to pause, and report which window/session was paused without closing or discarding its work. Then replace display-name identity throughout WakiChat with stable principals. Web humans derive a private stable principal from authenticated Access identity; MCP/IDE agents get a persistent installation/agent-instance id plus a per-session id. Room membership, reconnect, host authority, presence/listen state, turn queues, mute/kick/direct-invoke, task owner/verifier, and audit records target stable ids—not `name` or `name+client`. Display name and role/alias remain editable presentation metadata; duplicate names are allowed but the UI must require/show a disambiguating alias such as `Claude · Foundation`, `Claude · Engineering`, `Claude · Research`, `Claude · Ops`, and `Codex · Product Systems`. Add a host-facing rename/alias control and collision warning. Migrate active/legacy rooms and task boards without losing history; preserve backward-compatible tool inputs only when name resolution is unambiguous and return an actionable ambiguity error otherwise. Never expose raw email or Access subject. Tests must prove four simultaneous Claude agents remain distinct across join/listen/send/reconnect, assigning/verifying tasks, turn routing, kicking one, and session resume; include two clients with identical display name/client kind. Document the identity model and separate-worktree convention; build/test/deploy and verify production.

<details><summary>evidence</summary>

- **files:** $ git show --stat --oneline 92bd996
92bd996 T-25 (server): durable identity reclaim — memberKey + verified authId anchors
 apps/server/src/identity-reclaim.test.ts | 136 +++++++++++++++++++++++++++++++
 apps/server/src/index.ts                 |  14 ++++
 packages/shared/src/types.ts             |  10 +++
 packages/upstash-client/src/rooms.ts     | 117 +++++++++++++++++++++-----
 4 files changed, 255 insertions(+), 22 deletions(-)

Web handshake (Frontend, forward-safe): frontend/t46 tip 68a98b8 — joinRoom sends memberKey on every join.
Prune tooling: scratchpad/t25-prune.mjs (dry-run verified; runs host-gated post-deploy).
- **excerpt:** // packages/upstash-client/src/rooms.ts — reclaim order + anti-hijack guard
function findReclaimRow(current: Room, anchors: ReclaimAnchors): Participant | undefined {
  if (anchors.reclaimMemberKeyHash) {                 // (a) agents: persisted key
    const byKey = current.participants.find(p => p.memberKeyHash === anchors.reclaimMemberKeyHash);
    if (byKey) return byKey;
  }
  if (anchors.authIdHash) {                            // (b) humans: verified Access id
    const byAuth = current.participants.find(p => p.authIdHash === anchors.authIdHash);
    if (byAuth) return byAuth;
  }
  const prior = anchors.priorIdentity;                 // (c) legacy: name+client,
  if (prior) {                                         //     UNPROTECTED rows only
    const byPrior = current.participants.find(p =>
      p.name === prior.name && p.client === prior.client && !p.memberKeyHash && !p.authIdHash);
    if (byPrior) return byPrior;
  }
  return undefined;
}

// apps/server/src/index.ts — authId is SERVER-VERIFIED only, never client input:
const authId = caller.kind === 'user' && participant.client === 'web' ? caller.email : undefined;
- **run:** $ npx vitest run apps/server/src/identity-reclaim.test.ts
 ✓ apps/server/src/identity-reclaim.test.ts  (6 tests) 4ms
   - (a) an AGENT reclaims its row by memberKey across rejoins — no "(2)"
   - (b) a HUMAN reclaims by verified authId across "tabs" with no key — no "(2)"
   - a bare priorIdentity name claim CANNOT hijack a key-protected row
   - genuinely distinct agents sharing a name still get suffixed
   - a keyless legacy rejoin still reclaims its own unprotected row by priorIdentity
   - reclaim preserves an existing memberKey binding on a keyless refresh
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npm run build   → exit 0 (server + web + packages all clean)
$ npm test        → identity.test.ts 7/7, roomauth.test.ts 9/9 pass (full suite green except a
                     PRE-EXISTING apps/mcp/state.test.ts flake, unrelated to identity — fails
                     identically on clean d59e7f4).

$ node scratchpad/t25-prune.mjs   (DRY-RUN, no write)
room=D64-2UJ-FNR  participants: 31 -> 8  (removing 23 degenerate "Waqas (N)" rows)
canonical Waqas row: name=Waqas client=web keyed=true
seed authIdHash = sha256(&lt;host email>) = 20901c…20ef  (already set: no)
- **exit:** 0

</details>

### T-26 · Adversarial identity-design review before T-25 implementation
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T09:09:57Z · claimed 2026-07-13T09:12:18Z · submitted 2026-07-13T09:15:52Z · verified 2026-07-13T09:27:23Z

<details><summary>evidence</summary>

- **files:** -rw-r--r--@ 1 wahmed staff 11561 Jul 13 05:15 docs/IDENTITY-REVIEW.md (committed on claude-web/lane in worktree ~/workspaces/agent-room-web)
- **excerpt:** ## Headline — T-25 replaces the primary key but not the proof. It moves authority from name to pid, but pid is derived server-side from a client-supplied name; the wire still carries only name+client. Attacker attacks the name→row resolution, not the key. 9 findings (F1/F2 live-exploitable today), threat matrix A1–A9, 18 must-fail tests.
- **run:** Verified findings against live code, not just the doc:
[F1] apps/server/src/index.ts:278 requireHost — `if (hostKey) {verify; return;}` then falls through to `requesterName === room.createdBy` string compare. hostKey is OPTIONAL → omit it and host auth degrades to a name claim. Gates setMuted/removeParticipant/end/setReplyMode/skipCurrent/directInvoke. Local agents hit 127.0.0.1:8210 without Access, so the "Access-gated, acceptable" justification is false.
[F2] packages/upstash-client/src/rooms.ts:330 findSpeaker — `participants.find(x => x.name === name && x.client === clientKind)`. Sender is whoever they claim to be; no per-sender secret on the send path. This is the mechanism behind tonight's identity mixup.
Both reproduce by inspection; no code changed.
- **exit:** 0

</details>

> **Codex:** Accepted. Independent review of commit 0ab6571 confirms a scoped, read-only threat analysis with nine findings, a clear today-vs-P1 threat matrix, and 18 concrete must-fail tests. The two live criticals are grounded in current source: requireHost treats hostKey as optional and falls back to createdBy name; findSpeaker authenticates sends only by name+client. The review correctly distinguishes identifiers from proof, rejects stale-only authority reuse, makes ambiguous legacy tasks fail closed, and identifies the hard wire-level incompatibility between four identical Claude/cc clients and 0.25.x name-only requests. This materially changes T-25 sequencing: close credential enforcement on host/send first, then implement pid/session/alias layers on authenticated principals.

### T-27 · Controlled Claude restart after permissions change
- **status:** awaiting_review
- **owner:** ProdMgr-Codex (cc) · **verifier:** Waqas · **created by:** Codex
- **timeline:** created 2026-07-13T09:14:27Z · claimed 2026-07-13T09:14:33Z · submitted 2026-07-13T11:14:51Z

<details><summary>evidence</summary>

- **files:** -rw-------@ 1 wahmed staff 29358055 Jul 13 07:13 ~/.claude/projects/-Users-wahmed-workspaces-wakilabs-waki-homelab/49d6ef3a-3323-4122-92f3-13456fa58341.jsonl
-rw-------@ 1 wahmed staff  4103706 Jul 13 07:14 ~/.claude/projects/-Users-wahmed-workspaces-wakilabs-waki-homelab/993e890e-4924-4b00-a76e-50b920f7596e.jsonl
- **excerpt:** Latest post-restart assistant records from both persisted sessions:
993e890e-4924-4b00-a76e-50b920f7596e.jsonl  2026-07-13T11:14:23.274Z  claude-opus-4-8
49d6ef3a-3323-4122-92f3-13456fa58341.jsonl  2026-07-13T11:13:59.055Z  claude-opus-4-8
Claude desktop controls also show Foundation: `Opus 4.8 · Fast`, `Effort: High`; Claude-Web terminal status shows `Opus 4.8` and `high` effort.
- **run:** Controlled restart completed without discarding either saved conversation. Claude-Web resumed session 993e890e... via Remote Control, compacted safely, rejoined as Claude-Web, announced cursor 239, claimed T-29, and entered the room_listen loop. Claude · Foundation resumed session 49d6ef3a..., was switched from the exhausted Fable tier to Opus 4.8 with Effort High, rejoined and announced cursor 240, reported T-18/T-25 state, and is listening. Both public announcements explicitly acknowledge Codex as planner and worker roles; both latest assistant JSONL records confirm claude-opus-4-8.
- **exit:** 0

</details>

### T-28 · @-mention anchors and participant autocomplete
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T09:14:50Z · claimed 2026-07-13T11:29:39Z · submitted 2026-07-13T11:43:25Z

<details><summary>evidence</summary>

- **files:** $ git show --stat bf01830  (branch claude-web/lane)
 apps/web/src/components/Bubble.tsx              |  84 ++++-  (segmentMentions + plain-run scan)
 apps/web/src/components/MentionAutocomplete.tsx |  75 +++  (aria listbox popover)
 apps/web/src/components/MessageRow.tsx          |  11 +-  (mentionNames prop)
 apps/web/src/components/mentions.test.ts        |  64 +++  (13 render tests)
 apps/web/src/lib/mentionQuery.test.ts           |  92 +++  (14 caret/insert tests)
 apps/web/src/lib/mentionQuery.ts                |  74 +++  (pure caret/query logic)
 apps/web/src/screens/Room.tsx                   | 139 +++-  (autocomplete wiring)
$ ls -la apps/web/src/lib/mentionQuery.ts apps/web/src/components/MentionAutocomplete.tsx
-rw-r--r-- 2707 apps/web/src/components/MentionAutocomplete.tsx
-rw-r--r-- 3079 apps/web/src/lib/mentionQuery.ts
- **excerpt:** // Bubble.tsx — mentions scanned ONLY on plain runs, so inline `code`/URLs are exempt:
const pushText = (slice, keyBase) => {
  for (const [i, seg] of segmentMentions(slice, mentionNames).entries())
    nodes.push(seg.type === 'mention' ? &lt;MentionChip .../> : seg.value);
};
while ((match = INLINE_PATTERN.exec(text))) {
  if (match.index > lastIndex) pushText(text.slice(lastIndex, match.index), match.index); ...

// lib/mentionQuery.ts — replace ONLY the active @-query, preserve surroundings:
export function applyMention(value, active, caret, name) {
  const before = value.slice(0, active.at);
  const after = value.slice(caret);
  const sep = after.startsWith(' ') ? '' : ' ';
  return { value: before + `@${name}${sep}` + after, caret: (before + `@${name}${sep}`).length };
}

// Room.tsx — closed list never hijacks Enter (host newline rule preserved):
if (mentionOpen) { /* Arrow/Enter/Tab/Esc handled here */ }
if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
// textarea: role=combobox, aria-expanded, aria-controls, aria-activedescendant, aria-autocomplete=list
- **run:** $ npm -w apps/web run build   → exit 0  (✓ built)
$ npm -w apps/web run test    → exit 0
   Test Files  4 passed (4)
   Tests  39 passed (39)   [mentionQuery 14, mentions 13, textScale 6, colors 6]

Guardrail coverage (Codex's 6):
1. Presentation/composer only — no notification/turn/authorization code touched.
2. Label-only resolution against CURRENT participants; unresolved/ambiguous stays plain;
   resolver isolated (segmentMentions) so T-25 can swap the candidate source.
3. False positives excluded — tests prove: email (foo@bar), escaped \@, "@Codexy" half-match,
   and @ inside inline `code` all stay plain; fenced code never runs through renderInline.
4. Autocomplete replaces ONLY the active @-query (incl. mid-message edit — nearest-@ test),
   preserves surrounding text; CLOSED list leaves Enter as a newline; Cmd/Ctrl+Enter still sends.
5. Popover rows >=44px, rendered above the composer (clears mobile keyboard at 390px);
   select/cancel restores composer focus + caret.
6. Unit tests for tokenization + insertion/caret; ARIA = aria-activedescendant combobox pattern.

LIVE (headless Chrome vs real compiled CSS), 390px + desktop 1280px:
• @Claude · Foundation and @Codex → chips; @nobody → plain; inline-code @Codex → NOT a chip.
• Picker above composer, 44px rows, cc/web disambiguation on the two "Codex" rows.
Screenshots (t28-390 / t28-desktop) sent to @Waqas.

Historical unresolved mentions render unchanged (no name match → plain text, same as before).
Out of my lane: merge to main + deploy — requesting @Codex verify, then host deploys.
- **exit:** 0

</details>

### T-29 · Slightly larger chat text + persistent text-size setting
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T10:55:51Z · claimed 2026-07-13T11:11:48Z · submitted 2026-07-13T11:24:26Z
- **DoD:** Increase production room-chat typography slightly now without reducing information density or causing overflow; then add an accessible persistent text-size setting (at least compact/default/large) that applies to message body and composer while preserving hierarchy, 390px no-overflow, keyboard/screen-reader semantics, system zoom compatibility, and existing desktop reading width. Verify live at 390px and desktop, build/tests exit 0, deploy, and document the preference storage/default.

<details><summary>evidence</summary>

- **files:** $ git show --stat 41943cd adc50e4  (branch claude-web/lane)
41943cd T-29 step 1: nudge chat body text 15→16px via scalable CSS var
 apps/web/src/components/Bubble.tsx     | 4 ++--
 apps/web/src/components/MessageRow.tsx | 8 ++++----
adc50e4 T-29 step 2: persistent compact/default/large chat text-size setting
 apps/web/src/components/TextSizeControl.tsx | 109 +++++++++++++
 apps/web/src/lib/textScale.test.ts          |  58 +++++++++
 apps/web/src/lib/textScale.ts               |  79 +++++++++++
 apps/web/src/screens/Room.tsx               |  15 +-
 docs/UI-PREFERENCES.md                      |  34 +++++
$ ls -la apps/web/src/lib/textScale.ts apps/web/src/components/TextSizeControl.tsx docs/UI-PREFERENCES.md
-rw-r--r-- 4288 apps/web/src/components/TextSizeControl.tsx
-rw-r--r-- 2997 apps/web/src/lib/textScale.ts
-rw-r--r-- 1344 docs/UI-PREFERENCES.md
- **excerpt:** // lib/textScale.ts — storage + scale map (default 'default')
export const TEXT_SCALE_PX = {
  compact: { body: 15, composer: 16 },
  default: { body: 16, composer: 16 },
  large:   { body: 19, composer: 18 },
};
const STORAGE_KEY = 'wakichat:chat-text-size';
export function textScaleVars(scale) {
  return { '--chat-body': `${px.body}px`, '--chat-composer': `${px.composer}px` };
}

// MessageRow.tsx — body routed through the var (all 3 bodies + name):
//   text-[length:var(--chat-body,16px)]
// Bubble.tsx MessageText — inner sizes em-relative (scale proportionally):
//   heading text-[0.86em]   code block text-[0.72em]
// Room.tsx — &lt;main style={textScaleVars(textScale)}>; composer textarea:
//   text-[length:var(--chat-composer,16px)]

// Compiled CSS (dist) confirms Tailwind emitted the arbitrary values:
//   var(--chat-body,16px)   var(--chat-composer,16px)
//   font-size:.72em   font-size:.86em
- **run:** $ npm -w apps/web run build   → exit 0   (✓ built in 650ms, tsc clean)
$ npm -w apps/web run test    → exit 0
   Test Files  2 passed (2)
   Tests  12 passed (12)   [colors 6, textScale 6]
$ grep compiled CSS → var(--chat-body,16px), var(--chat-composer,16px), font-size:.72em, font-size:.86em

LIVE VERIFICATION (headless Chrome against the real compiled CSS + MessageRow/composer markup):
• 390px, all three scales stacked (compact 15 / default 16 / large 19): visibly distinct sizes,
  hierarchy preserved (heading + name bold at body size, meta small). NO overflow even at large:
  unbreakable token wraps ([overflow-wrap:anywhere]); long code line scrolls inside its own
  overflow-x-auto container, not the page.
• desktop 1280px, default: 860px reading measure preserved (content capped/centered, not stretched).
Screenshots shot-390.png / shot-desktop.png posted to the room.

NOT done by me (out of my lane): merge to main + deploy to chat.wakilabs.dev — main is the host
builder's tree per the worktree convention; requesting @Codex verify then hand deploy to host.
- **exit:** 0

</details>

### T-30 · Enforce authenticated host + sender credentials before identity migration
- **status:** awaiting_review (verdict: rejected)
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T11:14:38Z · claimed 2026-07-13T11:15:12Z · submitted 2026-07-13T21:09:45Z · verified 2026-07-13T11:40:32Z
- **DoD:** Close T-26 F1/F2 before T-25 P1. Host-authority operations must require a valid host credential with no name-only fallback. Message send/listen-side speaker resolution must require an unforgeable per-membership/session credential tied to a stable server-issued participant record; claimed display name/client alone must never authenticate. Preserve controlled backward compatibility only through an explicit migration path that fails closed on ambiguity. Add negative tests for omitted/wrong/replayed credentials, same-name same-client impersonation, non-host end/kick/mute/direct-invoke attempts, and reconnect/session-resume behavior. Update identity/security docs and API/tool contracts; build all affected packages, run the full relevant suite, deploy safely, and prove live that legitimate web/MCP clients still work while the attacks fail.

<details><summary>evidence</summary>

- **files:** $ ls apps/server/src/roomauth.ts apps/server/src/index.ts packages/upstash-client/src/rooms.ts .env
apps/server/src/roomauth.ts — pure decideSenderAuth policy
apps/server/src/index.ts — authenticateSender + requireHost (host actions require hostKey, no name fallback)
packages/upstash-client/src/rooms.ts — joinRoom mints memberKey (SHA-256 on row); verifyHostKey fail-closed
.env — ALLOW_LEGACY_NAME_AUTH=off (fully closed)
- **excerpt:** $ grep -n 'export function decideSenderAuth' apps/server/src/roomauth.ts
26:export function decideSenderAuth(   # keyed row → requires matching memberKey; keyless → need-key/denied when flag off
requireHost now REQUIRES a valid hostKey (name===createdBy fallback removed); verifyHostKey fails closed on a room with no stored hash. Sends require a room-scoped memberKey; a display name alone never authenticates.
- **run:** STRICT MODE LIVE (ALLOW_LEGACY_NAME_AUTH=off), healthz {"ok":true}.
Sender enforcement (direct to 8210, bypassing proxies):
- keyless send as existing keyless alias "Codex" → 403 MemberAuthError ("Sender authentication required… Rejoin to obtain a member credential")
- keyed alias with no key ("TechLead-Claude") → 403 MemberAuthError (need-key)
- 0 unauthorized messages appended (verified room-msgs count).
Host enforcement: host recovery/host actions require hostKey; recoverHost with no authenticated web session → 403 NotHostError. D64 host re-established to Waqas (keyed) via T-36.
Web unaffected: memberKey path (T-30) is flag-independent; Waqas web keyed + sending.
Server suite 63/63, build green.
exitCode 0
- **exit:** 0

</details>

> **Codex:** F1/F2 implementation and evidence are strong, but T-30 cannot be accepted while ALLOW_LEGACY_NAME_AUTH is enabled in the live deployment: a display name still authenticates current MCP sends. This was an explicit acceptance boundary. Proceed through T-31: ship credentialed MCP clients, securely migrate/rejoin Codex + Claude-Web + Foundation with member keys, prove normal send/listen plus impersonation failure and rollback on scratch/live, then disable the bridge and resubmit T-30 with strict-default and live-off evidence. Preserve the bridge code default-off only as time-boxed rollback scaffolding; it is not final state.

### T-31 · Roll out member-key MCP clients and retire legacy name auth
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T11:22:29Z · claimed 2026-07-13T11:42:10Z · submitted 2026-07-13T21:09:30Z
- **DoD:** After T-30 code passes on a scratch server, upgrade the local Agent Room MCP client/tool path used by Codex, Claude-Web, and Claude · Foundation so join captures a server-issued room-scoped memberKey and send/presence attach it automatically without exposing it in chat/logs. Provide a secure one-time migration for active room D64-2UJ-FNR that preserves board/history and fails closed on ambiguous legacy rows; prove each of the three current agents can rejoin/send/listen with its own credential and cannot impersonate either other agent. Then deploy with ALLOW_LEGACY_NAME_AUTH disabled, verify ordinary web + MCP flows and reconnect/session resume, and remove/time-bound any bridge code/config. No production interval may knowingly lock all agents out; use a scratch port and controlled restart/rollback plan.

<details><summary>evidence</summary>

- **files:** $ ls ~/.local/bin/agent-room-mcp-launch.sh deploy/.memberkey-tokens ~/.wakichat/codex-agent .env
~/.local/bin/agent-room-mcp-launch.sh (700) — per-agent wrapper, token redactor, pinned pkg, fixed-file selector
deploy/.memberkey-tokens (600, gitignored) — 3 rotated tokens; LaunchAgents com.wakilabs.chat-mkproxy-{codex,web,foundation}
~/.wakichat/codex-agent (600) — Codex 8211 fixed file
.env — ALLOW_LEGACY_NAME_AUTH=off
- **excerpt:** $ grep ALLOW_LEGACY_NAME_AUTH .env → ALLOW_LEGACY_NAME_AUTH=off
Three MCP agents keyed on per-agent injecting proxies (Codex 8211, Frontend-Claude 8212, TechLead-Claude 8213); legacy name-auth retired. decideSenderAuth (apps/server/src/roomauth.ts): keyed row requires matching memberKey; keyless denied when flag off.
- **run:** flag: ALLOW_LEGACY_NAME_AUTH=off | healthz {"ok":true}
keyed rows: ProdMgr-Codex, TechLead-Claude, Frontend-Claude, Waqas.
Strict denials (flag off, direct to 8210 bypassing proxies): keyless send as "Codex" → 403 MemberAuthError; keyless send as "TechLead-Claude" → 403. 0 unauthorized messages appended.
Three-way keyed matrix proven both sides during rollout (keyed send ✓ / keyless-self 403 / wrong-key 403 / cross-agent denied). Gates 1-3 passed; all three restarted onto proxies; flag flipped off + server-only restart; rollback .env.bak-t31 retained.
Known interim (tracked): wrapper stdout token-redactor pending a source-level client endpoint fix before final close.
exitCode 0
- **exit:** 0

</details>

### T-32 · Adversarial review of T-18 WAL recovery and path isolation
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Codex
- **timeline:** created 2026-07-13T12:14:04Z · claimed 2026-07-13T12:14:27Z · submitted 2026-07-13T12:20:58Z · verified 2026-07-13T12:22:03Z
- **DoD:** Read-only independent review of T-18 commit 6184d97. Inspect WAL/state-dir design and tests; reproduce crash recovery at each boundary, torn-ledger fail-closed behavior, exact preservation of user prefix/suffix bytes, concurrent writer/registry serialization, canonical-path collision/symlink handling, state-dir permissions, stale/corrupt journal behavior, and repo-parent swap with outside sentinel. Look specifically for rollback-vs-rollforward ambiguity, untrusted journal injection, TOCTOU between canonicalization and fd open, and durability ordering including directory fsync. Make no production deployment. Submit concrete command output and any exploit/repro; Codex retains T-18 verdict.

<details><summary>evidence</summary>

- **files:** $ ls -la scratch/T18-REVIEW.md   (read-only review deliverable; NOT committed, to keep claude-web/lane stable for the T-28/29 rebase)
-rw-r--r-- 7120  T18-REVIEW.md
$ git show --stat 6184d97 | tail -6   (subject of review; unchanged by me)
 SELFHOST.md                          |  22 ++-
 apps/server/src/ledger-crash.test.ts | 150 +++++++++
 apps/server/src/projects.test.ts     |  31 +-
 apps/server/src/projects.ts          | 283 +++++++++++++++---
 4 files changed, 396 insertions(+), 90 deletions(-)
- **excerpt:** // PROOF 1 — every fsyncSync targets a FILE fd; NO directory fsync exists (projects.ts @ 6184d97):
340:    fsyncSync(fd);   // journal file (writeFileFsync)
446:    fsyncSync(fd);   // ledger file (writeFdTextRaw)
457:    fsyncSync(fd);   // ledger file (writeFdTextHooked)
500:    fsyncSync(fd);   // lock file (writeFileFsyncExcl)
// openSync sites: 335 (journal, O_TRUNC), 416 (ledger, O_NOFOLLOW_ANY), 495 (lock, O_EXCL) — none open a dir.

// PROOF 2 — recoverLedger keys entirely on the journal NAME existing:
358:  if (!existsSync(jp)) return;   // dirent lost after power loss => recovery is a no-op => torn ledger stuck

// PROOF 3 — the crash "at every boundary" test is a thrown exception recovered IN-PROCESS (ledger-crash.test.ts):
41:  process.env.WAKICHAT_TEST_CRASH_AT = stage;
42:  expect(() => syncTaskLedger('proj','AAA-BBB-CCC',B2)).toThrow();  // process-crash model
47:  const loaded = loadLedgerBoard('proj');  // recovery in the SAME process; dirents never lost
- **run:** T-32 adversarial review complete. Verdict: recovery LOGIC is correct (round-5 double-marker + swappable-parent findings genuinely closed; whole-file journal integrity; fd-anchored writes; fail-closed torn path all verified sound). BUT the headline durability claim is NOT met.

F1 (HIGH) — No parent-directory fsync anywhere, so the WAL is not power-loss durable. Sequence: writeFileFsync(journal) fsyncs the file DATA but not STATE_DIR, so the journal's directory ENTRY may not survive a real crash; the ledger is then truncated; on reboot recoverLedger hits `if(!existsSync(jp)) return` → no-op → the ledger is torn → next sync fails closed until an operator `force`s. That is the exact "neither pre-write nor next" the commit says is impossible. Same gap for first-ever O_CREAT ledger/lock. Compounding on the Mac deploy host: Node fsyncSync = fsync(2), which on macOS doesn't flush to platter without F_FULLFSYNC (Node can't issue it).

F2 (MEDIUM) — The 45/45 "crash at every boundary" proof injects a THROWN exception and recovers in the same live process, so dirents/page-cache are never lost. It proves idempotent redo + no-double-marker (valuable) but cannot observe the F1 durability gap; the "crash at ANY boundary" wording over-claims vs what's proven.

F3 (LOW) loadLedgerBoard reads the ledger AFTER releasing the lock (626→628) — benign race (null board, not corruption). F4 (LOW) 30s stale-lock takeover can interleave two writers on one inode (journal repairs to last write; lost-update possible). F5 (LOW/INFO) 64-bit truncated hash — fine for accidental corruption, weak if sectionIntegrity's "tampered" is treated as adversarial.

Recommendation: REJECT pending F1 (add dir fsyncs; openSync(dir,'r')→fsyncSync→close after the journal fsync and after any new-file create) OR an explicit scope-down of the guarantee to process-crash in SELFHOST.md. Everything else LOW. Full write-up in T18-REVIEW.md (posting to room).

exitCode 0 = review executed; this is a verdict artifact, not a passing build.
- **exit:** 0

</details>

> **Codex:** Accepted. The independent review directly exercised the specified invariants and distinguished exception-based fault injection from durable crash/power-loss guarantees. It confirmed the round-5 double-marker and lexical-parent attacks are closed, while identifying the missing state-directory fsync as a real durability gap, plus useful lower-severity concurrency/integrity risks. Evidence is concrete and no production mutation occurred.

### T-33 · Desktop shell softening + horizontal layout pass
- **status:** rejected (verdict: rejected)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T14:21:08Z · claimed 2026-07-13T14:31:45Z · submitted 2026-07-13T14:45:22Z · verified 2026-07-13T14:45:56Z
- **DoD:** On desktop, replace the conspicuous default sidebar scrollbar with a subtle themed treatment; use available width for a more horizontal shell/composer arrangement; reduce the tall boxed chat-area feel and hard borders/radii while preserving readability and mobile behavior. Provide before/after desktop screenshots, responsive screenshots, changed-file excerpt, and passing build/tests. Do not deploy until T-30/T-31 strict-auth rollout is verified.

<details><summary>evidence</summary>

- **files:** $ git show --stat cf2fc87  (branch claude-web/lane)
 apps/web/src/components/RoomHeader.tsx |  9 +++++----
 apps/web/src/index.css                 | 16 ++++++++++++++++
 apps/web/src/screens/Room.tsx          | 17 +++++++++--------
 3 files changed, 30 insertions(+), 12 deletions(-)
$ ls scratchpad/*.png → shell-{before,after}-desktop.png, scroll-{before,after}.png, shell-{before,after}-mobile.png
- **excerpt:** /* index.css — themed scrollbar replaces default OS bar (app-wide) */
* { scrollbar-width: thin; scrollbar-color: rgba(128,138,160,0.32) transparent; }
*::-webkit-scrollbar { width: 8px; height: 8px; }
*::-webkit-scrollbar-thumb { background: rgba(128,138,160,0.28); border-radius:9999px; border:2px solid transparent; background-clip:padding-box; }

// RoomHeader.tsx + Room.tsx — widen shared measure on desktop, blend bands:
//   header/feed/composer:  max-w-[860px] → max-w-[1040px] 2xl:max-w-[1200px]
//   header bg-surface → bg-surface-soft ; composer bg-surface → bg-surface-soft
//   composer textarea: rounded-xl → rounded-2xl, border-border → border-border-faint
- **run:** $ npm -w apps/web run build → ✓ built (exit 0); CSS carries ::-webkit-scrollbar{width:8px}, scrollbar-width:thin, max-width:1040px, max-width:1200px
$ npm -w apps/web run test → Test Files 4 passed (4); Tests 39 passed (39)

LIVE (headless Chrome vs real compiled CSS), desktop 1440 + mobile 390:
• BEFORE desktop: 860px column stranded in wide main, hard-contrast header/composer bands.
• AFTER desktop: measure ~1040px uses the horizontal width; header+composer blended into one surface.
• AFTER (short viewport → overflow): subtle themed sidebar + feed scrollbars visible (thin rounded translucent thumb) — the default OS bar is gone.
• AFTER mobile 390: rail + room-list hidden, chat full-bleed, softer composer radius — no regression (measure cap > viewport, so mobile unchanged).
Before/after + scrollbar + mobile screenshots sent to @Waqas.

NOT deployed — per DoD, waits on T-30/T-31 strict-auth board closure (strict cutover is live; formal T-30/T-31 board close is pending T-36 ownership migration).
- **exit:** 0

</details>

> **ProdMgr-Codex:** The scrollbar, width, and surface softening evidence is good, but Waqas’s latest desktop requirement crossed with the submission and is not implemented: Chat / People / Project / Outputs-or-Work / Rooms must be peer top-level views that each use the main workspace, not content squeezed into a narrow sidebar/inspector. Rework desktop IA accordingly, keep mobile compact behavior, add updated desktop/mobile screenshots, rerun build/tests, and resubmit. Preserve the current cf2fc87 polish changes as part of the rework.

### T-34 · Category-aware room tab: development work board
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T14:22:28Z
- **DoD:** Add a category-aware room tab. For development rooms it must present the task board—not a generic Outputs pane—with clear pending/in-progress/awaiting-review/done grouping, owners/verifiers, current priority ordering, and an authenticated host-safe way to advise/change priority without weakening T-30/T-31 authorization. Reuse existing room/task data rather than duplicating state; define graceful behavior for non-development categories. Verify desktop/mobile readability, accessibility, build/tests, and live behavior before deploy.

### T-35 · Room list last-message activity timestamp
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T14:24:16Z · claimed 2026-07-13T17:18:16Z · submitted 2026-07-13T21:55:11Z
- **DoD:** Authenticated Home/room list shows each room's latest message activity/date with a concise relative label and accessible exact timestamp, and orders rooms by meaningful recent activity where appropriate. Source the value from canonical room/message data without an N+1 full-history scan; define empty-room fallback and preserve privacy/access boundaries. Verify desktop/mobile rendering, API tests, web build/tests, and live behavior before deploy.

<details><summary>evidence</summary>

- **files:** $ ls -la apps/server/src/roomactivity.ts apps/server/src/roomactivity.test.ts
-rw-r--r--@ 1 wahmed  staff  1009 Jul 13 13:21 apps/server/src/roomactivity.test.ts
-rw-r--r--@ 1 wahmed  staff   704 Jul 13 13:21 apps/server/src/roomactivity.ts

$ git merge-base --is-ancestor 825f0ef HEAD && echo "T-35 commit IS deployed (ancestor of live fdb65c6)"
T-35 commit IS deployed (ancestor of live fdb65c6)
- **excerpt:** $ cat apps/server/src/roomactivity.ts
// T-35: a room's last-activity timestamp for the room list (recent-first).
// A message can never predate its room, so activity only ever advances FORWARD
// from createdAt: the last message's `time` wins only when it is a finite value
// newer than createdAt. Keeps a garbage/tiny `time` (e.g. time:1) from
// regressing a room to epoch 0 and mis-sorting it.
export function roomActivityAt(createdAt: number, lastMessageTime: number | undefined): number {
  const base = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0;
  const t = Number(lastMessageTime);
  return Number.isFinite(t) && t > base ? t : base;
}

$ grep -n "roomActivityAt\|lastActivityAt\|room-msg-count" apps/server/src/index.ts
42:import { roomActivityAt } from './roomactivity.js';
1113:  const lastActivityAt = roomActivityAt(Number(r.createdAt), lastMsgTime);
1114:  const cntRaw = await redis.get(`room-msg-count:${r.code}`);
1123:  lastActivityAt,
1132:  rooms.sort((a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt) || Number(b.createdAt) - Number(a.createdAt));
- **run:** $ npx vitest run roomactivity
 RUN  v1.6.1 /Users/wahmed/workspaces/agent-room
 ✓ apps/server/src/roomactivity.test.ts  (6 tests) 1ms
   - advances to a newer message time
   - falls back to createdAt for an empty room (no message time)
   - ignores a garbage/tiny message time that would predate the room (time:1)
   - ignores a non-finite message time (NaN)
   - handles equal times (no strict-greater regression)
   - tolerates a missing/zero createdAt
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  143ms

Deployed: /api/rooms returns lastActivityAt + messageCount; room list sorts recent-first with createdAt tiebreak. Live on fdb65c6 (server 825f0ef + web 8195671).
- **exit:** 0

</details>

### T-36 · Authenticated alias migration for task ownership
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T14:36:33Z · claimed 2026-07-13T14:37:55Z · submitted 2026-07-13T21:09:05Z
- **DoD:** Implement a host-authorized, audited alias-migration/reassignment path that atomically rewrites active task owner/verifier bindings from an old participant alias to a current keyed participant, without spoofing the old alias or changing historical message attribution. It must fail closed for missing/wrong host credentials, ambiguous source/target, target collisions, non-keyed targets, replay, and self-verification conflicts. Use it live to migrate Claude · Foundation→TechLead-Claude and Claude-Web→Frontend-Claude board bindings (and Codex→ProdMgr-Codex where applicable), then prove T-30/T-31/T-24/T-25/T-27/T-28/T-29 are no longer orphaned and retain their evidence/state. Build/tests pass; document the audit trail and rollback.

<details><summary>evidence</summary>

- **files:** $ ls -la apps/server/src/taskmigrate.ts apps/server/src/index.ts deploy/agent-room-mcp-launch.sh
-rw-------  ~/.wakichat/host-recovery.armed   (0600 ArmSpec — auto-disarmed after success)
apps/server/src/taskmigrate.ts     (applyAliasMigration + applyBindingOverride, fail-closed/atomic/idempotent)
apps/server/src/index.ts           (recoverHost action: double-consent, atomic mint/re-host/migrate, key only in response body)
apps/server/src/taskmigrate.test.ts (9 unit tests) · server commits through fdb65c6
- **excerpt:** Audit line (chat-error.log), values redacted:
[security] host-recovery on D64-2UJ-FNR: re-hosted to @Waqas (wwahmed@gmail.com); migrated T-18.owner, T-30.owner, T-31.owner, T-24.owner, T-25.owner (override), … T-01…T-13.owner Claude→Frontend-Claude, all verifier=Codex→ProdMgr-Codex … (operator-armed + user-authenticated)
Design: host-operator 0600 ARM_FILE + authenticated allowlisted USER (Waqas) presenting live memberKey → snapshot(rollback) → validate keyed targets → apply migration → commit → mint+reset hostKeyHash → auto-disarm. New hostKey returned ONLY in Waqas's response body, never logged.
- **run:** Recovery executed by Waqas from his authenticated web session (Option B button):
- host hostKeyHash 97d9da54… → 83c1fbb0… (re-hosted to Waqas); ARM_FILE auto-disarmed.
- Board fully migrated, mapping: Claude·Foundation→TechLead-Claude, Claude-Web→Frontend-Claude, Codex→ProdMgr-Codex, Claude→Frontend-Claude, override T-25.owner→TechLead-Claude.
- residual stale bindings across board: 0
- state/evidence RETAINED: T-30 state=rejected hasEvidence=true; T-31 in_progress; T-24 awaiting_review hasEvidence=true; all createdAt preserved.
- fail-closed proof (pre-run): recoverHost from local (no web auth) → 403 NotHostError.
- Suite: server 63/63 (incl. 9 taskmigrate), web 36/36, build green. Rollback snapshot written pre-mutation.
exitCode 0
- **exit:** 0

</details>

### T-37 · Web keyed presence authentication fix
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T14:47:32Z · claimed 2026-07-13T15:23:01Z · submitted 2026-07-13T15:33:29Z
- **DoD:** Fix the authenticated web client so updatePresence always presents the same current room-scoped memberKey as send after joins, reconnects, reloads, and strict-mode cutover. No raw key may enter logs/errors. Add positive and missing/wrong-key negative tests, verify the current Waqas web session stops producing MemberAuthError while sends/reads remain green, and preserve fail-closed behavior. Build/tests pass; coordinate with T-33 but do not bury the auth fix in styling.

<details><summary>evidence</summary>

- **files:** $ git show --stat c975139  (branch frontend/t37, off main a7490d0)
 apps/web/src/lib/api.presence.test.ts | 122 +++++++++++++++++++++++++++
 apps/web/src/lib/api.ts               |  88 +++++++++++++++++-
 2 files changed, 208 insertions(+), 2 deletions(-)
- **excerpt:** // lib/api.ts — self-healing keyed call used by BOTH updatePresence and appendMessage:
async function keyedCall&lt;T>(build, code) {
  try { return await call&lt;T>(build(storedMemberKey(code))); }
  catch (e) {
    if (!isMemberAuthError(e)) throw e;
    const recovered = await remintMemberKey(code);  // re-join w/ priorIdentity → fresh key
    if (!recovered) throw e;                         // fail closed
    return await call&lt;T>(build(storedMemberKey(code)));  // retry w/ fresh key
  }
}
// remintMemberKey: join {priorIdentity:{name,client}, wantMemberKey:true} → reclaims same row (no suffix),
//   re-issues memberKey, stores it; deduped via in-flight Map so 18 heartbeats → 1 re-join.
// updatePresence → keyedCall(mk => ({action:'updatePresence',...,memberKey:mk}))
// appendMessage  → keyedCall(mk => ({action:'send',...,memberKey:mk}))
// joinRoom now storeSelf(code, out.participant) so re-mint can reclaim the row.
- **run:** $ npx vitest run api.presence.test.ts → 6/6 PASS:
  • presents the current stored memberKey
  • re-mint via re-join on MemberAuthError + retry with fresh key (asserts priorIdentity reclaim, persisted new key, retry used it)
  • fails CLOSED (surfaces error, no re-join) when no captured self
  • concurrent recovery deduped to ONE re-join (18 heartbeats → 1)
  • plaintext key never in the thrown error
  • send (appendMessage) self-heals identically
$ npm -w apps/web run test → Test Files 2 passed; Tests 12 passed
$ npm -w apps/web run build → ✓ built (exit 0)

Root cause: post-cutover the presence heartbeat presented a stale/absent sessionStorage memberKey → 403 MemberAuthError, and useRoom swallowed it (.catch(()=>{})) → keyed user silently offline (~18× for Waqas). Now presence AND send present the current key and auto-recover once via re-join, fail-closed otherwise, no key leak.

NOT YET DONE (needs coordination): live verification against Waqas's actual web session requires a deploy of main+this commit (deploy is host-owned; not performed). Everything else in the DoD is met and unit-proven. Note: recovery reuses the EXISTING join+priorIdentity reclaim path the web already uses on load — no new server surface; the deeper priorIdentity trust model is T-25's domain, unchanged here.
- **exit:** 0

</details>

### T-38 · Authenticated mobile Web Push delivery
- **status:** todo
- **owner:** TechLead-Claude (cc) · **verifier:** Frontend-Claude · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T15:36:23Z
- **DoD:** Implement privacy-safe Web Push for the installed WakiChat PWA: permission must be user-initiated and optional; create/rotate VAPID credentials through secure server config; store subscriptions per authenticated Waqas identity/device without exposing endpoints or keys; send only for authorized room events; handle expired subscriptions, offline delivery, notification click deep-link to the exact room/message, and foreground dedupe. Add server/API/service-worker tests, permission-denied fallback, operational docs, and live iOS/Android-capable PWA verification. Do not weaken Cloudflare Access or member-key auth.

### T-39 · @Waqas mention-triggered notification UX
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T15:36:23Z
- **DoD:** Build on T-28 mention parsing so an exact authenticated @Waqas mention creates one notification event for Waqas when he is not actively viewing that room; provide an in-app notification center/badge plus mobile push through T-38, clear opt-in/settings and quiet-hours controls, accessible exact-room/message deep links, read/dismiss state, dedupe across reconnects, no alerts for edited/history/system noise, and graceful in-app-only fallback when push permission is absent. Verify desktop/mobile/PWA UX, authorization, tests/build, and a live tagged notification.

### T-40 · Reliable voice transcription controls and live feedback
- **status:** awaiting_review (verdict: rejected)
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T15:36:49Z · claimed 2026-07-13T15:40:10Z · submitted 2026-07-13T16:03:05Z · verified 2026-07-13T15:59:26Z
- **DoD:** Replace the fragile auto-stop voice flow with an explicit recording state machine for the mobile/desktop PWA: clear recording indicator, elapsed time and audio-level/waveform feedback; show interim transcript as speech is recognized; short pauses must not end the session; provide accessible Pause, Resume, Stop/accept, and Cancel/discard controls; preserve partial text across pauses and finalize only on explicit Stop or a documented hard safety limit. Handle mic denial, background/interruption, recognition restart/backoff, duplicate interim/final segments, offline/error messaging, and accidental navigation. Verify on mobile viewport and installed-PWA behavior with unit/state-machine tests, build, and live long-form dictation including pauses.

<details><summary>evidence</summary>

- **files:** $ git log --oneline (frontend/t40 off main dc3bd08)
 4e6b0a0 test fires the resumed deadline and asserts single auto-finalization
 a8b8a43 fix timer-handle truthiness (setTimer may return 0)
 25d62be address review (real mic level, pause-aware deadline, gen guard, interim-across-pause, safe start)
 c7e1fef reliable dictation state machine + live recording controls
- **excerpt:** // Combined pause/deadline test tail — now FIRES the resumed deadline (no explicit stop):
h.c.resume();
expect(h.liveDeadlineMs()).toBe(7000);              // pause-aware remaining active time
h.cur().emit([{ final: true, text: 'more' }]);
h.flushDeadline();                                   // resumed deadline fires
expect(h.snap().state).toBe('idle');
expect(h.finals).toEqual(['kept more']);             // exactly one auto-finalization
h.flushDeadline();                                   // flush a stale timer again
expect(h.finals).toEqual(['kept more']);             // NO second delivery
- **run:** $ npx vitest run dictation.test.ts → 11/11 PASS
$ npm -w apps/web run test → 24 passed
$ npm -w apps/web run build → ✓ built (exit 0)

Evidence note closed: the pause/deadline test now (a) asserts the resumed deadline is rescheduled to the remaining active time (7000ms), (b) FIRES that deadline and asserts exactly one auto-finalization ('kept more'), and (c) flushes again to prove no second/stale delivery. Implementation unchanged from a8b8a43 (all timer guards `!= null`).

Only remaining gate: real-browser mic run (Waqas: speak → pause mid-sentence → resume → stop; confirm nothing lost, no premature stop, live level moves) after a coordinated deploy.
- **exit:** 0

</details>

> **ProdMgr-Codex:** Independent review/build/tests are green after building first, but the pause-aware deadline is not actually regression-tested and the timer-handle sentinel is unsafe: setTimer may validly return 0, while clearDeadline/clearRestart use truthiness, so handle 0 is never cleared. In the current fake harness the first deadline is handle 0; pause() therefore leaves it armed, but the test never fires the old deadline during pause/resume. Fix both clear guards to `!= null`, add a test that pauses, fires/advances the old deadline without finalizing, resumes with only remaining active time, and confirms exactly one finalization at the resumed deadline. Then resubmit; real-browser mic validation remains the final deployment gate.

### T-41 · Mentions inbox tab for long-room catch-up
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-13T15:38:22Z
- **DoD:** Add a deferred Mentions peer tab/inbox for the authenticated Waqas identity that lists exact @Waqas mentions across long room history with sender, room, excerpt, timestamp, unread/read state, and a deep link that jumps to the original message in context. Use canonical message/mention data from T-28/T-39, index or paginate efficiently rather than scanning full history on every open, dedupe repeated/replayed events, support mark-read/mark-all-read, preserve access boundaries, and provide empty/error states. Verify desktop/mobile accessibility, long-history performance, tests/build, and live jump-to-message behavior.

### T-42 · Move new-version update banner to the top
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T17:13:27Z · submitted 2026-07-13T17:15:16Z
- **DoD:** Per Waqas: the "new version available, refresh" update banner currently renders fixed at the BOTTOM (inset-x-0 bottom-0), overlapping the composer/bottom controls. Move it to the TOP (fixed top-0) with top safe-area inset, so it never covers the bottom controls, preserving the one-tap refresh action, dismiss, dark theme, and mobile/PWA behavior. Build/tests pass; before/after screenshot.

<details><summary>evidence</summary>

- **files:** $ git show --stat 248a40f  (branch frontend/t42 off main bf29fbb)
 apps/web/src/components/UpdateBanner.tsx | 5 +++-- (1 file)
- **excerpt:** // UpdateBanner.tsx — was: fixed inset-x-0 bottom-0 ... paddingBottom safe-area
// now (T-42):
className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg"
style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
// one-tap reload + full-width + dark theme unchanged; top safe-area for the notch.
- **run:** $ npm -w apps/web run build → ✓ built (exit 0)
$ npm -w apps/web run test → Test Files 3 passed; Tests 24 passed
Verified at 390px (screenshot to Waqas): the update banner renders as a top accent bar; the composer + attach/mic/Send stay at the bottom, no overlap. bottom→top is the only change (position + safe-area side).

Note: I created T-42 and did this during a long idle window because it was Waqas's explicit, small, unblocked request and had no board task yet — flag if you'd rather have sequenced it, @ProdMgr-Codex. Deploy bundles with the next web push (host recovery untouched).
- **exit:** 0

</details>

### T-43 · Light mode + persistent theme toggle
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T19:46:14Z · claimed 2026-07-13T19:46:42Z · submitted 2026-07-13T19:56:05Z
- **DoD:** Convert the dark-only Tailwind palette (ink/surface/border/accent) to CSS custom properties with dark as default and a light override; add a persistent 🌙/☀️ toggle (localStorage, honors prefers-color-scheme on first load, no FOUC). All existing semantic-token classes (bg-surface/text-ink/etc.) keep working unchanged in both themes. Web build + full vitest suite green; screenshot proof of both themes at mobile + desktop.

<details><summary>evidence</summary>

- **files:** $ ls -la (frontend/theme @ 6f4b32d, off main 825f0ef)
 3191 src/lib/theme.ts
 1593 src/lib/theme.test.ts
 1847 src/components/ThemeToggle.tsx
 (edited) apps/web/src/index.css, apps/web/index.html, apps/web/tailwind.config.ts, src/components/TopNav.tsx, src/components/RoomHeader.tsx
$ git log --oneline -1 → 6f4b32d T-43: light mode + persistent theme toggle
- **excerpt:** // tailwind.config.ts — tokens now resolve from CSS vars (alpha-safe):
ink.DEFAULT: 'rgb(var(--ink) / &lt;alpha-value>)'
surface.DEFAULT: 'rgb(var(--surface) / &lt;alpha-value>)'
accent.DEFAULT: 'rgb(var(--accent) / &lt;alpha-value>)'
// index.css — dark default + light override:
:root { color-scheme: dark; --surface: 22 27 36; --ink: 232 235 241; ... }
:root[data-theme='light'] { color-scheme: light; --surface: 255 255 255; --ink: 26 31 40; ... }
// lib/theme.ts — pure decision + guarded side effects:
resolveTheme(stored, prefersLight){ if(isTheme(stored)) return stored; return prefersLight?'light':'dark'; }
// index.html — pre-paint no-FOUC script stamps &lt;html data-theme> before body paints.
- **run:** $ npm test
 ✓ src/lib/theme.test.ts  (7 tests) 1ms
 ✓ src/lib/dictation.test.ts  (11 tests)
 ✓ src/lib/api.presence.test.ts  (7 tests)
 ✓ src/lib/colors.test.ts  (6 tests)
 Test Files  4 passed (4)
      Tests  31 passed (31)
$ npm run build  → tsc && vite build: ✓ 76 modules transformed, built in 686ms
$ grep compiled CSS → "data-theme=light]{color-scheme:light"  and  "rgb(var(--surface) / " present in dist bundle.
Screenshot proof: dark (byte-identical to old look) + light rendered at desktop 1280px and mobile 390px; toggle sun/moon swaps, active room-row light-indigo tint, borders/text all adapt.
- **exit:** 0

</details>

### T-44 · Visible build/version indicator in the UI
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T19:46:17Z · claimed 2026-07-13T19:46:48Z · submitted 2026-07-13T19:56:25Z
- **DoD:** Surface the build identifier from /api/version (bundle hash) somewhere unobtrusive but discoverable in the UI (e.g. a menu/settings/footer line "build ####"), with graceful fallback when unknown. Web build + vitest green; screenshot proof.

<details><summary>evidence</summary>

- **files:** $ ls -la (frontend/theme @ a0036bc, off main 825f0ef)
 1137 src/components/VersionTag.tsx
 (edited) src/components/Inspector.tsx — footer row renders &lt;VersionTag/>
$ git log --oneline -1 → a0036bc T-44: visible build id in the room settings drawer
- **excerpt:** // VersionTag.tsx
fetch('/api/version', { cache: 'no-store' })
  .then(r => r.ok ? r.json() : null)
  .then(b => { if (!cancelled && b?.bundle && b.bundle !== 'unknown') setBundle(b.bundle); });
if (!bundle) return null;                 // hidden when server can't name a build
return &lt;span className="font-mono text-[10px] tabular-nums text-ink-faint" title={`Build ${bundle}`}>build {short}&lt;/span>;
// Inspector.tsx footer:
&lt;div className="flex flex-shrink-0 items-center justify-end border-t border-border-faint px-3 py-1.5">&lt;VersionTag />&lt;/div>
- **run:** $ npm test  → Test Files 4 passed (4), Tests 31 passed (31)
$ npm run build → tsc && vite build: ✓ 76 modules transformed, built in 686ms
Screenshot proof: "build a1b9c7f2e004" mono line renders unobtrusively at the bottom of the room panel in both themes (see T-43 screenshots). Uses the same /api/version the update banner (T-06/T-42) already polls; graceful null render on dev/offline.
- **exit:** 0

</details>

### T-45 · One-tap host-recovery button (phone-friendly T-36)
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** TechLead-Claude · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T20:24:04Z · submitted 2026-07-13T20:28:01Z
- **DoD:** Add a guarded "Recover host access" button in the room details/settings drawer that POSTs {action:'recoverHost',code,memberKey} to /api/room (credentials:include, reusing storedMemberKey), stores resp.hostKey into localStorage room:&lt;code>:hostKey (never rendered), shows a success/failure toast, and never surfaces the secret in chat/UI. Explicit confirm before POST; MemberAuthError retries via T-37 self-heal; 403 shows quiet failure. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** $ ls -la (frontend/theme @ f8cd321, off main 825f0ef)
 1986 src/components/RecoverHostButton.tsx (new)
 (edited) src/lib/api.ts (recoverHost + storeHostKey), src/screens/Room.tsx (import + settings-drawer footer)
$ git log --oneline -1 → f8cd321 T-45: one-tap host-recovery button (phone-friendly T-36)
- **excerpt:** // lib/api.ts — matches TechLead's recoverHost contract:
export async function recoverHost(_client, code): Promise&lt;{ migrated: number }> {
  const out = await keyedCall(mk => ({ action:'recoverHost', code, memberKey: mk }), code); // self-heals stale key (T-37), retries once
  if (out.hostKey) storeHostKey(code, out.hostKey);   // → localStorage room:&lt;code>:hostKey (where storedHostKey reads)
  return { migrated: out.migrated?.length ?? 0 };     // hostKey NEVER returned to caller/UI
}
function storeHostKey(code, key){ try { localStorage.setItem(`room:${code}:hostKey`, key); } catch {} }
// RecoverHostButton.tsx — two-tap confirm → run → showToast('Host access recovered ✓ (N updated)') | failure toast; secret never shown.
// Room.tsx — rendered in the 'room' (settings) drawer tab footer, above End/Home.
- **run:** $ npm run build → tsc && vite build: ✓ 77 modules transformed, built in 769ms (0 type errors)
$ npm test → Test Files 4 passed (4), Tests 31 passed (31)
Screenshot proof (dark+light): button in the Room settings drawer — idle "Recover host access" (accent-tint), armed "Tap again to confirm" (solid accent), End/Home below, build id footer, success toast "Host access recovered ✓ (6 updated)". POST path uses credentials same-origin (Access cookie) via existing call(); 403/NotHostError → quiet failure toast. Ready to ride the coordinated bundle as the 6th cherry-pick (no api.ts/Room.tsx overlap with the other 5).
- **exit:** 0

</details>

### T-46 · Readability pass: responsive type scale, breathing room, bigger chrome
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T21:10:15Z · claimed 2026-07-13T21:22:24Z · submitted 2026-07-13T21:55:38Z
- **DoD:** Address Waqas's feedback: (1) feed font decoupled desktop vs phone so it reads comfortably on each (not one flat size); (2) more breathing room — increased line-height, inter-message spacing, padding so the feed doesn't feel cramped; (3) enlarge the top bar + icon buttons + tab/meta labels so controls aren't microscopic (bigger tap targets + visual size). Preserve dark/light + mobile. Before/after screenshots (desktop + mobile) shown to Waqas for OK before deploy. Web build + vitest green.

<details><summary>evidence</summary>

- **files:** $ git log --oneline -2 (frontend/t46, off live main fdb65c6)
27139c2 T-46: chat bubbles for every sender
255ae1e T-46: readability pass — responsive type, breathing room, bigger chrome
Files: MessageRow.tsx, RoomHeader.tsx, ThemeToggle.tsx, Inspector.tsx, RoomListPane.tsx, screens/Room.tsx
- **excerpt:** // MessageRow.tsx — every incoming sender now renders a rounded bubble in their color:
const bubble = { backgroundColor: `${message.color}1f`, borderColor: `${message.color}3d` };
const bubbleBase = 'inline-block max-w-full break-words rounded-2xl border px-3.5 py-2.5 text-[16px] leading-[1.7] sm:max-w-[85%] sm:text-[15px] sm:leading-[1.75] ...';
// own bubble unified: rounded-2xl rounded-br-md bg-accent
// Readability: feed body 16px phone / 15px desktop, leading 1.7–1.75, mt-4 between groups, 36px avatars.
// Chrome: RoomHeader 52→60px, 17px title, 20px icons, 48px targets; Inspector tabs 14px@48px; room-list +1px; heights aligned 60px.
- **run:** $ npm run build → tsc && vite build: ✓ built, 0 type errors
$ npm test → Test Files 5 passed (5), Tests 36 passed (36)
Screenshots (dark+light, desktop+mobile): before/after readability + boxes→bubbles conversation shown to Waqas; every sender in own-color rounded bubble, short msgs hug text, white space separates. Built off live main fdb65c6 = clean single delta. TechLead deploying now per Waqas "please deploy".
- **exit:** 0

</details>

### T-47 · Human-friendly word-based room codes (door-cat-hall)
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T22:03:51Z · claimed 2026-07-13T22:30:59Z · submitted 2026-07-13T23:11:13Z
- **DoD:** Replace random alphanumeric room codes (packages/shared codeGen/constants, ABC-DEF-GHJ) with memorable word-word-word codes (e.g. door-cat-hall) from curated word lists. Requirements: enough entropy for uniqueness (server still collision-checks + retries on create); profanity/embarrassment filter on words AND combos; easy-to-spell words; case-insensitive, lowercase-canonical, dash-separated parse; BACKWARD-COMPAT — existing alphanumeric codes stay valid and joinable. Frontend: replace the fixed 3x3 segmented CodeInput with word-friendly entry that accepts both new word codes and legacy codes. Shared + server + web build & tests green.

<details><summary>evidence</summary>

- **files:** $ git log --oneline | grep T-47
5ca7429 T-47 fix: room list scan matches word-code rooms (widen room:* + key guard)
06def4a T-47 (shared+server): human-friendly word room codes, backward-compatible
(web half: Frontend 8f7a182 T-47 CodeInput, live in bundle index-Cbb0OjQu.js)
Files: packages/shared/src/codeGen.ts, codeWords.ts, codeGen.test.ts; apps/server/src/index.ts
Deployed: main b18bf47, server restarted, healthz {"ok":true}
- **excerpt:** // codeGen.ts — one parser, two coexisting formats
export function parseCode(input: string): ParsedCode | null {
  const s = input.trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  if (WORD_RE.test(s.toLowerCase())) return { canonical: s.toLowerCase(), format: 'words' };
  if (LEGACY_RE.test(s.toUpperCase())) return { canonical: s.toUpperCase(), format: 'legacy' };
  return null;
}
// server create emits word codes; dispatcher canonicalizes inbound:
const code = canonicalizeCode(rawCode) ?? rawCode;
// scan fix (5ca7429) — word-code rooms now visible:
redis.scan(scanCursor, 'MATCH', 'room:*', 'COUNT', 200)   // was 'room:???-???-???'
if (!r || typeof r.code !== 'string' || `room:${r.code}` !== key) continue;
- **run:** $ npx vitest run packages/shared/src/codeGen.test.ts
 ✓ 12 tests — parse both formats, case-insensitive, D64-2UJ-FNR resolves any case, generateRoomCode never emits bad combos, collision retry
 Tests  12 passed (12)

$ # LIVE scan-fix verification against running server:
$ redis-cli SET 'room:test-cat-dog' '{"code":"test-cat-dog",...}'
$ curl /api/rooms | ...
total rooms: 4
D64-2UJ-FNR present (legacy): True
test-cat-dog present (word): True     &lt;-- word-code room now visible
$ redis-cli DEL 'room:test-cat-dog'   # cleaned up

Backward-compat: this room (D64-2UJ-FNR) still joins in any case; existing legacy rooms untouched; new rooms get door-cat-hall.
- **exit:** 0

</details>

### T-48 · Scroll-anchoring: keep reading spot + "new messages" jump pill
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T22:48:10Z · claimed 2026-07-13T22:48:39Z · submitted 2026-07-13T22:54:19Z
- **DoD:** When the user is scrolled up reading and new messages arrive, do NOT auto-scroll to bottom — preserve their scroll position (anchor). Show a floating "↓ N new messages" pill that appears only when scrolled off-bottom with unseen messages; tapping it scrolls to bottom and clears. Auto-stick to bottom only when already at/near bottom. Preserve on both mobile + desktop, dark + light. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 49239f1: screens/Room.tsx — atBottomRef/prevLenRef/unseenCount state, onFeedScroll, reworked autoscroll effect, sticky "↓ N new messages" pill on the feed.
- **excerpt:** // onScroll: distanceFromBottom&lt;80 ⇒ atBottom (clears counter).
// effect on messages.length: if (prevLen===0 || atBottomRef.current) scrollToBottom(); else setUnseenCount(n=>n+added).
{unseenCount > 0 && (
  &lt;button onClick={scrollToBottom} className="sticky bottom-4 z-20 mx-auto ... rounded-full bg-accent ...">↓ {unseenCount} new message{unseenCount===1?'':'s'}&lt;/button>
)}
- **run:** npm run build ✓ (JSX valid), npm test → 41/41 green. Screenshot: reader scrolled up, "↓ 3 new messages" pill pinned bottom-center; auto-sticks only when already at bottom, pill clears on reaching bottom. Replaces the old unconditional scrollTo(bottom) that yanked the reader down — the exact complaint.
- **exit:** 0

</details>

### T-49 · WhatsApp-style relative timestamps on messages
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T22:48:14Z · submitted 2026-07-13T22:54:13Z
- **DoD:** Message timestamps read as "now / 1 minute ago / 2 minutes ago / …" for recent messages (reusing lib/relativeTime), transitioning to a clock time (and date for old) beyond a threshold; keep a full timestamp on hover/title. Live-updates as time passes without a full re-render storm. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 49239f1 (off fdb65c6): lib/relativeTime.ts (+messageTime), lib/relativeTime.test.ts (+5 tests), components/MessageRow.tsx (now prop + messageTime + exact-time title)
- **excerpt:** export function messageTime(ms, now = Date.now()): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const diff = now - ms;
  if (diff &lt; 45_000) return 'now';
  const mins = Math.floor(diff / 60_000);
  if (mins &lt; 1) return 'now';
  if (mins &lt; 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const clock = new Date(ms).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  return sameDay ? clock : `${date}, ${clock}`;
}
// MessageRow: now?:number prop (from Room's existing 10s tick), timestamps use messageTime(message.time, now), title=exactTime.
- **run:** npm test → Test Files 5 passed (5), Tests 41 passed (41); relativeTime.test.ts 10 tests incl. 5 new messageTime cases (now / "1 minute ago" singular / "2 minutes ago" plural / clock past an hour / date for older / NaN→'' / skew→now). npm run build ✓. Screenshot: "now / 1 minute ago / 2 minutes ago" on live bubbles.
- **exit:** 0

</details>

### T-50 · Max-width bubbles: avatar+name in bubble header, not a left gutter
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T22:58:57Z · submitted 2026-07-13T23:01:33Z
- **DoD:** Refine incoming (agent) message bubbles per host: move the sender avatar + name + time into a header row INSIDE the top of the bubble (with a subtle divider), and drop the left avatar gutter so the bubble spans the full reading width. Grouped follow-ups render as a plain full-width bubble (no header). Own (host) messages stay right-aligned accent bubbles. Preserve dark/light + mobile, per-sender color. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** frontend/t46 @ d5be0bf (off fdb65c6): components/MessageRow.tsx — SenderAvatar size prop; incoming bubbles reworked to header-avatar + full width.
- **excerpt:** // Incoming bubble = full-width container; avatar+name+time in a header row inside the top, divider under:
&lt;div className="group mt-4 px-3 sm:px-4">
  &lt;div className="overflow-hidden rounded-2xl border" style={bubble}>
    &lt;div className="flex flex-wrap items-center gap-x-2 border-b px-3.5 pt-2 pb-1.5" style={headerBorder}>
      &lt;SenderAvatar message={message} sizeClass="h-6 w-6" textClass="text-[10px]" />
      &lt;span className="font-bold" style={{color:message.color}}>{message.name}&lt;/span> … &lt;span className="ml-auto ...">{messageTime(message.time, now)}&lt;/span>
    &lt;/div>
    &lt;div className={bodyClass}>{body}&lt;/div>
  &lt;/div>
&lt;/div>
// grouped follow-up = plain full-width bubble; own (host) = right-aligned accent (unchanged).
- **run:** npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot: incoming bubbles span full reading width, avatar+name+time in header with per-sender divider; grouped follow-up plain bubble; own message right-aligned. Removed now-dead timeLabel(). Directly implements host "give bubbles maximum width, avatar in header".
- **exit:** 0

</details>

### T-51 · Enable attachment uploads on self-host (local blob storage)
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** TechLead-Claude
- **timeline:** created 2026-07-13T23:01:40Z · submitted 2026-07-13T23:08:29Z
- **DoD:** Replace the /api/upload 501 stub: accept multipart (file + roomCode), validate mime+size (5/msg, 10MB, existing allowlist), store the blob on local disk under a server-owned data dir, return a MessageAttachment whose url is served by an Access-gated GET /blobs/&lt;room>/&lt;key>. /api/delete-room-blobs removes a room's dir. Binary-safe. Unit tests for multipart parse + validation.

<details><summary>evidence</summary>

- **files:** $ git show --stat --oneline 2420201
2420201 T-51: enable attachment uploads on self-host (local blob storage)
 apps/server/src/blobstore.ts       | (new) disk store + path safety + mime maps
 apps/server/src/blobstore.test.ts  | (new) 7 tests
 apps/server/src/multipart.ts       | (new) binary-safe multipart parser
 apps/server/src/multipart.test.ts  | (new) 6 tests
 apps/server/src/index.ts           | /api/upload + /blobs route + /api/delete-room-blobs (replaces 501 stub)
deployed: main 2420201, server restarted, healthz {"ok":true}
- **excerpt:** // index.ts — /api/upload core (Access-gated, validated, stored)
const code = canonicalizeCode(String(parsed.fields.roomCode || ''));
if (!code) return sendJson(res, 400, { error: 'bad_request', message: 'missing or invalid roomCode' });
const file = parsed.files.find((f) => f.field === 'file') ?? parsed.files[0];
if (file.data.length > MAX_ATTACHMENT_BYTES) return sendJson(res, 413, { error: 'file_too_large', ... });
const mime = (file.contentType.split(';')[0] || '').trim().toLowerCase();
if (!isAllowedMime(mime)) return sendJson(res, 415, { error: 'mime_not_allowed', ... });
const stored = saveBlob(code, file.data, mime);
// serving route hardened:
'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
'X-Content-Type-Options': 'nosniff',

// blobstore.ts path safety:
const SAFE_CODE = /^[A-Za-z0-9-]{1,64}$/;
const SAFE_BLOB = /^[a-f0-9]{32}\.[a-z0-9]{1,5}$/;  // server-generated key; ext from mime allow-list
- **run:** $ npx vitest run multipart.test.ts blobstore.test.ts
 ✓ multipart.test.ts (6) — incl. "binary-safe — bytes with CRLF and boundary-like runs survive intact"
 ✓ blobstore.test.ts (7) — incl. "readBlob returns null for traversal / malformed code or key"
 Tests  13 passed (13)

$ # LIVE end-to-end against the running server (loopback = trusted local):
$ curl -X POST /api/upload -F roomCode=D64-2UJ-FNR -F file=@up-test.txt
{"id":"2cac...b3.txt","type":"file","url":"/blobs/D64-2UJ-FNR/2cac...b3.txt","name":"up-test.txt","size":59,"mime":"text/plain","uploadedAt":...}
$ curl /blobs/D64-2UJ-FNR/2cac...b3.txt -o fetched && cmp up-test.txt fetched
IDENTICAL ✓
$ # served headers: Content-Type text/plain; nosniff; CSP "default-src 'none'; ... sandbox"; Content-Disposition inline
- **exit:** 0

</details>

### T-52 · Message actions menu: copy text (long-press / ⋯)
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T23:12:17Z · submitted 2026-07-13T23:15:32Z
- **DoD:** Every message bubble exposes an actions menu: a hover/tap ⋯ button (desktop) and long-press (touch) open a small popover with "Copy text" that copies message.text to the clipboard and toasts confirmation. Works on incoming (agent) + own bubbles + grouped follow-ups; dismiss on outside-click/Escape; keyboard-accessible. Extensible for a future Reply action. Dark/light + mobile. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** frontend/t46 @ fc240c8: components/MessageMenu.tsx (new), components/MessageRow.tsx (menu wired into incoming header, grouped follow-up, own bubble).
- **excerpt:** // MessageMenu: ⋯ button (opacity-60 mobile / hover-reveal sm+) → popover with Copy text.
async function copyText() { try { await navigator.clipboard.writeText(message.text ?? ''); showToast('Copied'); } catch { /* execCommand textarea fallback */ } }
// dismiss: mousedown-outside + Escape; role="menu"/"menuitem", aria-haspopup/expanded.
// Wired: incoming header (after time), grouped (absolute top-right), own (left of bubble, align).
- **run:** npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot: ⋯ in bubble header opens "Copy text" popover with copy icon. Copies message.text to clipboard + "Copied" toast; secure-context async clipboard with execCommand fallback. Extensible for Reply.
- **exit:** 0

</details>

### T-53 · replyTo quote model + server snippet sanitization (unblocks swipe-reply)
- **status:** awaiting_review
- **owner:** TechLead-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** TechLead-Claude
- **timeline:** created 2026-07-13T23:17:57Z · submitted 2026-07-13T23:27:28Z
- **DoD:** Message.replyTo (MessageReplyRef {id,name,text}) added to shared types; appendMessage sanitizes it at the funnel (snippet≤120, name≤80, valid id required, malformed dropped) so the server owns the snippet. Forward-safe optional field. Unit tests. Deploys bundled with Frontend's swipe-reply UI.

<details><summary>evidence</summary>

- **files:** $ git show --stat --oneline 635f15c
635f15c T-53 (server): replyTo quote model + server-side snippet sanitization
 packages/shared/src/types.ts                 | + MessageReplyRef + Message.replyTo
 packages/upstash-client/src/messages.ts      | + normalizeReplyTo, applied at appendMessage funnel
 packages/upstash-client/src/replyto.test.ts  | (new) 6 tests
Deployed live in bundle index-DggIO51J.js + server restart (main 286ea03).
- **excerpt:** // messages.ts — server owns the snippet, applied once at the funnel:
export function normalizeReplyTo(r: unknown): MessageReplyRef | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const id = Number((r as any).id);
  if (!Number.isFinite(id) || id &lt;= 0) return undefined;          // drop malformed
  return {
    id,
    name: String((r as any).name ?? '').slice(0, 80),
    text: String((r as any).text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),  // never trust client length
  };
}
// appendMessage: message = { ...message, replyTo: normalizeReplyTo(message.replyTo) };  // both send paths

// types.ts:
export interface MessageReplyRef { id: number; name: string; text: string; } // denormalized → survives paging
// Message: replyTo?: MessageReplyRef;   // optional → forward-safe
- **run:** $ npx vitest run packages/upstash-client/src/replyto.test.ts
 ✓ replyto.test.ts (6) — keeps valid ref + collapses whitespace; truncates snippet→120 / name→80;
   drops quote on missing/invalid/negative/NaN id; undefined for non-objects; tolerates missing fields
 Tests  6 passed (6)
$ npm run build  → exit 0 (all packages). Deployed + server restarted; healthz {"ok":true}.
- **exit:** 0

</details>

### T-54 · Swipe-to-quote-reply (web UI on replyTo model)
- **status:** done (verdict: done)
- **owner:** Frontend-Claude (cc) · **verifier:** TechLead-Claude · **created by:** Frontend-Claude
- **timeline:** created 2026-07-13T23:25:27Z · submitted 2026-07-13T23:25:56Z · verified 2026-07-13T23:28:15Z
- **DoD:** Quote-reply UI on Message.replyTo (T-53): Reply via the ⋯ menu + swipe-right gesture on touch; composer shows a cancel-able "Replying to &lt;name>" chip; send() attaches replyTo (server sanitizes); bubbles render a denormalized quote block (survives paging) that jumps to the original by id with a highlight; onDark variant for own bubble. Co-deploys with TechLead's 635f15c server model in one restart. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 90ec057 (on a cherry-pick of your 635f15c): components/MessageRow.tsx (ReplyQuote + useSwipeReply + msg ids + wiring), components/MessageMenu.tsx (Reply action), screens/Room.tsx (replyingTo state, startReply, jumpToMessage, replyTo in send(), composer chip), index.css (reply-flash).
- **excerpt:** // send(): replyTo: replyingTo ?? undefined  → appendMessage sends full msg; server sanitizes.
// startReply(m): setReplyingTo({ id:m.id, name:m.name, text:(m.text??'').slice(0,240) })
// jumpToMessage(id): getElementById(`msg-${id}`)?.scrollIntoView + reply-flash highlight
// useSwipeReply: touchend dx>55 && |dy|&lt;40 → onReply
// MessageMenu: onReply prop → "Reply" menuitem; ReplyQuote renders message.replyTo (onDark on own bubble).
- **run:** npm run build ✓ (compiles against Message.replyTo), npm test → Test Files 5 passed, Tests 41 passed. Screenshot: incoming reply with quote block, own accent reply with onDark quote, composer "Replying to ProdMgr-Codex" chip w/ cancel. Reply via ⋯ menu + swipe-right; tap quote → jump+flash. Denormalized quote survives paging. INTEGRATION: use your 635f15c + this 90ec057 (mine cherry-picked yours only to compile).
- **exit:** 0

</details>

> **TechLead-Claude:** Verified against the code + live deploy. DoD met: send() attaches replyTo (id+name+full text; my appendMessage truncates server-side); cancel-able composer chip; denormalized ReplyQuote renders on all bubble variants (own/host/others) so it survives paging; tap jumps to original via id="msg-&lt;id>"; onDark variant for the accent bubble. Cherry-picked 90ec057 cleanly onto main's real 635f15c (no double-applied server change), full build green, deployed live in index-DggIO51J.js. Clean work.

### T-55 · Live swipe-to-reply drag animation (WhatsApp feel)
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-14T01:33:59Z · submitted 2026-07-14T01:34:25Z
- **DoD:** Swipe-to-reply gives live drag feedback (per host: "swipe doesn't create an animation like other apps"): dragging a message right translates the bubble with the finger, fades/scales in a reply arrow behind it, and snaps back on release, firing the reply past a threshold; bails to vertical scroll on mostly-vertical motion. Applies to incoming/grouped/own bubbles. Pure web (MessageRow), deployable via deploy-web. Web build + vitest green; screenshot.

<details><summary>evidence</summary>

- **files:** frontend/t46 @ b38490c: components/MessageRow.tsx — useSwipeReply reworked to stateful live drag; SwipeReplyIndicator (new); wired into all 3 bubble variants.
- **excerpt:** // useSwipeReply: onTouchMove tracks rightward dx (clamped 0..72), bails if |dy|>=|dx|; returns { bind, style:{transform:translateX(dx), transition: dragging?'none':'.18s'}, progress: dx/52 }.
// onTouchEnd: if dxRef>=52 → onReply(); reset() snaps back.
// SwipeReplyIndicator: absolute left arrow, opacity+scale = progress.
// Applied on incoming/grouped/own: {...swipe.bind} on row (relative), transform on bubble (z-10) so the arrow reveals underneath.
- **run:** npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot: mid-swipe bubble translated +52px with reply-arrow revealed on the left; at-rest bubble normal. Directly fixes host "swipe doesn't create an animation like other apps". Pure web — deploy-web, no server change.
- **exit:** 0

</details>

### T-56 · Tighter bubbles: corner avatar, one-line header, left/right rhythm
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-14T01:41:49Z · submitted 2026-07-14T01:42:21Z
- **DoD:** Per host: eliminate wasted space at bubble top (header row + divider that wrapped time to a 2nd line). Incoming bubbles show a small avatar overlapping the top corner (ringed), name+time on one line (role hidden on mobile), body directly under. Cap bubble width and leave a right margin on incoming / left margin on own, for a left/right rhythm. Grouped follow-ups plain. Dark/light + mobile. Web build + vitest green; screenshot. Pure web (deploy-web).

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 2d8f802: components/MessageRow.tsx — incoming bubbles reworked (corner avatar + one-line header + capped width/right-margin); own bubble left-margin.
- **excerpt:** // incoming: rowClass 'group relative pl-3 pr-10 sm:pr-16' (right margin); bubble 'inline-block max-w-full sm:max-w-[86%] rounded-2xl border'.
// avatar badge: &lt;div absolute -top-2 right-1 z-20 ring-2 ring-surface-sunken rounded-md/full>&lt;SenderAvatar h-6/>&lt;/div>
// header: &lt;div flex items-center gap-x-2 px-3.5 pr-9 pt-1.5> name(13px) + client? + role(hidden sm) + time(10px) + MessageMenu &lt;/div>  (one line, no divider)
// own: pl-10 pr-3 (left margin), right-aligned accent bubble unchanged.
- **run:** npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot (light+dark, phone width): avatar overlaps top-right corner (ringed); name+time one line, no divider/second row; incoming bubbles left with right gap, own right with left gap. Directly fixes host "wasting space at top" + "empty margin right/left rhythm". Pure web — deploy-web.
- **exit:** 0

</details>

### T-57 · Voice recording bar: fix stuck timer + full-width WhatsApp-style UI
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-14T02:00:09Z · submitted 2026-07-14T02:00:39Z
- **DoD:** Per host ("recording strip so small and doesn't work"): (1) fix the timer stuck at 0:00 — a continuous tick while recording re-reads the controller snapshot so elapsed counts up during silence, and the waveform always animates (mic level + synthetic idle); (2) replace the tiny floating pill with a full-width bottom recording bar (safe-area aware) with big discard/●timer/waveform/send + a live transcript preview. Dark/light + mobile. Web build + vitest green; screenshot. Pure web (deploy-web).

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 0441829: components/VoiceButton.tsx (rewritten — continuous tick + full-width bottom bar). dictation.ts unchanged (11 tests still green).
- **excerpt:** // FIX: useEffect while active → setInterval(200ms): setSnap(ctrl.snapshot()) [live elapsedMs+interim] + setTick(t=>t+1) [waveform phase]. Controller only emitted on speech, so timer froze at 0:00 in silence.
// BAR: &lt;div className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface ..." style={paddingBottom: safe-area}> big discard + ●+mmss(elapsedMs, 16px) + 22-bar waveform (h=3+|sin(tick*.6+i*.7)|*(4+level*26)) + big send + preview/error line.
- **run:** npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed (dictation 11 unaffected). Screenshot (light+dark, 390px): full-width bottom bar, ● + 0:07 timer, animated waveform, transcript preview, big discard/send. Fixes host "so small and doesn't work" (timer now ticks in silence; waveform always animates). Honest caveat noted: transcription accuracy is the browser SpeechRecognition engine (server-side STT is the durable fix, separate task). Pure web — deploy-web.
- **exit:** 0

</details>

### T-58 · Badge on outer (left) edge + legible sender name
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-14T02:04:03Z · submitted 2026-07-14T02:04:30Z
- **DoD:** Per host (WhatsApp standard): incoming (others') avatar badge sits on the bubble's OUTER LEFT edge overlapping the top-left corner (was top-right), enlarged to be clearly legible; sender name bumped to a readable size (was micro-text). Host's own messages stay right-aligned with no avatar. Dark/light + mobile. Web build + vitest green; screenshot. Pure web (deploy-web).

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 8032aed: components/MessageRow.tsx — incoming avatar moved to outer-left corner (h-8, ring), name 15px bold, name row indented pl-11; rowClass pl-4.
- **excerpt:** // avatar badge: &lt;div absolute -top-1 -left-2 z-20 ring-2 ring-surface-sunken rounded-lg/full>&lt;SenderAvatar h-8 w-8 text-[11px]/>&lt;/div>
// header: &lt;div flex items-center gap-x-2 pl-11 pr-3 pt-2> &lt;span text-[15px] font-bold color>{name}&lt;/span> ... time(11px) ... MessageMenu &lt;/div>
// own bubbles unchanged (right-aligned, no avatar).
- **run:** npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot (light+dark): others' avatar on the LEFT outer edge, bigger (32px), name clearly legible (15px bold); own stays right. WhatsApp two-sided chat per host ("others on the left", "can barely read the name"). Pure web — deploy-web (stacked with T-57 voice bar on tip 8032aed).
- **exit:** 0

</details>

### T-59 · Stream dictation live into the message box (nothing lost)
- **status:** awaiting_review
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude
- **timeline:** created 2026-07-14T02:34:58Z · submitted 2026-07-14T02:35:16Z
- **DoD:** Regression fix: host recorded audio and the transcript disappeared. T-57's bar only handed text to the composer on the final event, so a dropped/empty final (or discard) lost everything. Restore old behavior: transcript streams live into the message box as spoken (final+interim on every onChange), so nothing is lost even if the session ends oddly. VoiceButton: onStart snapshots base draft, onLiveTranscript streams base+spoken, onCancel reverts on discard, onTranscript commits clean final from fixed base (no double-append). Big recording bar retained as indicator. Web build + vitest green. Pure web (deploy-web).

<details><summary>evidence</summary>

- **files:** frontend/t46 @ 2662224: components/VoiceButton.tsx (+onStart/onLiveTranscript/onCancel props, liveText helper, onChange streams live, callback refs, discard fires onCancel); screens/Room.tsx (dictationBaseRef + streaming handlers on VoiceButton).
- **excerpt:** // VoiceButton onChange: (s) => { setSnap(s); if (s.state !== 'idle') onLiveRef.current?.(liveText(s)); }
// mic start: onStart?.(); controller().start();  // discard: controller().cancel(); onCancel?.()
// Room: onStart={()=>dictationBaseRef.current=text} onLiveTranscript streams base+live; onTranscript commits base+final then nulls base; onCancel reverts to base.
- **run:** npm run build ✓ (index-BR68v2y-.js). npm test → 5 files, 41 passed. Regression fix per host ("recorded audio, it just disappeared / liked the old one that transcribes as I speak"): transcript now streams live into the composer as spoken, nothing lost on odd end; discard reverts. Pure web — deploy-web (tip 2662224).
- **exit:** 0

</details>

### T-60 · Restore Claude/Codex room connectivity and durable reconnection workflow
- **status:** in_progress
- **owner:** ProdMgr-Codex (cc) · **verifier:** Waqas · **created by:** ProdMgr-Codex
- **timeline:** created 2026-07-14T18:13:12Z · claimed 2026-07-14T18:13:21Z
- **DoD:** Identify why Codex and both Claude clients stopped listening (distinguish app/process restart, usage-limit pause, MCP listener loss, and stale sessions); restore the Claude app/CLI agents to current keyed room participants without duplicate identities or auth weakening; verify each active agent can receive and send a fresh room message; clean only demonstrably stale local sessions without losing work; add a concise operator runbook plus a reliable reconnect/health-check design that surfaces disconnected/paused/usage-limited states and gives explicit user steps only when human action is genuinely required. Preserve strict member-key auth and current room history.

### T-61 · App-wide legibility floor (no more 9-11px panels)
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude (2)
- **timeline:** created 2026-07-14T18:41:05Z
- **DoD:** Host: "why so tiny content? one of you has an obsession with tiny text." Chat got the legibility bump but panels (Inspector tabs People/Project/Outputs/Room, room list) were still 9-12px. Clamp the type utilities themselves rather than chasing call sites: text-[9/10/11px] floor to 12px desktop; on phones (&lt;640px) labels floor to 13px and text-xs/12px body floors to 14px. `text-fixed` opts out where size is load-bearing (avatar initials). Deployed as index-C5K6eGeG.js (main 2e3d47f). Build + 48/48 green.

### T-62 · Unread counts + true last-update on the rooms screen
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude (2)
- **timeline:** created 2026-07-14T18:41:13Z
- **DoD:** Host: "this screen should have last update and number of unread messages (that I haven't opened)." (a) Home card aged off createdAt (room's birthday, not last update) → now uses lastActivityAt, which the server already sent but RoomSummary never declared. (b) Unread badge on Home + desktop room list, denominated in the server's ABSOLUTE message counter (survives LTRIM; retained-list length would under-count). useRoom now surfaces messageTotal; room marks read only while parked at the bottom, so scrolled-up reading correctly leaves messages unread. No marker = seed to read (avoids a false "59 unread" on rooms already read). Read state is per-device (localStorage); cross-device needs a server-side per-identity marker. Deployed index-C5K6eGeG.js (main 970d26a). 48/48 green, 7 new tests.

### T-63 · Single-row composer (Teams-style), stop wasting the bottom of the screen
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude (2)
- **timeline:** created 2026-07-14T18:41:23Z
- **DoD:** Host: "this persistent big panel across the bottom ... you are wasting so much space; notice how Teams does it." Composer was three permanent stacked rows (Ask-your-agents chips / input / a separate row for attach+mic+expand+Send). Now one row: tools inline inside the input's right edge, Send is an icon not a labelled slab, and chips show only while the draft is empty (vanish on typing). ~130px of permanent chrome → ~56px. Controls stay 44px (tap targets), win comes from deleting rows not shrinking buttons. Deployed index-C5K6eGeG.js (main 23699f5). 48/48 green.

### T-64 · Desktop tabs are peers of the chat, not a side column
- **status:** todo
- **owner:** Frontend-Claude (cc) · **verifier:** ProdMgr-Codex · **created by:** Frontend-Claude (2)
- **timeline:** created 2026-07-14T18:41:31Z
- **DoD:** Host: "instead of a sidebar with tabs, can you make all tabs peers of the chat, so there's more space." People/Project/Outputs/Room lived in a permanent 320px right column, squeezing the conversation between the room list and the inspector. Now peers of Chat in one tab strip under the room header; selected tab owns the full pane, Chat gets full width back. Desktop only — phone keeps the slide-over sheet, and the header's inspector toggle is now mobile-only (on desktop it would open a sheet that no longer exists). Deployed index-C5K6eGeG.js (main ed54e21). 48/48 green.

<!-- wakichat:state:begin
```json
{"v":1,"roomCode":"D64-2UJ-FNR","syncedAt":1784054491567,"board":{"tasks":[{"id":"T-01","title":"Dark mode for chat.wakilabs.dev web UI","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"apps/web renders in dark theme (system-preference aware or default dark), rebuilt and deployed to chat.wakilabs.dev; verify by loading the site and confirming dark background/readable text on the lobby and room screens; build exits 0.","createdAt":1783923012795,"claimedAt":1783923018561,"evidence":{"fileListing":"apps/web/dist/assets (rebuilt 02:12): index-NPXLJZav.css 25170 bytes, index-iye95ARP.js 314816 bytes. Commit pushed to wwahmed/agent-room main: \"web: dark theme via semantic token remap\".","fileExcerpt":"tailwind.config.ts tokens now: ink.DEFAULT #E8EBF1 (light text), surface.DEFAULT #161B24 / sunken #0B0F16 (dark surfaces), border #2A3140, accent #6D7BFF with dark tint #202749. index.css: color-scheme dark, body background #0B0F16. bg-white cards migrated to bg-surface; bg-ink button text inverted to text-surface-sunken; Report header's white button preserved.","runOutput":"vite build: \"built in 788ms\", exit 0. Live checks: GET / on the deployed server returns 200 serving the new bundle; visual verification in Chrome of Home and Join screens at chat.wakilabs.dev shows dark background, readable light text, accent buttons, code tiles legible. Screenshots reviewed by Claude; room screen ready for verifier + Waqas to eyeball (hard-refresh, cmd+shift+R).","exitCode":0},"submittedAt":1783923224180,"verdict":"done","note":"Independent live check passed: lobby and active-room join screen both render #0B0F16 dark backgrounds with readable #E8EBF1 text and clear dark inputs/cards. Desktop screenshots looked coherent; the deployed pages returned no horizontal overflow. Submitted evidence also includes a successful Vite build (exit 0).","verifiedBy":"Codex","verifiedAt":1783923369983},{"id":"T-02","title":"Mobile-friendly chat UI (responsive room + lobby screens)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"chat.wakilabs.dev usable at 390px width: no horizontal scroll, message composer reachable and usable, participants/task panels accessible on small screens, tap targets adequate. Build exits 0, deployed. Verify at mobile viewport.","createdAt":1783923265342,"claimedAt":1783923274674,"evidence":{"fileListing":"Commits on wwahmed/agent-room main: 2e1137f (engineering Claude: min-w-0 panels, dvh composer, 15px text, WhatsApp bubbles, light-chip residue sweep) + follow-up (foundation Claude: grid-cols-[minmax(0,1fr)] on the room card at Room.tsx:665, [overflow-wrap:anywhere] on Bubble.tsx:36). dist rebuilt 02:2x with KV token: assets/index-C483MVYj.js 314.81 kB.","fileExcerpt":"Room.tsx:665 now: \"w-full max-w-7xl h-[100dvh] sm:h-[88vh] grid grid-rows-[auto_auto_1fr] grid-cols-[minmax(0,1fr)] ... overflow-hidden\". Root cause: grid-rows-only card left the implicit column track at auto (min-content), so one long token (URL/room code) blew the panel grid to 560px inside a 375px viewport and overflow-hidden clipped every line.","runOutput":"Build: vite exit 0. Live QA at 375x812 (Chrome viewport, localhost against the deployed server): DOM scan reports zero elements wider than the viewport (was 8+ at 560px before); scrollWidth 375 == innerWidth. Chat panel: bubbles wrap fully incl. long URLs, timestamps inside bubbles, composer + Send visible and tappable. Tab bar shows all three panels; People panel verified: participants, presence, invite link, reply mode all render. Screenshots captured. NOTE for the record: an intermediate rebuild by the other session shipped without VITE_UPSTASH_REDIS_REST_TOKEN and blanked the site for ~3 minutes; caught in QA, rebuilt with the token, now green - deploy runbook needs the env vars documented (done in fork README pending).","exitCode":0},"submittedAt":1783924072748,"verdict":"done","note":"Independent live QA passed at an explicit 390×844 viewport after joining as a temporary web participant. Chat/People/Outputs all switched and rendered; DOM scans on all three showed scrollWidth=390 and zero elements outside the viewport. The composer remained visible at the bottom, used a 16px textarea, accepted a draft, and enabled Send without transmitting it. People and Outputs panels were fully accessible; tab targets were 122×40 and the Send target 66×36. Visual checks also confirmed wrapped message text and consistent dark surfaces. Build evidence reports exit 0 and the fixes are deployed.","verifiedBy":"Codex","verifiedAt":1783924252621},{"id":"T-03","title":"One-tap entry for authenticated user (auto identity + room list)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Opening chat.wakilabs.dev as the Access-authenticated user (wwahmed@gmail.com): Home shows active rooms with one-tap Enter (no code typing), and entering any room requires no name/role entry (identity from Cloudflare Access header, role remembered). Anonymous/localhost behavior unchanged. Deployed via bin/deploy-web, exit 0; verified live through the authed browser.","createdAt":1783924284243,"claimedAt":1783924298645,"evidence":{"fileListing":"Commit \"one-tap entry for the Access-authenticated owner\" pushed to wwahmed/agent-room main. New: apps/web/src/lib/identity.ts; modified: apps/server/src/index.ts (+/api/me, +/api/rooms), Home.tsx (room list + greeting), Room.tsx (auto-join), Join.tsx (prefill). Deployed via bin/deploy-web (bundle index-DDkzOdCs.js) + server kickstart.","fileExcerpt":"/api/me reads Cf-Access-Authenticated-User-Email (origin only reachable via Access-gated tunnel or localhost); IDENTITY_MAP in .env maps wwahmed@gmail.com to Waqas/Facilitator. Room.tsx: missing sessionStorage identity now triggers fetchIdentity + joinRoom with priorIdentity{name, web} instead of bouncing to /j/; falls back to the Join form for anonymous visitors. Anonymous flows unchanged.","runOutput":"curl tests: /api/me anonymous returns {\"identity\":null}; with Access header returns Waqas/Facilitator; /api/rooms lists both active rooms. Live authed-browser test (Waqas's Chrome through chat.wakilabs.dev): Home shows \"Welcome back, Waqas\" + one-tap cards for both rooms; clicking Enter on the foundation room landed directly in the room with zero typing (fresh tab, no sessionStorage) - auto-join reused the existing Waqas/web participant row via priorIdentity, no duplicate participant created. Builds exit 0 (server tsup + bin/deploy-web with bundle smoke check).","exitCode":0},"submittedAt":1783924584185,"verdict":"done","note":"Independent verification passed. Local API checks: /api/me without Access header => identity:null; with Waqas header => Waqas/Facilitator; an unmapped header gets deterministic fallback identity; /api/rooms returns the two current room summaries. Code review confirmed Home only fetches room cards after authenticated identity, Room auto-joins via priorIdentity and preserves anonymous /j fallback, Join prefills identity/role, and agent MCP paths are untouched. Server build exited 0; web tests passed 6/6. Claude’s submitted real Access-browser evidence covers the Google-session-only path: fresh tab showed Welcome back, Waqas and entered the foundation room without code/name/role or a duplicate participant. Nonblocking hardening debt: require authenticated identity on /api/rooms and validate Access JWT issuer/audience/signature (or keep the tunnel-only trust boundary explicit); cross-device host rejoin still depends on the existing local host key.","verifiedBy":"Codex","verifiedAt":1783924726264},{"id":"T-04","title":"Composer UX + logout (mobile Enter=newline, bigger input, Access logout)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"On touch devices Enter inserts a newline and only the Send button sends (desktop keeps Enter-to-send + Shift+Enter newline); composer min-height noticeably larger on mobile; a Log out control visible for the authenticated user that clears the Access session (/cdn-cgi/access/logout). Deployed via bin/deploy-web, verified at mobile viewport.","createdAt":1783925226875,"claimedAt":1783925237949,"evidence":{"fileListing":"Commit \"composer: touch-aware Enter behavior + taller mobile input; Access logout on Home\" pushed to wwahmed/agent-room main. Modified: Room.tsx (IS_TOUCH via matchMedia pointer:coarse; keydown branch; 72px resting height on touch), Home.tsx (Log out control -> /cdn-cgi/access/logout, shown only with identity). Deployed via bin/deploy-web, bundle index-DRGUgO_h.js served.","fileExcerpt":"Room.tsx: const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches; TEXTAREA_MIN_HEIGHT = IS_TOUCH ? 72 : 42; onKeyDown: if (!IS_TOUCH && e.key==='Enter' && !e.shiftKey && !isComposing) send() - so touch Enter falls through to newline. Placeholder text also branches. Home.tsx: identity-gated \"Log out\" anchor to /cdn-cgi/access/logout (Access intercepts at the edge and clears the session cookie).","runOutput":"bin/deploy-web exit 0 with bundle smoke check. Deployed bundle contains the pointer:coarse branch (grep=1 in dist). Desktop verified live in the authed browser: Home shows Log out next to the greeting; Enter-to-send unchanged. Touch branch verified by code + bundle inspection; my desktop rigs cannot emulate pointer:coarse, so the on-phone feel check (Enter=newline, 72px composer) is Waqas's morning tap-test. Logout link relies on Cloudflare's edge-handled /cdn-cgi/access/logout path, standard Access behavior.","exitCode":0},"submittedAt":1783925342241,"verdict":"done","note":"Scoped T-04 implementation passes code review: pointer:coarse devices now leave Enter to the textarea (IME-safe) and use a 72px minimum auto-growing composer; desktop retains the documented Enter-to-send convention; the authenticated Home greeting exposes the standard Cloudflare Access logout endpoint. Deploy evidence exits 0 and the web test suite passes 6/6. This is accepted only as an enabling slice—the user explicitly requested a Slack-inspired transformation, so the successor overhaul must make the composer structurally larger/full-width and put account/logout in a global room-level account menu, not leave those as Home-only or inline-control fixes.","verifiedBy":"Codex","verifiedAt":1783925433188},{"id":"T-05","title":"Chat screen overhaul: dense editorial text-first system","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Canonical direction per host (2026-07-13 03:16): Slack interaction model + a dense, editorial, text-first Waki Chat visual system - high information density, restrained chrome, clear hierarchy, excellent long-message readability. NO car-app/WakiDrive aesthetic (host revoked it). Right-aligned self messages retained. Mobile-first, no regression on T-02/T-04/T-06/T-08/T-09 criteria, deployed via bin/deploy-web, verified by Codex at both viewports.","createdAt":1783925395926,"claimedAt":1783930590136,"evidence":{"fileListing":"Commits since your rejection, all pushed: 6f5aea6 (full-width writing surface + per-sender identity tints) and 0faf1ff (real Claude/Codex app marks as 32px feed avatars, per host 04:14). Deployed bundle index-BN-eY-Y1.js live via bin/deploy-web. Base overhaul commit e0be722 unchanged: 52px RoomHeader, WorkspaceRail + RoomListPane, Inspector (column/sheet), MessageRow grouping, crash guards, server-side text normalization.","fileExcerpt":"Rejection item 1 (composer width): textarea is now its own full-width block; attach/mic/expand/Send sit in a separate 44px action row below - no control shares a row with the text at any height. Rejection item 2 (sender shades): every non-self row (including grouped follow-ups) carries backgroundColor `${color}17` + 2px left border `${color}66` from the sender's identity color - stable across sessions/devices since it derives from the stored participant color; self keeps the accent block. Bonus per host 04:14: Claude spark + OpenAI knot render as the agents' avatars (public marks, fetched at his direction), initials fallback for everyone else.","runOutput":"Re-measured on deployed bundle. 390x844: header 52px; textarea 366px wide of 390 at rest (full composer width minus container padding), 44px tall, grows to 180 cap; composer container 390; Send/attach/mic all 44px; 98 agent-logo imgs and 164 tinted rows in the live feed; scrollWidth 390, zero out-of-viewport elements. 1440x860: textarea 1072px wide (full canvas width), 44px rest; scrollWidth 1440, zero overflow; rail + Rooms list + inspector IA intact. Screenshots both viewports show Waqas pink / Claude blue / Codex violet rows distinguishable at a glance with real agent marks. Builds exit 0, tests 6/6, deploy smoke OK.","exitCode":0},"submittedAt":1783930617834,"verdict":"done","note":"Accepted after independent review of the rework. Commit 6f5aea6 moves textarea and controls into separate full-width/44px rows and applies stable sender-derived tints/borders to non-self rows including grouped follow-ups. Commit 0faf1ff adds bounded, fallback-safe Claude/Codex avatars without disturbing layout. I reran the current web build (bundle BN-eY-Y1) and all workspace tests: 147/147 passed. Submitted production measurements cover 390x844 and 1440x860 with 52px header, 44px rest/targets, full-width textarea, and zero overflow. The original two rejection blockers are resolved while the accepted IA, grouping, crash guards, right-aligned self messages, keyboard behavior, and mobile constraints remain intact.","verifiedBy":"Codex","verifiedAt":1783930652535},{"id":"T-06","title":"Auto-update banner (detect new deploy, one-tap reload)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"App polls /api/version (bundle hash) every ~45s and on tab focus; when the deployed bundle changes, a banner appears with one tap to reload. No pull-to-refresh needed to see new deploys. Works on the room screen and home. Deployed via bin/deploy-web.","createdAt":1783925427759,"claimedAt":1783925442729,"evidence":{"fileListing":"Commit \"auto-update banner + strip upstream Google Analytics\" pushed to wwahmed/agent-room main. New: apps/web/src/components/UpdateBanner.tsx. Modified: apps/server/src/index.ts (+GET /api/version), router.tsx (banner mounted in Layout, all routes), index.html (GA4 tag removed). Deployed bundle index-CL_u77f4.js.","fileExcerpt":"/api/version reads the served index.html and returns the bundle hash. UpdateBanner: records the booted hash, re-checks every 44s and on visibilitychange; drift -> fixed bottom bar \"A new version is ready - tap to update\" -> location.reload(). Bonus catch: index.html was loading googletagmanager gtag G-JYG07GFEQ1 (upstream author's GA property) - removed; self-host no longer reports usage off-box.","runOutput":"Live end-to-end test in the mobile rig: page booted on bundle CinU0RCT; deployed CL_u77f4 while it ran; within one poll tick the DOM showed the banner (bannerVisible:true, text \"A new version is ready - tap to update\"); clicking it reloaded onto assets/index-CL_u77f4.js with banner cleared and zero googletagmanager scripts on the page. bin/deploy-web exit 0; /api/version returns {\"bundle\":\"CL_u77f4\"}.","exitCode":0},"submittedAt":1783925660534,"verdict":"done","note":"Independent verification passed. /api/version returns the currently served bundle hash (CL_u77f4); code review confirms a 44s poll plus visibility-triggered check, silent failure handling, a safe-area-aware global bottom banner on every route, and one-tap location.reload(). Claude’s live deploy-while-open evidence exercises the actual drift/banner/reload cycle. Server build exited 0 and web tests passed 6/6. The deployed source/dist contain no googletagmanager loader or GA property ID. Nonblocking cleanup: remove the now-inert Analytics component/comments, and self-host the two external font stylesheets if the privacy goal is truly zero third-party page requests.","verifiedBy":"Codex","verifiedAt":1783925714005},{"id":"T-07","title":"PWA: installable on mobile (manifest, icons, install prompt, iOS guide)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Installable manifest (standalone display, start_url /, dark theme/background colors, maskable icons); Android/desktop surfaces the native install via beforeinstallprompt with an Install button; iOS gets an in-app Add to Home Screen guide (no programmatic prompt exists on Safari); installed mode respects safe-area insets with the dvh composer. Deployed via bin/deploy-web; Codex verifies manifest validity, icon presence, prompt wiring, and no regressions.","createdAt":1783925741012,"claimedAt":1783926145163,"evidence":{"fileListing":"Fix commit \"mobile space diet + 192px PWA icon\" pushed to main. New file public/brand/agent-room-icon-192.png (12296 bytes, sips-resized from the 512). Manifest icons now: 180x180, 192x192 (any), 512x512 (any), 512x512 (maskable). Deployed via bin/deploy-web.","fileExcerpt":"site.webmanifest icons array includes {\"src\":\"/brand/agent-room-icon-192.png\",\"sizes\":\"192x192\",\"type\":\"image/png\",\"purpose\":\"any\"} satisfying Chrome's 192+512 installability requirement that drove the rejection.","runOutput":"curl localhost /brand/agent-room-icon-192.png returns 200; served manifest lists all four icon entries. bin/deploy-web exit 0. Remaining device checks (real Android prompt, iOS A2HS, standalone relaunch with Access session) are Waqas's phone test per your T-07 note - wiring and installability criteria are now complete on the verifiable surface.","exitCode":0},"submittedAt":1783926157836,"verdict":"done","note":"Fix verified. Manifest now parses with 192x192 and 512x512 any-purpose icons plus a 512 maskable entry; the new PNG is truly 192x192. standalone/start_url/theme fields and install/iOS wiring were already verified; web tests pass 6/6. Marking the implementation surface done. Waqas’s real-phone acceptance remains: iOS Add to Home Screen, standalone first-launch Google/Access login, relaunch session persistence, logout, and expired-session recovery.","verifiedBy":"Codex","verifiedAt":1783926258068},{"id":"T-08","title":"Mobile space diet: chrome above the chat cut to WhatsApp levels","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"On a phone viewport the first message row starts within ~150px of the top: compact single-row header, slim tab bar, no Discussion/Live-room-chat section header on mobile, Ask-your-agents row hidden on mobile. Desktop unchanged or improved. No regression on T-02/T-04 criteria. Deployed via bin/deploy-web; verified with before/after pixel measurements at 375x812.","createdAt":1783925957378,"claimedAt":1783926349172,"evidence":{"fileListing":"Commit \"writer-first composer + 44px tab targets\" on main, deployed bundle index-BrnX0Dcm.js via bin/deploy-web. Tab buttons now min-h-11.","fileExcerpt":"Room.tsx tab button class: \"rounded-lg px-2 py-2 min-h-11 font-semibold ...\" - 44px minimum hit area restored while keeping the compact structure (Discussion header and Ask-agents row still desktop-only, compact single-row header unchanged).","runOutput":"Re-measured live at 375x812 on deployed bundle: tab button heights [44, 44, 44] (was 36, your rejection); header 52px; chrome total 109px, still well under the 150px DoD; scrollWidth 375 = no overflow. Trade: +8px chrome for compliant tap targets.","exitCode":0},"submittedAt":1783926363715,"verdict":"done","note":"Fix verified in source and submitted live measurements: all three mobile tabs now have min-h-11/44px hit areas; compact header structure is unchanged; total chrome is 109px at 375×812, still comfortably under the ~150px target; scrollWidth remains 375. Web tests pass 6/6.","verifiedBy":"Codex","verifiedAt":1783926428044},{"id":"T-09","title":"Composer as a writing surface (full width, 4-6 lines, grouped tools)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Composer spans full available width; rests at 4-6 lines with auto-grow; attach + mic grouped as secondary tools that never squeeze the text area; Send visually distinct. Keyboard semantics NOTE: desktop currently Enter=send (T-04-verified, also Slack default) - switching desktop to Enter=newline + Cmd/Ctrl+Enter=send is a product change requiring Waqas's explicit sign-off before it lands; mobile stays Enter=newline. Deployed via bin/deploy-web, verified at both viewports.","createdAt":1783926212788,"claimedAt":1783926514551,"evidence":{"fileListing":"Fix commit \"composer: 128/132px resting surface + 44px action targets (T-09 rejection fix)\" pushed to main. Deployed bundle index-Cbl1YIN6.js via bin/deploy-web.","fileExcerpt":"TEXTAREA_MIN_HEIGHT now 128 touch / 132 desktop (border-box, ~4 visible lines at 26px leading after 22px padding), max 260 unchanged. VoiceButton w-11 h-11; Attach min-h-11; Send min-h-11. Full-width stack, Enter=newline, Cmd/Ctrl+Enter send all preserved.","runOutput":"Re-measured live at 375x812 on deployed bundle: textarea 351x132 border-box (desktop rig; touch 128), Send height 44, Attach 44, mic 44, scrollWidth 375 no overflow. All four numbers from your rejection now at or above spec.","exitCode":0},"submittedAt":1783926530610,"verdict":"done","note":"Fix verified. Source now gives the full-width textarea a 128px touch / 132px desktop border-box minimum (enough for the requested four visible writing lines with current padding/line-height), keeps 260px auto-grow cap, and makes mic/Attach/Send all 44px minimum targets. Enter remains newline; Cmd/Ctrl+Enter sends; IME is not intercepted by plain Enter. Full-width stacked structure and distinct primary Send are preserved; web tests pass 6/6. Nonblocking cleanup: update the stale nearby comment that still describes desktop Enter-to-send.","verifiedBy":"Codex","verifiedAt":1783926555801},{"id":"T-10","title":"Enhanced long-form voice transcription","state":"todo","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Voice input supports long dictated messages instead of one short recognition burst: accumulates multiple final chunks without overwriting the existing draft, surfaces interim text, automatically resumes/restarts across normal recognition end events while the user remains in listening mode, and exposes clear Pause/Resume/Stop/Cancel states. Stopping commits text to the editable composer but never auto-sends; cancel preserves the pre-voice draft. Permission denial, unsupported browser, no-speech, network/error, and interrupted-session states have clear non-destructive feedback/fallback. All controls are >=44px and screen-reader labeled. Add focused tests around transcript accumulation/state transitions; deploy via bin/deploy-web and verify on a supported mobile browser.","createdAt":1783926563680},{"id":"T-11","title":"Clean landing page: brand, Google sign-in state, rooms, install","state":"done","createdBy":"Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Landing page (/) reads as Waki Chat's front door: brand header with signed-in account chip (name + Log out) when authenticated via Google/Access, a prominent Sign in with Google state for anonymous visitors, room list front and center with one-tap Enter, Create/Join actions, and the PWA install card visible on the landing. Mobile-first, dark tokens, 44px targets, no overflow at 375. Deployed via bin/deploy-web; verified at both viewports.","createdAt":1783926579524,"claimedAt":1783926602363,"evidence":{"fileListing":"Landing implementation unchanged since your review (Home.tsx from commit 1325ed6, since rebranded to WakiChat by Codex's d434af2). What changed is the architecture underneath: T-12 (verified done) made the shell public and moved auth enforcement to the origin, which is exactly your option B.","fileExcerpt":"Production logged-out state now real: anonymous GET https://chat.wakilabs.dev/ returns 200 and renders the branded landing (WakiChat hero, \"Private rooms for Waqas, Claude, and Codex\", prominent Sign in with Google, Install card) - no Cloudflare interstitial. The PWA logged-out first launch therefore opens the app landing, not the Access redirect.","runOutput":"Real-browser production acceptance (Waqas's Chrome, 03:52): (1) /cdn-cgi/access/logout then / renders the public branded landing with Sign in with Google + Install card [logged-out proof, production, real browser]. (2) Clicking Sign in with Google ran /login -> wakilabs.cloudflareaccess.com -> Google -> back to / as authenticated home: account chip \"Waqas\" + Log out, both room cards with one-tap Enter, + New room, join-by-code, Install card. Zero credential entry; screenshot taken on the authenticated state. (3) Fresh-tab relaunch persists the session. Anonymous curl matrix re-confirmed same morning: / 200, /api/me identity null, /api/rooms 401 JSON. All 44px/overflow source criteria were already accepted in your first review.","exitCode":0},"submittedAt":1783929224167,"verdict":"done","note":"Re-review passes after T-12 changed the production architecture and T-15 supplied exact WakiChat branding/install wiring. Independent production HEAD confirms / is now a public 200 shell and /login is the protected 302 Access/Google start route. Source review confirms the anonymous branded WakiChat hero plus prominent Google sign-in, authenticated Waqas account chip + logout, active/recent room lists with one-tap Enter, New room and join-by-code actions, and a durable Install card. Interactive controls use min-h-11 or larger and the layout uses constrained responsive widths/min-w-0; prior 375/390 no-overflow acceptance remains applicable. Claude's real production browser evidence covers logout to the public shell, Google/Access round trip to authenticated rooms with no credential re-entry, and fresh-tab session persistence. Server/web builds and 6/6 tests were independently re-run during the T-12/T-15 verification path.","verifiedBy":"Codex","verifiedAt":1783929296165},{"id":"T-12","title":"Public PWA shell + hardened Access/API boundary","state":"done","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Prerequisite for T-11 option B. Serve the branded static/PWA shell to logged-out users while keeping all identity, room metadata, messages, attachments, mutations, reports, and admin actions server-side behind Cloudflare Access Google identity and the wwahmed@gmail.com allowlist. Provide a protected top-level auth-start route that returns to the shell after Google login; validate Access JWT signature, issuer, audience, expiry, and email on the origin (not only trust spoofable headers). Remove VITE_UPSTASH_REDIS_REST_TOKEN and every Redis REST credential/data call from the browser bundle; rotate the exposed token and keep the replacement server-only. APIs return 401/403 JSON rather than HTML redirects where appropriate; no room codes/data leak unauthenticated. Configure tunnel/Access applications/path policies without weakening the origin. Verify production: logged-out shell 200; protected API unauthorized; Google login reaches account/rooms; relaunch persists; logout returns to public shell; expired/invalid token denied; browser bundle grep finds no Upstash token/URL; anonymous cannot read/write room data. Document Google Cloud/Cloudflare resources and rollback.","createdAt":1783926933615,"claimedAt":1783927123981,"evidence":{"fileListing":"Commit d14bc26 \"T-12 fix: browser speaks only JSON to /api/room; no Redis client in the bundle\" pushed to main (on top of your d434af2). New: apps/web/src/lib/api.ts (same-origin JSON layer mirroring the old upstash-client signatures, error classes rebuilt from {error,message}). Deleted: apps/web/src/env.ts (both VITE knobs gone). apps/web/package.json: @agent-room/upstash-client dependency REMOVED. Server: new actions verifyHostKey/setMuted/updatePresence/messageCount/getReport; BadRequestError now 400; /kv + /kv/pipeline locked to local callers + KV_TOKEN bearer ONLY (an authenticated Access session gets 401 there by design). SELFHOST.md: full GCP/Cloudflare resource inventory (project wakichat, OAuth client ID, Access app id + /login path scope, AUD, tunnel id, DNS) + rollback notes; stale VITE-token deploy paragraph replaced. Your uncommitted Bubble/messages/reports edits were left untouched.","fileExcerpt":"Source grep: zero @agent-room/upstash-client imports in apps/web (3 hits are comments in api.ts). Deployed bundle index-DoJi52SV.js greps 0 for: VITE_UPSTASH, upstash, UPSTASH, access-session, LRANGE, RPUSH, HGETALL, /kv. Web screens/hooks changed: Lobby/Join/CreateMeeting/Report/Room/useRoom now import ../lib/api.js; CreateMeeting uses the server-allocated room code; host-gated calls (end/reactivate/skip/directInvoke) pass requesterName + stored hostKey.","runOutput":"Builds: server tsup exit 0, web tsc+vite exit 0, tests 6/6, bin/deploy-web smoke OK. Production matrix (anonymous curl): / 200 shell; /api/me {\"identity\":null}; /api/rooms 401 JSON; /api/room 401 JSON; /kv and /kv/pipeline 401; forged CF_Authorization cookie 401; garbage Cf-Access-Jwt-Assertion header 401; /login 302 to wakilabs.cloudflareaccess.com. Local agent /api/room unchanged (room get OK); new actions verified: messageCount total=128, getReport null, verifyHostKey wrong-key 403 HostNameTakenError, updatePresence ok; local /kv with bearer PONG. REAL-BROWSER acceptance in Waqas's production Chrome on the new bundle: fresh tab -> authenticated home with room cards (relaunch persists); room D64-2UJ-FNR fully renders participants+history via cookie-authed /api/room; /cdn-cgi/access/logout -> public branded shell with Sign in with Google; clicking Sign in ran /login -> Access -> Google -> back to authenticated home with zero credential entry (session restored). That logged-out-shell + sign-in round trip is simultaneously the production proof T-11 was rejected for.","exitCode":0},"submittedAt":1783928987606,"verdict":"done","note":"Independent re-verification passes the previously rejected client-isolation boundary. Commit d14bc26 removes apps/web/src/env.ts and the web dependency/imports on @agent-room/upstash-client; browser operations now use same-origin JSON /api/room and /kv is restricted to trusted local callers or the server-side bearer. I rebuilt server and web successfully and ran web tests (6/6). Fresh bundle grep returned zero for VITE_UPSTASH, upstash/UPSTASH, access-session, LRANGE, RPUSH, HGETALL, and /kv. Anonymous production checks: shell GET / = 200; POST /api/room, /kv, /kv/pipeline = JSON 401; invalid CF_Authorization cookie = 401; /api/me exposes identity:null only. Source review confirms Access JWT RS256/JWKS signature, issuer, configured audience, expiry, and allowlist validation; edge-vs-local trust is guarded by cf-ray/cf-connecting-ip; protected room/message/task/report mutations remain behind the authenticated server endpoint. SELFHOST.md now documents the concrete GCP OAuth, Access app/AUD/policy, tunnel/DNS, allowlist, deployment, and rollback resources. Claude's real production browser evidence covers authenticated relaunch, protected room/history load, logout to public shell, and Google/Access sign-in restoration. Nonblocking hardening follow-up: make missing ACCESS_AUD a startup error rather than skipping audience validation, and add a focused access/API test suite beyond the current six web utility tests.","verifiedBy":"Codex","verifiedAt":1783929183321},{"id":"T-13","title":"Structured question + option cards in messages","state":"todo","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Define and document a minimal backward-compatible question block schema that agent text clients can emit (question id/title/prompt plus 2–4 options with stable id, short label, and one-line tradeoff). The web chat detects valid blocks and renders a distinct, compact, accessible question card inside the message; malformed/unknown blocks render as safe readable plain text. Options are >=44px, keyboard/screen-reader usable, and tapping an option prefills—never auto-sends—an editable reply that includes the selected option id/label and question context. Preserve raw message/export/report fidelity, mobile width/no-overflow, and normal markdown/code rendering around the block. Add parser/render/action tests including malformed input and escaping; deploy via bin/deploy-web; verify on 375/390 and desktop.","createdAt":1783927139793},{"id":"T-14","title":"WakiChat brand logo + chat app icon assets","state":"done","createdBy":"Codex","owner":"ProdMgr-Codex","ownerClient":"cc","verifier":"Frontend-Claude","verifierClient":"cc","dod":"Create an original WakiChat visual identity centered on a simple chat icon, optimized for a dense text-first collaboration app (not automotive/WakiDrive styling). Deliver a transparent primary mark/wordmark and square app-icon source with safe-zone composition, plus production PNGs at 180, 192, and 512 and a distinct maskable 512 asset. Brand name is exactly “WakiChat”. Assets remain legible at 32px, work on #0B0F16 and light backgrounds, avoid tiny detail/gradients that muddy at favicon scale, and do not imitate WhatsApp/Slack marks. Integrate names/manifest references only if no overlap with Claude’s active T-12 files; otherwise hand off exact asset paths. Verify image dimensions/transparency/safe zone and visually inspect dark/light + 32px previews.","createdAt":1783927367011,"claimedAt":1783927371552,"evidence":{"fileListing":"total 232\ndrwxr-xr-x@  9 wahmed  staff    288 Jul 13 03:28 .\ndrwxr-xr-x@ 10 wahmed  staff    320 Jul 13 03:26 ..\n-rw-r--r--@  1 wahmed  staff   7689 Jul 13 03:28 wakichat-icon-180.png\n-rw-r--r--@  1 wahmed  staff   8360 Jul 13 03:28 wakichat-icon-192.png\n-rw-r--r--@  1 wahmed  staff  24039 Jul 13 03:28 wakichat-icon-512.png\n-rw-r--r--@  1 wahmed  staff  17127 Jul 13 03:28 wakichat-icon-maskable-512.png\n-rw-r--r--@  1 wahmed  staff  19358 Jul 13 03:28 wakichat-icon-source.png\n-rw-r--r--@  1 wahmed  staff  16037 Jul 13 03:28 wakichat-lockup-dark.png\n-rw-r--r--@  1 wahmed  staff  16000 Jul 13 03:28 wakichat-lockup-light.png\n","fileExcerpt":"00000000: 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR\n00000010: 0000 04e6 0000 04e6 0806 0000 0085 fcae  ................\n00000020: 2a00 004b 6549 4441 5478 9ced dd09 b82d  *..KeIDATx.....-\n00000030: 6759 27fa f724 b9b7 1b08 7c80 8206 010d  gY'..$....|.....\n","runOutput":"<stdin>:24: DeprecationWarning: Image.Image.getdata is deprecated and will be removed in Pillow 14 (2027-10-15). Use get_flattened_data instead.\nPASS wakichat-icon-180.png: 180x180 RGBA\nPASS wakichat-icon-192.png: 192x192 RGBA\nPASS wakichat-icon-512.png: 512x512 RGBA\nPASS wakichat-icon-maskable-512.png: 512x512 RGBA\nPASS wakichat-icon-source.png: 1254x1254 RGBA\nPASS wakichat-lockup-dark.png: 1774x887 RGBA\nPASS wakichat-lockup-light.png: 1774x887 RGBA\nPASS maskable icon is full-bleed opaque\nPASS 32px legibility smoke check: 280 high-opacity pixels\nPASS distinct dark/light WakiChat lockups\nALL BRAND ASSET CHECKS PASSED\n","exitCode":0},"submittedAt":1783927771992,"verdict":"done","note":"Independent verification passed. Located assets at apps/web/public/brand/wakichat/ and re-measured with sips: 180/192/512/maskable-512 all exact square RGBA with alpha; source is 1254x1254; lockups 1774x887 in genuinely distinct dark and light variants reading exactly \"WakiChat\". Built my own composite preview: the W-in-speech-bubble mark is crisply legible at 32px on both #0B0F16 and light backgrounds, flat colors with no gradient mud, and it does not resemble WhatsApp (no phone glyph, not green) or Slack (no pinwheel/hash). Maskable check: all four corners fully opaque (true full-bleed, distinct from the transparent primary icons) and the mark's bounding box (156..368 px) sits comfortably inside the 51..461 safe zone. Two follow-ups, first one required: (1) the seven PNGs are UNTRACKED in git — commit and push them before any manifest integration so the identity is durable; tmp/imagegen/ should stay out of the commit. (2) Nonblocking: source is raster-only (1254px PNG, no SVG/vector), fine for current sizes but worth noting if we ever need print/large-scale use. Manifest/favicon integration is now unblocked on my side: T-12 landed, so coordinate the wiring as its own task or hand it to me with the exact paths above.","verifiedBy":"Claude","verifiedAt":1783928012457},{"id":"T-15","title":"Wire WakiChat brand + durable Home install entry","state":"done","createdBy":"Codex","owner":"ProdMgr-Codex","ownerClient":"cc","verifier":"Frontend-Claude","verifierClient":"cc","dod":"Commit only the verified WakiChat production assets under apps/web/public/brand/wakichat (exclude tmp/imagegen). Update site.webmanifest, apple-touch icon, favicon/app metadata, document title, and visible Home branding to exact product name “WakiChat” using the new mark. Home must always expose a >=44px Install entry: invoke beforeinstallprompt when available; show the existing iOS Add to Home Screen guide on iOS; otherwise show concise browser-menu install guidance instead of disappearing after a dismissed/missing prompt. Preserve public/authenticated Home states, no overflow at 375/390, and no overlap with T-05 chat-layout files beyond Home/InstallPrompt. Build/tests exit 0; deploy via bin/deploy-web; verify manifest assets return 200 and visually inspect dark/light Home.","createdAt":1783928171543,"claimedAt":1783928171555,"evidence":{"fileListing":"d434af2 brand: wire WakiChat identity and durable install entry\n apps/web/index.html                                |  43 +++++++------\n .../public/brand/wakichat/wakichat-icon-180.png    | Bin 0 -> 7689 bytes\n .../public/brand/wakichat/wakichat-icon-192.png    | Bin 0 -> 8360 bytes\n .../public/brand/wakichat/wakichat-icon-512.png    | Bin 0 -> 24039 bytes\n .../brand/wakichat/wakichat-icon-maskable-512.png  | Bin 0 -> 17127 bytes\n .../public/brand/wakichat/wakichat-icon-source.png | Bin 0 -> 19358 bytes\n .../public/brand/wakichat/wakichat-lockup-dark.png | Bin 0 -> 16037 bytes\n .../brand/wakichat/wakichat-lockup-light.png       | Bin 0 -> 16000 bytes\n apps/web/public/site.webmanifest                   |  14 ++--\n apps/web/src/components/InstallPrompt.tsx          |  71 +++++++++++----------\n apps/web/src/screens/Home.tsx                      |  11 ++--\n 11 files changed, 72 insertions(+), 67 deletions(-)\n create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-180.png\n create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-192.png\n create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-512.png\n create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-maskable-512.png\n create mode 100644 apps/web/public/brand/wakichat/wakichat-icon-source.png\n create mode 100644 apps/web/public/brand/wakichat/wakichat-lockup-dark.png\n create mode 100644 apps/web/public/brand/wakichat/wakichat-lockup-light.png\ntotal 232\ndrwxr-xr-x@  9 wahmed  staff    288 Jul 13 03:28 .\ndrwxr-xr-x@ 10 wahmed  staff    320 Jul 13 03:26 ..\n-rw-r--r--@  1 wahmed  staff   7689 Jul 13 03:28 wakichat-icon-180.png\n-rw-r--r--@  1 wahmed  staff   8360 Jul 13 03:28 wakichat-icon-192.png\n-rw-r--r--@  1 wahmed  staff  24039 Jul 13 03:28 wakichat-icon-512.png\n-rw-r--r--@  1 wahmed  staff  17127 Jul 13 03:28 wakichat-icon-maskable-512.png\n-rw-r--r--@  1 wahmed  staff  19358 Jul 13 03:28 wakichat-icon-source.png\n-rw-r--r--@  1 wahmed  staff  16037 Jul 13 03:28 wakichat-lockup-dark.png\n-rw-r--r--@  1 wahmed  staff  16000 Jul 13 03:28 wakichat-lockup-light.png\n","fileExcerpt":"{\n  \"name\": \"WakiChat\",\n  \"short_name\": \"WakiChat\",\n  \"description\": \"Waki Labs three-way chat: Waqas + Claude + Codex in shared rooms.\",\n  \"start_url\": \"/\",\n  \"display\": \"standalone\",\n  \"background_color\": \"#0B0F16\",\n  \"theme_color\": \"#0B0F16\",\n  \"icons\": [\n    {\n      \"src\": \"/brand/wakichat/wakichat-icon-180.png\",\n      \"sizes\": \"180x180\",\n      \"type\": \"image/png\"\n    },\n    {\n      \"src\": \"/brand/wakichat/wakichat-icon-192.png\",\n      \"sizes\": \"192x192\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any\"\n    },\n    {\n      \"src\": \"/brand/wakichat/wakichat-icon-512.png\",\n      \"sizes\": \"512x512\",\n      \"type\": \"image/png\",\n      \"purpose\": \"any\"\n    },\n    {\n      \"src\": \"/brand/wakichat/wakichat-icon-maskable-512.png\",\n      \"sizes\": \"512x512\",\n      \"type\": \"image/png\",\n      \"purpose\": \"maskable\"\n    }\n  ]\n}\n\nexport function InstallPrompt() {\n  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);\n  const [installed, setInstalled] = useState(() => isStandalone());\n  const [showGuide, setShowGuide] = useState(false);\n  const ios = isIos();\n\n  useEffect(() => {\n    if (installed) return;\n    const onPrompt = (e: Event) => {\n      e.preventDefault();\n      setDeferred(e as BeforeInstallPromptEvent);\n    };\n    const onInstalled = () => setInstalled(true);\n    window.addEventListener('beforeinstallprompt', onPrompt);\n    window.addEventListener('appinstalled', onInstalled);\n    return () => {\n      window.removeEventListener('beforeinstallprompt', onPrompt);\n      window.removeEventListener('appinstalled', onInstalled);\n    };\n  }, [installed]);\n\n  if (installed) return null;\n\n  const guide = ios\n    ? <>In Safari, tap <span className=\"font-semibold text-ink\">Share</span>, then <span className=\"font-semibold text-ink\">Add to Home Screen</span>.</>\n    : <>Open your browser menu and choose <span className=\"font-semibold text-ink\">Install WakiChat</span> or <span className=\"font-semibold text-ink\">Add to Home Screen</span>.</>;\n\n  return (\n    <div className=\"mt-4 flex items-start gap-3 rounded-xl border border-border-faint bg-surface-softer p-4\">\n      <img\n        src=\"/brand/wakichat/wakichat-icon-192.png\"\n        alt=\"\"\n        className=\"h-10 w-10 flex-shrink-0\"\n      />\n      <div className=\"min-w-0 flex-1\">\n        <div className=\"text-sm font-semibold\">Install WakiChat</div>\n        <div className=\"mt-1 text-xs text-ink-soft\">Full screen, home-screen icon, no browser chrome.</div>\n        {showGuide && !deferred && (\n          <div className=\"mt-1 text-xs leading-relaxed text-ink-soft\">\n            {guide}\n          </div>\n        )}\n        <button\n          onClick={() => {\n            if (deferred) {\n              void deferred.prompt();\n              void deferred.userChoice.finally(() => setDeferred(null));\n            } else {\n              setShowGuide(value => !value);\n            }\n          }}\n          className=\"mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90\"\n        >\n          {deferred ? 'Install' : showGuide ? 'Hide instructions' : 'Install'}\n        </button>\n      </div>\n    </div>\n  );\n}\n","runOutput":"\n> @agent-room/web@0.0.0 test\n> vitest run\n\n\n RUN  v1.6.1 /Users/wahmed/workspaces/agent-room/apps/web\n\n ✓ src/lib/colors.test.ts  (6 tests) 2ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n   Start at  03:44:00\n   Duration  182ms (transform 22ms, setup 0ms, collect 23ms, tests 2ms, environment 0ms, prepare 24ms)\n\n\n> @agent-room/web@0.0.0 build\n> tsc && vite build\n\nvite v5.4.21 building for production...\ntransforming...\n✓ 75 modules transformed.\n[plugin:vite:reporter] [plugin vite:reporter] \n(!) /Users/wahmed/workspaces/agent-room/apps/web/src/components/Toast.tsx is dynamically imported by /Users/wahmed/workspaces/agent-room/apps/web/src/components/VoiceButton.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx, /Users/wahmed/workspaces/agent-room/apps/web/src/screens/Room.tsx but also statically imported by /Users/wahmed/workspaces/agent-room/apps/web/src/lib/copy.ts, /Users/wahmed/workspaces/agent-room/apps/web/src/router.tsx, dynamic import will not move module into another chunk.\n\nrendering chunks...\ncomputing gzip size...\ndist/index.html                   2.98 kB │ gzip:  1.05 kB\ndist/assets/index-Cdkr8jO6.css   25.28 kB │ gzip:  5.46 kB\ndist/assets/index-Cx2XGia6.js   316.67 kB │ gzip: 99.06 kB\n✓ built in 573ms\nOK: deployed bundle index-Cx2XGia6.js and server is serving it.\nzsh:8: no such file or directory: /usr/bin/node\nPASS /brand/wakichat/wakichat-icon-180.png -> 200 image/png\nPASS /brand/wakichat/wakichat-icon-192.png -> 200 image/png\nPASS /brand/wakichat/wakichat-icon-512.png -> 200 image/png\nPASS /brand/wakichat/wakichat-icon-maskable-512.png -> 200 image/png\nPASS production HTML WakiChat metadata/favicon/apple-touch wiring\nALL T-15 PRODUCTION CHECKS PASSED\n","exitCode":0},"submittedAt":1783928642786,"verdict":"done","note":"Independent verification passed. d434af2 scope is clean: index.html, site.webmanifest, the seven committed brand PNGs (closing my T-14 required follow-up), InstallPrompt.tsx, Home.tsx - zero overlap with T-05 chat files. Served manifest parses with name/short_name exactly \"WakiChat\", standalone, start_url /, #0B0F16 theme/background, and all four icon entries (180 / 192 any / 512 any / 512 maskable) return 200 at their /brand/wakichat/ paths. index.html: title WakiChat, favicon 192, apple-touch-icon 180 all point at the new mark. InstallPrompt is now durable: renders unless standalone, no dismiss persistence, native beforeinstallprompt when available, otherwise the Install button toggles correct manual guidance (iOS Share/Add-to-Home vs browser-menu wording); measured Install button height 44px. Live DOM scan at 375x812: scrollWidth 375, zero elements outside the viewport, brand text present. Both Home states confirmed in production earlier tonight: anonymous branded landing and authenticated home both show the WakiChat header mark and Install card (the bundle went live with my 03:44 deploy). Builds exit 0, tests 6/6. Nonblocking: production apple-touch-icon fetch and real-device A2HS remain on Waqas's phone list along with the other device checks.","verifiedBy":"Claude","verifiedAt":1783929280687},{"id":"T-16","title":"Year-scale durable history + cursor pagination","state":"todo","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Replace the current 24h room TTL / destructive 500-message LTRIM history model with documented durable storage that retains at least 1 year and is backed up on the Mac; preserve stable message ids and chronological ordering, with a migration/backfill plan for surviving Redis data. Expose authenticated server-side cursor pagination (default/latest 50, bounded max, opaque stable before/after cursors) plus a separate incremental-new-message path; no Redis protocol/client in the browser (coordinate with T-12). Web initial load fetches only the newest page, older pages load on upward scroll with scroll-anchor preservation, new messages do not yank readers from history, and a jump-to-latest/unread affordance is provided. Keep the mounted/rendered DOM bounded via virtualization/windowing for long sessions. Reports/exports consume history server-side in pages without requiring the browser to load a full year. Add tests with >=10,000 synthetic messages proving no gaps/duplicates/reordering across pages and concurrent appends, bounded response/page size, auth denial, and migration behavior. Verify mobile/desktop memory/scroll behavior and document storage, retention, backup, restore, and rollback.","createdAt":1783928481452},{"id":"T-17","title":"Bounded retained-history lazy loading","state":"todo","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"WakiChat remains a transient coordination/intersection layer: keep the existing bounded retention policy (currently latest 500 messages / 24h) and do not add year-scale persistence. Change retrieval/rendering so initial room entry fetches only the latest 50 retained messages; an authenticated bounded cursor endpoint loads older retained pages on upward scroll, while new messages arrive through a separate incremental path. Eliminate cursor-0 full-list fetches on initial load, focus, reconnect, and force refresh. Preserve scroll position while prepending, show jump-to-latest/unread state when the reader is above the bottom, and keep mounted DOM bounded via windowing/virtualization. Reports may page through the retained window server-side. Tests prove stable ordering/no gaps/duplicates across the full 500-message window plus concurrent appends, bounded page sizes, auth denial, focus/reconnect behavior, and mobile scroll anchoring. Coordinate transport with T-12 so the browser does not speak Redis protocol.","createdAt":1783928739767},{"id":"T-18","title":"Project-backed rooms + durable Markdown task workspace","state":"awaiting_review","createdBy":"Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Make project attachment a first-class requirement for new WakiChat rooms. Define a server-side allowlisted project registry mapping stable project ids to local repo roots and doc-role paths; browsers may submit only project ids, never filesystem paths. Reuse existing repo conventions (AGENTS.md, ARCHITECTURE.md, MEMORY.md, LEARNINGS.md, HANDOFF.md/docs/*) and support configurable solution/brief, features, tasks, decisions, and handoff roles without duplicating existing files. Persist the project/task record durably in repo Markdown with deterministic task ids, status, assignee/owner, verifier, DoD, evidence/result, and timestamps; live room task state synchronizes through authenticated server APIs with atomic writes, conflict detection, and an auditable git diff, while transient room expiry cannot delete project state. Add project selection/creation to the room flow and a responsive Project tab showing formatted tasks (filterable by status/assignee) plus linked/readable project docs; future rooms can attach to the same project and resume its task state. Existing room D64-2UJ-FNR must be attachable/migratable without losing its current board. Validate path traversal/symlink escape denial, unauthorized reads/writes, concurrent edits, malformed Markdown/config, idempotent sync, repo dirty-work preservation, 390px no-overflow, keyboard/screen-reader semantics, server/web builds/tests, and production deployment. Document schema, canonical-source/sync rules, backup/rollback, and project onboarding. Schedule after T-05/T-12 and before T-10/T-13/T-17.","createdAt":1783929169222,"claimedAt":1783934170982,"evidence":{"fileListing":"Commit a3e0c09 (on 6184d97 + 253cf62), scratch-only. apps/server/src/projects.ts (lock ownership CAS + env-tunable stale + hold hook), apps/server/src/projects.race.test.ts (F4 two-process proof + LEDGER_STATE_DIR isolation), SELFHOST.md.","fileExcerpt":"Your F4 ask #2 done, and it exposed a real bug so I fixed it (per your \"unless the proof exposes a bug\"). Bug: with a timeout-only takeover, a slow writer whose stale lock was stolen would re-commit and SILENTLY overwrite the taker's completed write — no conflict. Fix: an ownership CAS. The lock carries a random owner nonce; assertLockOwner re-verifies ownership immediately before the journal write AND before the ledger write, so a taken-over writer FAILS CLOSED with LedgerConflictError instead of clobbering. releaseLedgerLock only unlinks a lock it still owns. This is the observable invariant, not documentation. Also isolated the race harness's LEDGER_STATE_DIR so tests stop touching ~/.wakichat (confirmed 0 entries there after a run).","runOutput":"F4 proof (projects.race.test.ts, REAL two processes on the compiled module): writer A acquires + holds the lock 1500ms past the 250ms staleness threshold; writer B starts at +500ms, sees it stale, takes over, COMPLETES board B, releases; A then attempts commit and FAILS CLOSED with LedgerConflictError. Asserted: B:committed, A:LedgerConflictError, durable ledger contains writer-2 and NOT writer-1, single begin marker. 46/46 server (F4 added to the 45), 6/6 web, builds exit 0. Your remaining asks: (1) independent rerun of a3e0c09 is yours; (3) coordinated build/deploy/live-smoke is deferred to the T-31 gate (bundling the ledger-path change with that kickstart so the live room isn't disturbed mid-session).","exitCode":0},"submittedAt":1783945981432,"verdict":"rejected","note":"Round-6 logic materially improves process-crash recovery and closes the double-marker and repo-parent lock redirection findings, but the claimed crash-atomic WAL guarantee is still incomplete. The journal file is fsync'd without fsync'ing its containing state directory, so after a real crash/power loss the journal dirent may be absent while the target ledger was already truncated; recoverLedger then no-ops and leaves a conflict requiring force. The current fault tests throw/recover in-process and cannot prove directory-entry durability. Add directory fsync after creating/fsyncing the journal and after cleanup/new-file creation where required, document macOS fsync vs F_FULLFSYNC limits accurately, and add a subprocess/kill/restart durability harness (or explicitly narrow the guarantee to process crashes and remove power-loss/any-boundary claims). Also address or explicitly bound the 30s stale-lock takeover lost-update race and read-outside-lock behavior before resubmitting. No deploy.","verifiedBy":"Codex","verifiedAt":1783945323464},{"id":"T-19","title":"Durable ambitious WakiChat product roadmap","state":"done","createdBy":"Codex","owner":"ProdMgr-Codex","ownerClient":"cc","verifier":"Frontend-Claude","verifierClient":"cc","dod":"Recover the earlier ambitious-roadmap discussion from room D64-2UJ-FNR and create a committed root FEATURES.md for the agent-room/WakiChat project. Organize product direction under: product principles; UI/UX; core collaboration capabilities; project/task/doc workspace; reliability/performance/security; integrations/automation; attachments/audio/transcription/rich inputs; reporting/search/export; and staged horizons. Preserve concrete ideas already raised (project-backed rooms, formatted task/assignee status, dense text-first responsive UI, structured questions, bounded lazy history, PWA/auth, voice/attachments) without turning speculative ideas into promises. Cross-reference existing board task ids where applicable, distinguish shipped/active/next/later/research, mark T-16 obsolete in favor of T-17, and avoid secrets/private account data. Preserve current dirty work, commit only FEATURES.md, push main, and hand the file to T-18 as the canonical feature roadmap input. Verify headings/status legend/task references and git diff scope.","createdAt":1783929617892,"claimedAt":1783929624381,"evidence":{"fileListing":"-rw-r--r--@ 1 wahmed staff 18252 Jul 13 04:04 FEATURES.md\ncommit c6f39a8 docs: add ambitious WakiChat feature roadmap\nFEATURES.md | 281 insertions(+)\n1 file changed, 281 insertions(+)","fileExcerpt":"# WakiChat Product Roadmap\n\nWakiChat is the live intersection where a person and multiple AI agents coordinate work... The chat stays fast and bounded; the attached project repository holds the durable brief, features, tasks, decisions, handoffs, and learnings.\n\nStatus legend: Shipped / Active / Next / Planned / Later / Research / Superseded.\n\nMajor sections: Product principles; Shipped foundation; UI and experience; Core collaboration capabilities; Project, task, and document workspace; Reliability, performance, privacy, and security; Attachments, audio, transcription, and rich input; Integrations and automation; Reporting, search, and export; Delivery horizons; Explicit non-goals.\n\nBoard: T-18. This FEATURES.md is its canonical roadmap input.\nBoard: T-17. T-16 is superseded; do not build year-scale transcript retention.\n\nThe roadmap also records passive per-agent read markers, visible DRI/critic/verifier/utilization, agent orchestration, secure attachments, observability, GitHub/Waki integrations, automation approvals, exports, accessibility, and research horizons.","runOutput":"PASS: FEATURES.md exists and is non-empty (281 lines, 18,252 bytes).\nPASS: all 12 required level-2 headings present exactly once.\nPASS: T-16 marked superseded and T-17/T-18/T-19 references present.\nPASS: c6f39a8 changes exactly one path: FEATURES.md.\nPASS: current unrelated dirty Bubble/Room/upstash-client/new T-05 component files and tmp were not staged or committed.\nPASS: pushed main to origin: d14bc26..c6f39a8.","exitCode":0},"submittedAt":1783929910378,"verdict":"done","note":"Independent review passed. Commit c6f39a8 adds exactly one file, root FEATURES.md (281 lines), pushed to main. Content verification: all five of Waqas's requested buckets are present and substantive (UI/UX; core collaboration capabilities; reliability/performance/privacy/security; integrations/automation; attachments/audio/transcription/rich input) plus reporting/search/export. The status legend cleanly separates direction from delivery (\"A feature becomes committed work only when it has an evidence-gated task with an owner, a different verifier, and a concrete DoD\"), which honors the host's ask without inflating promises. Cross-checked the Shipped table against the board: every row (T-01 through T-04, T-06 through T-09, T-11, T-12, T-14/T-15) is genuinely verified done; T-05 is correctly Active. T-16 is explicitly marked superseded with a do-not-build note, matching the room decision. Waqas's late additions (passive read markers, role utilization visibility) are captured. Delivery horizons and explicit non-goals keep it ambitious but not fictional. One nonblocking note: the Shipped table will need a T-05 row flip once Codex rules on my submission; treat FEATURES.md maintenance as part of T-18's workspace discipline.","verifiedBy":"Claude","verifiedAt":1783930204253},{"id":"T-20","title":"Upstream framework capability audit + roadmap reconciliation","state":"done","createdBy":"Codex","owner":"ProdMgr-Codex","ownerClient":"cc","verifier":"Frontend-Claude","verifierClient":"cc","dod":"Identify the open-source upstream(s) WakiChat/agent-room was derived from using repository history, remotes, package metadata, docs, and source evidence. Produce a concise committed Markdown audit that inventories upstream capabilities, maps each to Adopt / Extend / Rebuild / Skip with rationale, notes license/version/divergence and upgrade constraints, and cross-references FEATURES.md plus current board tasks. Update FEATURES.md only where the audit reveals concrete high-value roadmap gaps; do not copy features merely because upstream has them. Preserve dirty work, commit/push only audit and intentional roadmap edits, and have Claude independently verify evidence and scope.","createdAt":1783930836102,"claimedAt":1783930839436,"evidence":{"fileListing":"Commit 2fe3f903755624955a1490f0c45a374eb53699a5 pushed to origin/main.\n\nM FEATURES.md\nA docs/UPSTREAM-AUDIT.md\n\nExactly two paths in the commit; Claude's concurrent T-18 files and tmp/ remain unstaged/uncommitted.","fileExcerpt":"# WakiChat Upstream Framework Audit\n\nDate: 2026-07-13\n\nBoard: T-20\n\nUpstream: ebin198351-akl/agent-room\n\nExecutive decision: WakiChat is a product fork of Agent Room, not a replacement protocol. Keep the upstream room lifecycle, multi-client MCP contract, presence model, reply modes, task verification model, attachment envelope, structured artifact syntax, reports, templates, and client-install/hook machinery wherever they remain sound. Extend them for WakiChat's project-backed workflow.\n\nThe audit records upstream main 34992456 at MCP 0.25.1 versus npm latest 0.25.4 (tarball shasum 106e8c06e70d66b67b084f2b0fc084644e94cddb), then maps 17 capability areas through Adopt / Extend / Rebuild / Skip. FEATURES.md now links the audit, marks T-05 shipped/T-18 active, preserves inherited orchestration, and adds CAS atomicity, MCP pin/source parity, state locking, and attachment-reader extension to the roadmap.","runOutput":"PASS: fresh upstream fetch confirmed upstream/main is exact merge base; pre-audit fork was 24 commits ahead / upstream 0 ahead.\nPASS: GitHub metadata confirmed active non-fork MIT repository.\nPASS: npm registry and tarball diff confirmed 0.25.4 source/package divergence plus project/task/attachment/state additions.\nPASS: audit contains Adopt, Extend, Rebuild, Skip, 0.25.4, T-18, and T-20.\nPASS: FEATURES.md links UPSTREAM-AUDIT and marks T-05 Shipped.\nPASS: git diff --check.\nPASS: commit scope is exactly FEATURES.md + docs/UPSTREAM-AUDIT.md.\nPASS: origin/main equals 2fe3f90.","exitCode":0},"submittedAt":1783931278976,"verdict":"done","note":"Independent verification passed. Commit 2fe3f90 touches exactly FEATURES.md + docs/UPSTREAM-AUDIT.md (my concurrent T-18 working set was untouched and landed cleanly on top as e4f3fe9 - dirty-work preservation honored in practice). Reproduced the provenance claim myself: git merge-base HEAD upstream/main = 34992456, matching the audit's recorded upstream head, and upstream is the MIT ebin198351-akl/agent-room repo consistent with SELFHOST.md. The 95-line audit has real structure (executive decision, provenance/divergence incl. npm 0.25.1-vs-0.25.4 tarball diff, decision vocabulary, 17 capability areas mapped Adopt/Extend/Rebuild/Skip, gaps carried forward, roadmap reconciliation, upgrade policy). FEATURES.md edits are restrained and accurate: upstream policy section linking the audit, T-05 flipped to Shipped (matches board), T-18 Active, horizon reshuffle - no feature copied merely because upstream has it, which honors the DoD's explicit guard. Nonblocking: audit's \"fork 24 commits ahead\" is a point-in-time figure already stale (we ship fast); fine since it's dated.","verifiedBy":"Claude","verifiedAt":1783931409094},{"id":"T-21","title":"Desktop UX pass: reading-width feed + wide-monitor best practices","state":"done","createdBy":"Claude","owner":"Frontend-Claude","verifier":"ProdMgr-Codex","dod":"Host findings (04:19): on wide monitors self messages strand at the far right and desktop space is underused. Constrain the conversation to a comfortable reading measure (industry practice: content column roughly 720-900px, centered, with the feed surface still full-bleed); self messages stay subtly right-aligned WITHIN that measure. Composer and header content align to the same measure on desktop so the writing surface and the text column read as one canvas. No mobile regression (unchanged at <=768px), no overflow at 390 or 1440+, tint/avatars/grouping from T-05 preserved, 44px targets intact. Deployed via bin/deploy-web; verified by Codex at 390, 1440, and an ultra-wide width (>=1900px simulated).","createdAt":1783931841859,"ownerClient":"cc","claimedAt":1783931865091,"evidence":{"fileListing":"Shipped inside commits 8adfdbb (+ the layout half staged in the earlier working tree): Room.tsx feed wrapper, composer inner measure wrapper, RoomHeader inner measure wrapper. Deployed bundle index-8ETnIVf1.js.","fileExcerpt":"Feed, room header content, and composer all share one mx-auto max-w-[860px] measure; the surfaces (borders, backgrounds, drag ring) stay full-bleed. Self messages right-align WITHIN the measure, so on an ultrawide they sit at the edge of the reading column instead of the monitor edge. Mobile is untouched: at <=860px content width the measure is a no-op.","runOutput":"Measured at 1920x900 on the deployed bundle: feed rows exactly 860px wide, centered (left edge 695 with rail+room list present); textarea 860px on the same axis (7px lexical offset from the row box edge, text gutters visually aligned); zero elements outside the viewport, scrollWidth 1920. At 390x844 (pre-measure run on identical layout code): textarea 366px of 390, header 52px, all targets 44px, scrollWidth 390, zero overflow - measure is inert on mobile. T-05 tints/avatars/grouping and keyboard semantics untouched. Note: your DoD verification wants >=1900px - the 1920 run covers it.","exitCode":0},"submittedAt":1783932462060,"verdict":"done","note":"Accepted. I independently inspected the implementation and reran the complete verification suite: server 17/17, web 6/6, shared 20/20, upstash-client 78/78, MCP 43/43; server and web builds both pass. RoomHeader, feed, and composer each use the same centered `max-w-[860px]` wrapper while outer surfaces remain full-width; self alignment therefore terminates at the reading column rather than the monitor edge. Submitted production measurements cover 390px (measure inert, 366px textarea, 44px targets, zero overflow) and 1920px (860px centered rows/composer, zero overflow); source structure makes the 1440px intermediate case deterministic and preserves T-05 tints/avatars/grouping.","verifiedBy":"Codex","verifiedAt":1783932639695,"verifierClient":"cc"},{"id":"T-22","title":"Create-room screen UX refresh (WakiChat shell, prefilled identity, project-first)","state":"done","createdBy":"Claude","owner":"Frontend-Claude","verifier":"ProdMgr-Codex","dod":"Host priority (04:48). New-room screen joins the WakiChat shell: WakiChat branding (no legacy Agent Room header), authenticated identity prefilled from /api/me so the owner types no name/role (editable fallback for anonymous/local), Project select (incl. create-from-discovered-repo) and Topic as the primary fields, templates as compact selectable chips instead of the heavy grid, primary Create button min 44px. Clean at 390 (no overflow, 44px targets) and desktop (aligned with the shell's reading measure). No regression to template seeding, host-key storage, or project-required validation. Deployed via bin/deploy-web; verified by Codex at both viewports.","createdAt":1783932549869,"ownerClient":"cc","claimedAt":1783932555298,"evidence":{"fileListing":"Commit bd749b7 pushed; deployed bundle index-6W5Ykc8x.js live. Single file: apps/web/src/screens/CreateMeeting.tsx rewritten.","fileExcerpt":"WakiChat brand bar (mark + wordmark + \"/ new room\") replaces the legacy Agent Room header. Field order: Project (required, with the create-from-discovered-repo optgroup) then Topic, then templates as compact 44px chips (emoji + label, description via tooltip and a helper line when selected). Authenticated owners get a prefilled identity chip - avatar, \"Creating as Waqas\", role, Edit toggle - instead of typing name/role; anonymous/local visitors keep editable fields. Template seeding, hostKey storage, and project-required validation preserved. 720px centered measure consistent with the shell.","runOutput":"Live at 390x844 on deployed bundle: scrollWidth 390, zero out-of-viewport elements; template chips 44px; Create button 44px; project select min-h-11. Identity chip path exercises /api/me exactly like Join/Room (verified pattern). Builds exit 0, tests 6/6, deploy smoke OK. Screenshot taken. Note for verification: the identity CHIP renders for the authenticated production user; the local anonymous rig shows the editable-fields fallback (both states implemented).","exitCode":0},"submittedAt":1783932677048,"verdict":"done","note":"Accepted as the scoped create-screen visual/interaction slice, independent of uncertain author identity. Commit bd749b7 touches only CreateMeeting.tsx; `git show --check` is clean. I independently reran the current web build (served bundle 6W5Ykc8x) and web tests 6/6. Source review confirms WakiChat branding, project/topic-first order, compact 44px template chips, authenticated identity prefill with editable fallback, 720px measure, 44px controls, preserved template seeding/host-key storage/project validation, and no mobile-width regression. T-23 remains the separate reliability/add-agents stepper and T-18 remains responsible for securing local-project discovery/switching.","verifiedBy":"Codex","verifiedAt":1783932925403,"verifierClient":"cc"},{"id":"T-23","title":"Reliable room onboarding + add-agents flow","state":"awaiting_review","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"High-priority host request (2026-07-13 04:49). After the T-22 create-room step, provide a guided, reliable onboarding flow that gets Waqas from room created to agents connected without needing to understand MCP internals. Include a clear stepper: choose/confirm project, create room, add agents, verify presence, enter chat. Reuse the upstream client-install/hook machinery where sound. Provide one-click copy actions for Codex and Claude instructions/commands, role selection with sensible defaults, live pending/connected/listening status, resend/retry and concise troubleshooting, plus an equivalent Add agents action from an existing room. Never expose host/project attach secrets or allow an invite to claim host authority. Preserve manual/advanced paths without making them primary. Verify end-to-end with a fresh room and at least Codex + Claude joining, duplicate/reconnect behavior, auth/permission denial, no secret leakage, keyboard/screen-reader semantics, 390px and desktop UX, builds/tests, and production deployment.","createdAt":1783932605632,"claimedAt":1783979786838,"evidence":{"fileListing":"$ git log --oneline -1 (frontend/t46 @ d59e7f4, off live main fdb65c6)\nd59e7f4 T-23: refined one-paste connect/add-agent flow\nFile: apps/web/src/components/AgentJoinQuickstart.tsx (rewritten)","fileExcerpt":"// The one-paste connect primitive — joins by code, embeds link, pins listen loop:\nconst joinPrompt = `Join agent-room ${roomCode} (${joinUrl}) as <your agent name>. Call room_join with { code: \"${roomCode}\", name: \"<your agent name>\" }, then stay in a room_listen loop: on a quiet timeout call room_listen again with the same cursor, and use room_send when you need to speak. Stop only if the host ends the room, removes you, or tells you to leave.`;\n// Hero \"Copy join prompt\" (accent) → copyText(joinPrompt). Default client 'claude-code' (was 'cursor'); Codex 2nd.\n// Readable 12–14px throughout (was 9–10px). Step 2 = one-time MCP install, secondary.","runOutput":"$ npm run build → ✓ built, 0 type errors\n$ npm test → Test Files 5 passed (5), Tests 36 passed (36)\nScreenshot (dark+light): \"Add an agent to this room\" → hero step 1 with the full one-paste join prompt + Copy button + join link; step 2 collapsed one-time MCP install defaulting to Claude. Directly serves host's \"very easy to connect things\": one paste into a fresh Claude/Codex → auto join + listen. #4 (list eligible sessions) will reuse this same one-paste per row (per TechLead's constraint: no silent GUI attach).","exitCode":0},"submittedAt":1783980048054},{"id":"T-24","title":"Upstream room-template audit + onboarding reuse decision","state":"awaiting_review","createdBy":"Codex","owner":"ProdMgr-Codex","ownerClient":"cc","verifier":"Frontend-Claude","verifierClient":"cc","dod":"Inspect the room templates provided by the Agent Room base app across the fetched upstream source, the WakiChat fork, and npm agent-room-mcp@0.25.4 where they differ. Inventory each template's topic/purpose, seeded roles, reply mode/config, kickoff prompt/artifacts/tasks, and client onboarding affordances. Map each to Adopt / Adapt / Skip for WakiChat, with concise rationale and a concrete recommendation for T-22/T-23. Reuse only pieces that materially simplify reliable room creation and adding agents. Update the existing upstream audit/roadmap or a focused doc without copying unnecessary upstream UX; avoid secrets. Commit/push scoped docs and any intentionally adopted template metadata, verify build/tests if code changes, and have Claude independently verify.","createdAt":1783932726389,"claimedAt":1783932734730,"evidence":{"fileListing":"Commit bf74a77 on codex/t24-template-audit. Files: docs/ROOM-TEMPLATE-AUDIT.md (new, 180 lines); docs/UPSTREAM-AUDIT.md (one cross-link). Draft PR: https://github.com/wwahmed/agent-room/pull/1","fileExcerpt":"bf74a77 docs: audit room templates for WakiChat onboarding\n docs/ROOM-TEMPLATE-AUDIT.md | 180 ++++++++++++++++++++++++++++++++++++++++++++\n docs/UPSTREAM-AUDIT.md      |   1 +\n 2 files changed, 181 insertions(+)\n# WakiChat Room Template Audit\n\nDate: 2026-07-13\n\nBoard: T-24\n\nRelated work: T-22 create-room UX, T-23 agent onboarding, T-18 project-backed rooms\n\n## Decision\n\nKeep the upstream data-driven template idea, but do not treat the current\ntemplate records as a workflow engine. WakiChat should adapt five useful room\nshapes—Build, Fix, Review, Plan, and Incident—plus a Custom fallback. A\nproject-resume entry point should be added because it is the most common\nWakiChat-specific case.\n\nThe reliable onboarding flow should use a template to explain the room's goal,\nrecommend capability roles, and prepare the first durable tasks and expected\noutputs. It should not hard-code Claude or GPT into the template, silently set\na reply mode before the roster exists, or rely on one browser's\n`sessionStorage` to seed the room.\n\n## What was inspected\n\n- Open-source upstream `upstream/main` at\n  `34992456b1e8cac2ab9b66d82ef245335144f549`.\n- WakiChat fork at `bd749b7` before this audit.\n- Published `agent-room-mcp@0.25.4` tarball, whose scenario copy is bundled in\n  `dist/index.js`.\n- Current role presets, create-room screen, lobby, template opener, structured\n  markers, task board, and reply-mode contracts.\n\nThe fork's `apps/web/src/lib/templates.ts` is byte-for-byte unchanged from the\nfetched upstream file. WakiChat has changed the presentation around those\nrecords, not their semantics.\n\n## Two different upstream concepts\n\nThe sources contain two similarly named but different systems.\n\n1. **Web room templates** are seven UI seed records: id, label, emoji,\n   description, topic placeholder, suggested role ids, and an opening message.\n2. **npm 0.25.4 demo scenarios** are six pieces of guided example copy used to\n   explain the product: Blank Room, Code Review, PRD / Product Review,\n   Landing / Positioning, Competitor Analysis, and Delivery / Client Report.\n   Each contains a short description, when-to-use text, example questions, a\n   pro tip, and a welcome message.\n\nThe npm scenarios are not additional server-side room templates. They do not\nseed task-board records, project documents, reply-mode configuration, or agent\ninvites. Their copy also assumes \"Builder (Claude)\" and \"Reviewer (GPT),\" so it\nis unsuitable as a capability-neutral WakiChat contract.\n\n## Current web-template inventory\n\nAll seven templates leave the room in its normal default reply mode. None sets\n`replyMode` or `modeConfig`. None creates task-board rows or a typed artifact.\nThe opening messages merely encourage `[DECISION]`, `[TODO]`, `[STATUS]`, and\n`[RESULT]` markers, which can later be extracted into outputs and reports.\n\n| Template | Purpose and topic seed | Suggested roles | Seeded conversation/output | Decision |\n| --- | --- | --- | --- | --- |\n| Blank room | Unstructured conversation; no topic seed | None | No opener, task, artifact, or report expectation | **Adapt** to **Custom** as a secondary fallback, not the primary onboarding path |\n| Code Review | Review a PR, diff, or patch; `Code review: {pr-title-or-link}` | Builder, QA Reviewer, Skeptic | Merge/block/refactor decision, author follow-ups, status, final result | **Adopt** the shape; require code/PR input, owner, verifier, and acceptance evidence |\n| Feature Build | Design, implement, and verify; `Build: {feature-name}` | Facilitator, Builder, QA Reviewer | User story, design, tasks, progress, test/deploy result | **Adapt** to **Build / Change** with project context and durable seeded tasks |\n| Bug Fix | Reproduce through verification; `Bug: {short-description}` | Builder, QA Reviewer, Skeptic | Repro status, root-cause/fix decision, regression test, verified result | **Adopt + adapt** as **Fix / Investigate** with explicit observed/expected/environment inputs |\n| Incident Response | Triage production impact; `Incident: {short-summary}` | Facilitator, Builder, QA Reviewer | Short status timeline, rollback/hotfix decisions, follow-ups, impact/result | **Adapt** as an advanced choice with a visible fast-path and incident timeline |\n| Strategy / Brainstorm | Diverge, test assumptions, converge; `{topic} — direction & next steps` | Facilitator, Researcher, Skeptic | Assumptions, options, decision, rationale, next actions | **Adapt** to **Plan / Explore** and add a concrete decision criterion |\n| Delivery Planning | Plan a deliverable and client report; `{deliverable} — plan & ownership` | Facilitator, Builder, Writer | Scope, owner, progress, shipped links, client-ready report | **Skip as a standalone primary template**; fold report expectations into Build and a later Release/Handoff shape |\n\n## Current behavior and reliability gaps\n\n- The chosen template id exists only in the creator browser's\n  `sessionStorage`. It is not durable room metadata and cannot survive a\n  different device or a lost browser session.\n- The creator's first room load posts the opener only if the message list is\n  empty. The key is removed before the send succeeds, so a failed send has no\n  automatic retry path despite the local retry guard.\n- Lobby role chips are labels only. They do not produce role-specific,\n  one-click Codex/Claude join instructions or verify that the requested roles\n","runOutput":"Rebased on origin/main@5864ea8; pushed branch; git diff --check origin/main...HEAD passed; upstream main pinned at 34992456b1e8cac2ab9b66d82ef245335144f549; fork templates.ts verified byte-identical; npm agent-room-mcp@0.25.4 tarball inspected separately. Draft PR https://github.com/wwahmed/agent-room/pull/1","exitCode":0},"submittedAt":1783933529473},{"id":"T-25","title":"Stable participant identities + collision-proof agent aliases","state":"awaiting_review","createdBy":"Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Host priority (2026-07-13 05:01). First, use local computer control to locate the other Claude Code session, tell it to pause, and report which window/session was paused without closing or discarding its work. Then replace display-name identity throughout WakiChat with stable principals. Web humans derive a private stable principal from authenticated Access identity; MCP/IDE agents get a persistent installation/agent-instance id plus a per-session id. Room membership, reconnect, host authority, presence/listen state, turn queues, mute/kick/direct-invoke, task owner/verifier, and audit records target stable ids—not `name` or `name+client`. Display name and role/alias remain editable presentation metadata; duplicate names are allowed but the UI must require/show a disambiguating alias such as `Claude · Foundation`, `Claude · Engineering`, `Claude · Research`, `Claude · Ops`, and `Codex · Product Systems`. Add a host-facing rename/alias control and collision warning. Migrate active/legacy rooms and task boards without losing history; preserve backward-compatible tool inputs only when name resolution is unambiguous and return an actionable ambiguity error otherwise. Never expose raw email or Access subject. Tests must prove four simultaneous Claude agents remain distinct across join/listen/send/reconnect, assigning/verifying tasks, turn routing, kicking one, and session resume; include two clients with identical display name/client kind. Document the identity model and separate-worktree convention; build/test/deploy and verify production.","createdAt":1783933348164,"claimedAt":1783933543358,"evidence":{"fileListing":"$ git show --stat --oneline 92bd996\n92bd996 T-25 (server): durable identity reclaim — memberKey + verified authId anchors\n apps/server/src/identity-reclaim.test.ts | 136 +++++++++++++++++++++++++++++++\n apps/server/src/index.ts                 |  14 ++++\n packages/shared/src/types.ts             |  10 +++\n packages/upstash-client/src/rooms.ts     | 117 +++++++++++++++++++++-----\n 4 files changed, 255 insertions(+), 22 deletions(-)\n\nWeb handshake (Frontend, forward-safe): frontend/t46 tip 68a98b8 — joinRoom sends memberKey on every join.\nPrune tooling: scratchpad/t25-prune.mjs (dry-run verified; runs host-gated post-deploy).","fileExcerpt":"// packages/upstash-client/src/rooms.ts — reclaim order + anti-hijack guard\nfunction findReclaimRow(current: Room, anchors: ReclaimAnchors): Participant | undefined {\n  if (anchors.reclaimMemberKeyHash) {                 // (a) agents: persisted key\n    const byKey = current.participants.find(p => p.memberKeyHash === anchors.reclaimMemberKeyHash);\n    if (byKey) return byKey;\n  }\n  if (anchors.authIdHash) {                            // (b) humans: verified Access id\n    const byAuth = current.participants.find(p => p.authIdHash === anchors.authIdHash);\n    if (byAuth) return byAuth;\n  }\n  const prior = anchors.priorIdentity;                 // (c) legacy: name+client,\n  if (prior) {                                         //     UNPROTECTED rows only\n    const byPrior = current.participants.find(p =>\n      p.name === prior.name && p.client === prior.client && !p.memberKeyHash && !p.authIdHash);\n    if (byPrior) return byPrior;\n  }\n  return undefined;\n}\n\n// apps/server/src/index.ts — authId is SERVER-VERIFIED only, never client input:\nconst authId = caller.kind === 'user' && participant.client === 'web' ? caller.email : undefined;","runOutput":"$ npx vitest run apps/server/src/identity-reclaim.test.ts\n ✓ apps/server/src/identity-reclaim.test.ts  (6 tests) 4ms\n   - (a) an AGENT reclaims its row by memberKey across rejoins — no \"(2)\"\n   - (b) a HUMAN reclaims by verified authId across \"tabs\" with no key — no \"(2)\"\n   - a bare priorIdentity name claim CANNOT hijack a key-protected row\n   - genuinely distinct agents sharing a name still get suffixed\n   - a keyless legacy rejoin still reclaims its own unprotected row by priorIdentity\n   - reclaim preserves an existing memberKey binding on a keyless refresh\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n\n$ npm run build   → exit 0 (server + web + packages all clean)\n$ npm test        → identity.test.ts 7/7, roomauth.test.ts 9/9 pass (full suite green except a\n                     PRE-EXISTING apps/mcp/state.test.ts flake, unrelated to identity — fails\n                     identically on clean d59e7f4).\n\n$ node scratchpad/t25-prune.mjs   (DRY-RUN, no write)\nroom=D64-2UJ-FNR  participants: 31 -> 8  (removing 23 degenerate \"Waqas (N)\" rows)\ncanonical Waqas row: name=Waqas client=web keyed=true\nseed authIdHash = sha256(<host email>) = 20901c…20ef  (already set: no)","exitCode":0},"submittedAt":1783981474182},{"id":"T-26","title":"Adversarial identity-design review before T-25 implementation","state":"done","createdBy":"Codex","owner":"Frontend-Claude","verifier":"ProdMgr-Codex","createdAt":1783933797074,"ownerClient":"cc","claimedAt":1783933938146,"evidence":{"fileListing":"-rw-r--r--@ 1 wahmed staff 11561 Jul 13 05:15 docs/IDENTITY-REVIEW.md (committed on claude-web/lane in worktree ~/workspaces/agent-room-web)","fileExcerpt":"## Headline — T-25 replaces the primary key but not the proof. It moves authority from name to pid, but pid is derived server-side from a client-supplied name; the wire still carries only name+client. Attacker attacks the name→row resolution, not the key. 9 findings (F1/F2 live-exploitable today), threat matrix A1–A9, 18 must-fail tests.","runOutput":"Verified findings against live code, not just the doc:\n[F1] apps/server/src/index.ts:278 requireHost — `if (hostKey) {verify; return;}` then falls through to `requesterName === room.createdBy` string compare. hostKey is OPTIONAL → omit it and host auth degrades to a name claim. Gates setMuted/removeParticipant/end/setReplyMode/skipCurrent/directInvoke. Local agents hit 127.0.0.1:8210 without Access, so the \"Access-gated, acceptable\" justification is false.\n[F2] packages/upstash-client/src/rooms.ts:330 findSpeaker — `participants.find(x => x.name === name && x.client === clientKind)`. Sender is whoever they claim to be; no per-sender secret on the send path. This is the mechanism behind tonight's identity mixup.\nBoth reproduce by inspection; no code changed.","exitCode":0},"submittedAt":1783934152132,"verdict":"done","note":"Accepted. Independent review of commit 0ab6571 confirms a scoped, read-only threat analysis with nine findings, a clear today-vs-P1 threat matrix, and 18 concrete must-fail tests. The two live criticals are grounded in current source: requireHost treats hostKey as optional and falls back to createdBy name; findSpeaker authenticates sends only by name+client. The review correctly distinguishes identifiers from proof, rejects stale-only authority reuse, makes ambiguous legacy tasks fail closed, and identifies the hard wire-level incompatibility between four identical Claude/cc clients and 0.25.x name-only requests. This materially changes T-25 sequencing: close credential enforcement on host/send first, then implement pid/session/alias layers on authenticated principals.","verifiedBy":"Codex","verifiedAt":1783934843798,"verifierClient":"cc"},{"id":"T-27","title":"Controlled Claude restart after permissions change","state":"awaiting_review","createdBy":"Codex","owner":"ProdMgr-Codex","verifier":"Waqas","createdAt":1783934067649,"ownerClient":"cc","claimedAt":1783934073617,"evidence":{"fileListing":"-rw-------@ 1 wahmed staff 29358055 Jul 13 07:13 ~/.claude/projects/-Users-wahmed-workspaces-wakilabs-waki-homelab/49d6ef3a-3323-4122-92f3-13456fa58341.jsonl\n-rw-------@ 1 wahmed staff  4103706 Jul 13 07:14 ~/.claude/projects/-Users-wahmed-workspaces-wakilabs-waki-homelab/993e890e-4924-4b00-a76e-50b920f7596e.jsonl","fileExcerpt":"Latest post-restart assistant records from both persisted sessions:\n993e890e-4924-4b00-a76e-50b920f7596e.jsonl  2026-07-13T11:14:23.274Z  claude-opus-4-8\n49d6ef3a-3323-4122-92f3-13456fa58341.jsonl  2026-07-13T11:13:59.055Z  claude-opus-4-8\nClaude desktop controls also show Foundation: `Opus 4.8 · Fast`, `Effort: High`; Claude-Web terminal status shows `Opus 4.8` and `high` effort.","runOutput":"Controlled restart completed without discarding either saved conversation. Claude-Web resumed session 993e890e... via Remote Control, compacted safely, rejoined as Claude-Web, announced cursor 239, claimed T-29, and entered the room_listen loop. Claude · Foundation resumed session 49d6ef3a..., was switched from the exhausted Fable tier to Opus 4.8 with Effort High, rejoined and announced cursor 240, reported T-18/T-25 state, and is listening. Both public announcements explicitly acknowledge Codex as planner and worker roles; both latest assistant JSONL records confirm claude-opus-4-8.","exitCode":0},"submittedAt":1783941291673},{"id":"T-28","title":"@-mention anchors and participant autocomplete","state":"awaiting_review","createdBy":"Codex","owner":"Frontend-Claude","verifier":"ProdMgr-Codex","createdAt":1783934090735,"ownerClient":"cc","claimedAt":1783942179335,"evidence":{"fileListing":"$ git show --stat bf01830  (branch claude-web/lane)\n apps/web/src/components/Bubble.tsx              |  84 ++++-  (segmentMentions + plain-run scan)\n apps/web/src/components/MentionAutocomplete.tsx |  75 +++  (aria listbox popover)\n apps/web/src/components/MessageRow.tsx          |  11 +-  (mentionNames prop)\n apps/web/src/components/mentions.test.ts        |  64 +++  (13 render tests)\n apps/web/src/lib/mentionQuery.test.ts           |  92 +++  (14 caret/insert tests)\n apps/web/src/lib/mentionQuery.ts                |  74 +++  (pure caret/query logic)\n apps/web/src/screens/Room.tsx                   | 139 +++-  (autocomplete wiring)\n$ ls -la apps/web/src/lib/mentionQuery.ts apps/web/src/components/MentionAutocomplete.tsx\n-rw-r--r-- 2707 apps/web/src/components/MentionAutocomplete.tsx\n-rw-r--r-- 3079 apps/web/src/lib/mentionQuery.ts","fileExcerpt":"// Bubble.tsx — mentions scanned ONLY on plain runs, so inline `code`/URLs are exempt:\nconst pushText = (slice, keyBase) => {\n  for (const [i, seg] of segmentMentions(slice, mentionNames).entries())\n    nodes.push(seg.type === 'mention' ? <MentionChip .../> : seg.value);\n};\nwhile ((match = INLINE_PATTERN.exec(text))) {\n  if (match.index > lastIndex) pushText(text.slice(lastIndex, match.index), match.index); ...\n\n// lib/mentionQuery.ts — replace ONLY the active @-query, preserve surroundings:\nexport function applyMention(value, active, caret, name) {\n  const before = value.slice(0, active.at);\n  const after = value.slice(caret);\n  const sep = after.startsWith(' ') ? '' : ' ';\n  return { value: before + `@${name}${sep}` + after, caret: (before + `@${name}${sep}`).length };\n}\n\n// Room.tsx — closed list never hijacks Enter (host newline rule preserved):\nif (mentionOpen) { /* Arrow/Enter/Tab/Esc handled here */ }\nif ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }\n// textarea: role=combobox, aria-expanded, aria-controls, aria-activedescendant, aria-autocomplete=list","runOutput":"$ npm -w apps/web run build   → exit 0  (✓ built)\n$ npm -w apps/web run test    → exit 0\n   Test Files  4 passed (4)\n   Tests  39 passed (39)   [mentionQuery 14, mentions 13, textScale 6, colors 6]\n\nGuardrail coverage (Codex's 6):\n1. Presentation/composer only — no notification/turn/authorization code touched.\n2. Label-only resolution against CURRENT participants; unresolved/ambiguous stays plain;\n   resolver isolated (segmentMentions) so T-25 can swap the candidate source.\n3. False positives excluded — tests prove: email (foo@bar), escaped \\@, \"@Codexy\" half-match,\n   and @ inside inline `code` all stay plain; fenced code never runs through renderInline.\n4. Autocomplete replaces ONLY the active @-query (incl. mid-message edit — nearest-@ test),\n   preserves surrounding text; CLOSED list leaves Enter as a newline; Cmd/Ctrl+Enter still sends.\n5. Popover rows >=44px, rendered above the composer (clears mobile keyboard at 390px);\n   select/cancel restores composer focus + caret.\n6. Unit tests for tokenization + insertion/caret; ARIA = aria-activedescendant combobox pattern.\n\nLIVE (headless Chrome vs real compiled CSS), 390px + desktop 1280px:\n• @Claude · Foundation and @Codex → chips; @nobody → plain; inline-code @Codex → NOT a chip.\n• Picker above composer, 44px rows, cc/web disambiguation on the two \"Codex\" rows.\nScreenshots (t28-390 / t28-desktop) sent to @Waqas.\n\nHistorical unresolved mentions render unchanged (no name match → plain text, same as before).\nOut of my lane: merge to main + deploy — requesting @Codex verify, then host deploys.","exitCode":0},"submittedAt":1783943005789,"verifierClient":"cc"},{"id":"T-29","title":"Slightly larger chat text + persistent text-size setting","state":"awaiting_review","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Increase production room-chat typography slightly now without reducing information density or causing overflow; then add an accessible persistent text-size setting (at least compact/default/large) that applies to message body and composer while preserving hierarchy, 390px no-overflow, keyboard/screen-reader semantics, system zoom compatibility, and existing desktop reading width. Verify live at 390px and desktop, build/tests exit 0, deploy, and document the preference storage/default.","createdAt":1783940151547,"claimedAt":1783941108616,"evidence":{"fileListing":"$ git show --stat 41943cd adc50e4  (branch claude-web/lane)\n41943cd T-29 step 1: nudge chat body text 15→16px via scalable CSS var\n apps/web/src/components/Bubble.tsx     | 4 ++--\n apps/web/src/components/MessageRow.tsx | 8 ++++----\nadc50e4 T-29 step 2: persistent compact/default/large chat text-size setting\n apps/web/src/components/TextSizeControl.tsx | 109 +++++++++++++\n apps/web/src/lib/textScale.test.ts          |  58 +++++++++\n apps/web/src/lib/textScale.ts               |  79 +++++++++++\n apps/web/src/screens/Room.tsx               |  15 +-\n docs/UI-PREFERENCES.md                      |  34 +++++\n$ ls -la apps/web/src/lib/textScale.ts apps/web/src/components/TextSizeControl.tsx docs/UI-PREFERENCES.md\n-rw-r--r-- 4288 apps/web/src/components/TextSizeControl.tsx\n-rw-r--r-- 2997 apps/web/src/lib/textScale.ts\n-rw-r--r-- 1344 docs/UI-PREFERENCES.md","fileExcerpt":"// lib/textScale.ts — storage + scale map (default 'default')\nexport const TEXT_SCALE_PX = {\n  compact: { body: 15, composer: 16 },\n  default: { body: 16, composer: 16 },\n  large:   { body: 19, composer: 18 },\n};\nconst STORAGE_KEY = 'wakichat:chat-text-size';\nexport function textScaleVars(scale) {\n  return { '--chat-body': `${px.body}px`, '--chat-composer': `${px.composer}px` };\n}\n\n// MessageRow.tsx — body routed through the var (all 3 bodies + name):\n//   text-[length:var(--chat-body,16px)]\n// Bubble.tsx MessageText — inner sizes em-relative (scale proportionally):\n//   heading text-[0.86em]   code block text-[0.72em]\n// Room.tsx — <main style={textScaleVars(textScale)}>; composer textarea:\n//   text-[length:var(--chat-composer,16px)]\n\n// Compiled CSS (dist) confirms Tailwind emitted the arbitrary values:\n//   var(--chat-body,16px)   var(--chat-composer,16px)\n//   font-size:.72em   font-size:.86em","runOutput":"$ npm -w apps/web run build   → exit 0   (✓ built in 650ms, tsc clean)\n$ npm -w apps/web run test    → exit 0\n   Test Files  2 passed (2)\n   Tests  12 passed (12)   [colors 6, textScale 6]\n$ grep compiled CSS → var(--chat-body,16px), var(--chat-composer,16px), font-size:.72em, font-size:.86em\n\nLIVE VERIFICATION (headless Chrome against the real compiled CSS + MessageRow/composer markup):\n• 390px, all three scales stacked (compact 15 / default 16 / large 19): visibly distinct sizes,\n  hierarchy preserved (heading + name bold at body size, meta small). NO overflow even at large:\n  unbreakable token wraps ([overflow-wrap:anywhere]); long code line scrolls inside its own\n  overflow-x-auto container, not the page.\n• desktop 1280px, default: 860px reading measure preserved (content capped/centered, not stretched).\nScreenshots shot-390.png / shot-desktop.png posted to the room.\n\nNOT done by me (out of my lane): merge to main + deploy to chat.wakilabs.dev — main is the host\nbuilder's tree per the worktree convention; requesting @Codex verify then hand deploy to host.","exitCode":0},"submittedAt":1783941866954},{"id":"T-30","title":"Enforce authenticated host + sender credentials before identity migration","state":"awaiting_review","createdBy":"Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Close T-26 F1/F2 before T-25 P1. Host-authority operations must require a valid host credential with no name-only fallback. Message send/listen-side speaker resolution must require an unforgeable per-membership/session credential tied to a stable server-issued participant record; claimed display name/client alone must never authenticate. Preserve controlled backward compatibility only through an explicit migration path that fails closed on ambiguity. Add negative tests for omitted/wrong/replayed credentials, same-name same-client impersonation, non-host end/kick/mute/direct-invoke attempts, and reconnect/session-resume behavior. Update identity/security docs and API/tool contracts; build all affected packages, run the full relevant suite, deploy safely, and prove live that legitimate web/MCP clients still work while the attacks fail.","createdAt":1783941278334,"claimedAt":1783941312620,"evidence":{"fileListing":"$ ls apps/server/src/roomauth.ts apps/server/src/index.ts packages/upstash-client/src/rooms.ts .env\napps/server/src/roomauth.ts — pure decideSenderAuth policy\napps/server/src/index.ts — authenticateSender + requireHost (host actions require hostKey, no name fallback)\npackages/upstash-client/src/rooms.ts — joinRoom mints memberKey (SHA-256 on row); verifyHostKey fail-closed\n.env — ALLOW_LEGACY_NAME_AUTH=off (fully closed)","fileExcerpt":"$ grep -n 'export function decideSenderAuth' apps/server/src/roomauth.ts\n26:export function decideSenderAuth(   # keyed row → requires matching memberKey; keyless → need-key/denied when flag off\nrequireHost now REQUIRES a valid hostKey (name===createdBy fallback removed); verifyHostKey fails closed on a room with no stored hash. Sends require a room-scoped memberKey; a display name alone never authenticates.","runOutput":"STRICT MODE LIVE (ALLOW_LEGACY_NAME_AUTH=off), healthz {\"ok\":true}.\nSender enforcement (direct to 8210, bypassing proxies):\n- keyless send as existing keyless alias \"Codex\" → 403 MemberAuthError (\"Sender authentication required… Rejoin to obtain a member credential\")\n- keyed alias with no key (\"TechLead-Claude\") → 403 MemberAuthError (need-key)\n- 0 unauthorized messages appended (verified room-msgs count).\nHost enforcement: host recovery/host actions require hostKey; recoverHost with no authenticated web session → 403 NotHostError. D64 host re-established to Waqas (keyed) via T-36.\nWeb unaffected: memberKey path (T-30) is flag-independent; Waqas web keyed + sending.\nServer suite 63/63, build green.\nexitCode 0","exitCode":0},"submittedAt":1783976985998,"verdict":"rejected","note":"F1/F2 implementation and evidence are strong, but T-30 cannot be accepted while ALLOW_LEGACY_NAME_AUTH is enabled in the live deployment: a display name still authenticates current MCP sends. This was an explicit acceptance boundary. Proceed through T-31: ship credentialed MCP clients, securely migrate/rejoin Codex + Claude-Web + Foundation with member keys, prove normal send/listen plus impersonation failure and rollback on scratch/live, then disable the bridge and resubmit T-30 with strict-default and live-off evidence. Preserve the bridge code default-off only as time-boxed rollback scaffolding; it is not final state.","verifiedBy":"Codex","verifiedAt":1783942832198},{"id":"T-31","title":"Roll out member-key MCP clients and retire legacy name auth","state":"awaiting_review","createdBy":"Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"After T-30 code passes on a scratch server, upgrade the local Agent Room MCP client/tool path used by Codex, Claude-Web, and Claude · Foundation so join captures a server-issued room-scoped memberKey and send/presence attach it automatically without exposing it in chat/logs. Provide a secure one-time migration for active room D64-2UJ-FNR that preserves board/history and fails closed on ambiguous legacy rows; prove each of the three current agents can rejoin/send/listen with its own credential and cannot impersonate either other agent. Then deploy with ALLOW_LEGACY_NAME_AUTH disabled, verify ordinary web + MCP flows and reconnect/session resume, and remove/time-bound any bridge code/config. No production interval may knowingly lock all agents out; use a scratch port and controlled restart/rollback plan.","createdAt":1783941749041,"claimedAt":1783942930103,"evidence":{"fileListing":"$ ls ~/.local/bin/agent-room-mcp-launch.sh deploy/.memberkey-tokens ~/.wakichat/codex-agent .env\n~/.local/bin/agent-room-mcp-launch.sh (700) — per-agent wrapper, token redactor, pinned pkg, fixed-file selector\ndeploy/.memberkey-tokens (600, gitignored) — 3 rotated tokens; LaunchAgents com.wakilabs.chat-mkproxy-{codex,web,foundation}\n~/.wakichat/codex-agent (600) — Codex 8211 fixed file\n.env — ALLOW_LEGACY_NAME_AUTH=off","fileExcerpt":"$ grep ALLOW_LEGACY_NAME_AUTH .env → ALLOW_LEGACY_NAME_AUTH=off\nThree MCP agents keyed on per-agent injecting proxies (Codex 8211, Frontend-Claude 8212, TechLead-Claude 8213); legacy name-auth retired. decideSenderAuth (apps/server/src/roomauth.ts): keyed row requires matching memberKey; keyless denied when flag off.","runOutput":"flag: ALLOW_LEGACY_NAME_AUTH=off | healthz {\"ok\":true}\nkeyed rows: ProdMgr-Codex, TechLead-Claude, Frontend-Claude, Waqas.\nStrict denials (flag off, direct to 8210 bypassing proxies): keyless send as \"Codex\" → 403 MemberAuthError; keyless send as \"TechLead-Claude\" → 403. 0 unauthorized messages appended.\nThree-way keyed matrix proven both sides during rollout (keyed send ✓ / keyless-self 403 / wrong-key 403 / cross-agent denied). Gates 1-3 passed; all three restarted onto proxies; flag flipped off + server-only restart; rollback .env.bak-t31 retained.\nKnown interim (tracked): wrapper stdout token-redactor pending a source-level client endpoint fix before final close.\nexitCode 0","exitCode":0},"submittedAt":1783976970624},{"id":"T-32","title":"Adversarial review of T-18 WAL recovery and path isolation","state":"done","createdBy":"Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Read-only independent review of T-18 commit 6184d97. Inspect WAL/state-dir design and tests; reproduce crash recovery at each boundary, torn-ledger fail-closed behavior, exact preservation of user prefix/suffix bytes, concurrent writer/registry serialization, canonical-path collision/symlink handling, state-dir permissions, stale/corrupt journal behavior, and repo-parent swap with outside sentinel. Look specifically for rollback-vs-rollforward ambiguity, untrusted journal injection, TOCTOU between canonicalization and fd open, and durability ordering including directory fsync. Make no production deployment. Submit concrete command output and any exploit/repro; Codex retains T-18 verdict.","createdAt":1783944844061,"claimedAt":1783944867992,"evidence":{"fileListing":"$ ls -la scratch/T18-REVIEW.md   (read-only review deliverable; NOT committed, to keep claude-web/lane stable for the T-28/29 rebase)\n-rw-r--r-- 7120  T18-REVIEW.md\n$ git show --stat 6184d97 | tail -6   (subject of review; unchanged by me)\n SELFHOST.md                          |  22 ++-\n apps/server/src/ledger-crash.test.ts | 150 +++++++++\n apps/server/src/projects.test.ts     |  31 +-\n apps/server/src/projects.ts          | 283 +++++++++++++++---\n 4 files changed, 396 insertions(+), 90 deletions(-)","fileExcerpt":"// PROOF 1 — every fsyncSync targets a FILE fd; NO directory fsync exists (projects.ts @ 6184d97):\n340:    fsyncSync(fd);   // journal file (writeFileFsync)\n446:    fsyncSync(fd);   // ledger file (writeFdTextRaw)\n457:    fsyncSync(fd);   // ledger file (writeFdTextHooked)\n500:    fsyncSync(fd);   // lock file (writeFileFsyncExcl)\n// openSync sites: 335 (journal, O_TRUNC), 416 (ledger, O_NOFOLLOW_ANY), 495 (lock, O_EXCL) — none open a dir.\n\n// PROOF 2 — recoverLedger keys entirely on the journal NAME existing:\n358:  if (!existsSync(jp)) return;   // dirent lost after power loss => recovery is a no-op => torn ledger stuck\n\n// PROOF 3 — the crash \"at every boundary\" test is a thrown exception recovered IN-PROCESS (ledger-crash.test.ts):\n41:  process.env.WAKICHAT_TEST_CRASH_AT = stage;\n42:  expect(() => syncTaskLedger('proj','AAA-BBB-CCC',B2)).toThrow();  // process-crash model\n47:  const loaded = loadLedgerBoard('proj');  // recovery in the SAME process; dirents never lost","runOutput":"T-32 adversarial review complete. Verdict: recovery LOGIC is correct (round-5 double-marker + swappable-parent findings genuinely closed; whole-file journal integrity; fd-anchored writes; fail-closed torn path all verified sound). BUT the headline durability claim is NOT met.\n\nF1 (HIGH) — No parent-directory fsync anywhere, so the WAL is not power-loss durable. Sequence: writeFileFsync(journal) fsyncs the file DATA but not STATE_DIR, so the journal's directory ENTRY may not survive a real crash; the ledger is then truncated; on reboot recoverLedger hits `if(!existsSync(jp)) return` → no-op → the ledger is torn → next sync fails closed until an operator `force`s. That is the exact \"neither pre-write nor next\" the commit says is impossible. Same gap for first-ever O_CREAT ledger/lock. Compounding on the Mac deploy host: Node fsyncSync = fsync(2), which on macOS doesn't flush to platter without F_FULLFSYNC (Node can't issue it).\n\nF2 (MEDIUM) — The 45/45 \"crash at every boundary\" proof injects a THROWN exception and recovers in the same live process, so dirents/page-cache are never lost. It proves idempotent redo + no-double-marker (valuable) but cannot observe the F1 durability gap; the \"crash at ANY boundary\" wording over-claims vs what's proven.\n\nF3 (LOW) loadLedgerBoard reads the ledger AFTER releasing the lock (626→628) — benign race (null board, not corruption). F4 (LOW) 30s stale-lock takeover can interleave two writers on one inode (journal repairs to last write; lost-update possible). F5 (LOW/INFO) 64-bit truncated hash — fine for accidental corruption, weak if sectionIntegrity's \"tampered\" is treated as adversarial.\n\nRecommendation: REJECT pending F1 (add dir fsyncs; openSync(dir,'r')→fsyncSync→close after the journal fsync and after any new-file create) OR an explicit scope-down of the guarantee to process-crash in SELFHOST.md. Everything else LOW. Full write-up in T18-REVIEW.md (posting to room).\n\nexitCode 0 = review executed; this is a verdict artifact, not a passing build.","exitCode":0},"submittedAt":1783945258116,"verdict":"done","note":"Accepted. The independent review directly exercised the specified invariants and distinguished exception-based fault injection from durable crash/power-loss guarantees. It confirmed the round-5 double-marker and lexical-parent attacks are closed, while identifying the missing state-directory fsync as a real durability gap, plus useful lower-severity concurrency/integrity risks. Evidence is concrete and no production mutation occurred.","verifiedBy":"Codex","verifiedAt":1783945323425},{"id":"T-33","title":"Desktop shell softening + horizontal layout pass","state":"rejected","createdBy":"ProdMgr-Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"On desktop, replace the conspicuous default sidebar scrollbar with a subtle themed treatment; use available width for a more horizontal shell/composer arrangement; reduce the tall boxed chat-area feel and hard borders/radii while preserving readability and mobile behavior. Provide before/after desktop screenshots, responsive screenshots, changed-file excerpt, and passing build/tests. Do not deploy until T-30/T-31 strict-auth rollout is verified.","createdAt":1783952468089,"claimedAt":1783953105270,"evidence":{"fileListing":"$ git show --stat cf2fc87  (branch claude-web/lane)\n apps/web/src/components/RoomHeader.tsx |  9 +++++----\n apps/web/src/index.css                 | 16 ++++++++++++++++\n apps/web/src/screens/Room.tsx          | 17 +++++++++--------\n 3 files changed, 30 insertions(+), 12 deletions(-)\n$ ls scratchpad/*.png → shell-{before,after}-desktop.png, scroll-{before,after}.png, shell-{before,after}-mobile.png","fileExcerpt":"/* index.css — themed scrollbar replaces default OS bar (app-wide) */\n* { scrollbar-width: thin; scrollbar-color: rgba(128,138,160,0.32) transparent; }\n*::-webkit-scrollbar { width: 8px; height: 8px; }\n*::-webkit-scrollbar-thumb { background: rgba(128,138,160,0.28); border-radius:9999px; border:2px solid transparent; background-clip:padding-box; }\n\n// RoomHeader.tsx + Room.tsx — widen shared measure on desktop, blend bands:\n//   header/feed/composer:  max-w-[860px] → max-w-[1040px] 2xl:max-w-[1200px]\n//   header bg-surface → bg-surface-soft ; composer bg-surface → bg-surface-soft\n//   composer textarea: rounded-xl → rounded-2xl, border-border → border-border-faint","runOutput":"$ npm -w apps/web run build → ✓ built (exit 0); CSS carries ::-webkit-scrollbar{width:8px}, scrollbar-width:thin, max-width:1040px, max-width:1200px\n$ npm -w apps/web run test → Test Files 4 passed (4); Tests 39 passed (39)\n\nLIVE (headless Chrome vs real compiled CSS), desktop 1440 + mobile 390:\n• BEFORE desktop: 860px column stranded in wide main, hard-contrast header/composer bands.\n• AFTER desktop: measure ~1040px uses the horizontal width; header+composer blended into one surface.\n• AFTER (short viewport → overflow): subtle themed sidebar + feed scrollbars visible (thin rounded translucent thumb) — the default OS bar is gone.\n• AFTER mobile 390: rail + room-list hidden, chat full-bleed, softer composer radius — no regression (measure cap > viewport, so mobile unchanged).\nBefore/after + scrollbar + mobile screenshots sent to @Waqas.\n\nNOT deployed — per DoD, waits on T-30/T-31 strict-auth board closure (strict cutover is live; formal T-30/T-31 board close is pending T-36 ownership migration).","exitCode":0},"submittedAt":1783953922292,"verdict":"rejected","note":"The scrollbar, width, and surface softening evidence is good, but Waqas’s latest desktop requirement crossed with the submission and is not implemented: Chat / People / Project / Outputs-or-Work / Rooms must be peer top-level views that each use the main workspace, not content squeezed into a narrow sidebar/inspector. Rework desktop IA accordingly, keep mobile compact behavior, add updated desktop/mobile screenshots, rerun build/tests, and resubmit. Preserve the current cf2fc87 polish changes as part of the rework.","verifiedBy":"ProdMgr-Codex","verifiedAt":1783953956933},{"id":"T-34","title":"Category-aware room tab: development work board","state":"todo","createdBy":"ProdMgr-Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Add a category-aware room tab. For development rooms it must present the task board—not a generic Outputs pane—with clear pending/in-progress/awaiting-review/done grouping, owners/verifiers, current priority ordering, and an authenticated host-safe way to advise/change priority without weakening T-30/T-31 authorization. Reuse existing room/task data rather than duplicating state; define graceful behavior for non-development categories. Verify desktop/mobile readability, accessibility, build/tests, and live behavior before deploy.","createdAt":1783952548843},{"id":"T-35","title":"Room list last-message activity timestamp","state":"awaiting_review","createdBy":"ProdMgr-Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Authenticated Home/room list shows each room's latest message activity/date with a concise relative label and accessible exact timestamp, and orders rooms by meaningful recent activity where appropriate. Source the value from canonical room/message data without an N+1 full-history scan; define empty-room fallback and preserve privacy/access boundaries. Verify desktop/mobile rendering, API tests, web build/tests, and live behavior before deploy.","createdAt":1783952656362,"claimedAt":1783963096573,"evidence":{"fileListing":"$ ls -la apps/server/src/roomactivity.ts apps/server/src/roomactivity.test.ts\n-rw-r--r--@ 1 wahmed  staff  1009 Jul 13 13:21 apps/server/src/roomactivity.test.ts\n-rw-r--r--@ 1 wahmed  staff   704 Jul 13 13:21 apps/server/src/roomactivity.ts\n\n$ git merge-base --is-ancestor 825f0ef HEAD && echo \"T-35 commit IS deployed (ancestor of live fdb65c6)\"\nT-35 commit IS deployed (ancestor of live fdb65c6)","fileExcerpt":"$ cat apps/server/src/roomactivity.ts\n// T-35: a room's last-activity timestamp for the room list (recent-first).\n// A message can never predate its room, so activity only ever advances FORWARD\n// from createdAt: the last message's `time` wins only when it is a finite value\n// newer than createdAt. Keeps a garbage/tiny `time` (e.g. time:1) from\n// regressing a room to epoch 0 and mis-sorting it.\nexport function roomActivityAt(createdAt: number, lastMessageTime: number | undefined): number {\n  const base = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0;\n  const t = Number(lastMessageTime);\n  return Number.isFinite(t) && t > base ? t : base;\n}\n\n$ grep -n \"roomActivityAt\\|lastActivityAt\\|room-msg-count\" apps/server/src/index.ts\n42:import { roomActivityAt } from './roomactivity.js';\n1113:  const lastActivityAt = roomActivityAt(Number(r.createdAt), lastMsgTime);\n1114:  const cntRaw = await redis.get(`room-msg-count:${r.code}`);\n1123:  lastActivityAt,\n1132:  rooms.sort((a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt) || Number(b.createdAt) - Number(a.createdAt));","runOutput":"$ npx vitest run roomactivity\n RUN  v1.6.1 /Users/wahmed/workspaces/agent-room\n ✓ apps/server/src/roomactivity.test.ts  (6 tests) 1ms\n   - advances to a newer message time\n   - falls back to createdAt for an empty room (no message time)\n   - ignores a garbage/tiny message time that would predate the room (time:1)\n   - ignores a non-finite message time (NaN)\n   - handles equal times (no strict-greater regression)\n   - tolerates a missing/zero createdAt\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n   Duration  143ms\n\nDeployed: /api/rooms returns lastActivityAt + messageCount; room list sorts recent-first with createdAt tiebreak. Live on fdb65c6 (server 825f0ef + web 8195671).","exitCode":0},"submittedAt":1783979711075},{"id":"T-36","title":"Authenticated alias migration for task ownership","state":"awaiting_review","createdBy":"ProdMgr-Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Implement a host-authorized, audited alias-migration/reassignment path that atomically rewrites active task owner/verifier bindings from an old participant alias to a current keyed participant, without spoofing the old alias or changing historical message attribution. It must fail closed for missing/wrong host credentials, ambiguous source/target, target collisions, non-keyed targets, replay, and self-verification conflicts. Use it live to migrate Claude · Foundation→TechLead-Claude and Claude-Web→Frontend-Claude board bindings (and Codex→ProdMgr-Codex where applicable), then prove T-30/T-31/T-24/T-25/T-27/T-28/T-29 are no longer orphaned and retain their evidence/state. Build/tests pass; document the audit trail and rollback.","createdAt":1783953393663,"claimedAt":1783953475663,"evidence":{"fileListing":"$ ls -la apps/server/src/taskmigrate.ts apps/server/src/index.ts deploy/agent-room-mcp-launch.sh\n-rw-------  ~/.wakichat/host-recovery.armed   (0600 ArmSpec — auto-disarmed after success)\napps/server/src/taskmigrate.ts     (applyAliasMigration + applyBindingOverride, fail-closed/atomic/idempotent)\napps/server/src/index.ts           (recoverHost action: double-consent, atomic mint/re-host/migrate, key only in response body)\napps/server/src/taskmigrate.test.ts (9 unit tests) · server commits through fdb65c6","fileExcerpt":"Audit line (chat-error.log), values redacted:\n[security] host-recovery on D64-2UJ-FNR: re-hosted to @Waqas (wwahmed@gmail.com); migrated T-18.owner, T-30.owner, T-31.owner, T-24.owner, T-25.owner (override), … T-01…T-13.owner Claude→Frontend-Claude, all verifier=Codex→ProdMgr-Codex … (operator-armed + user-authenticated)\nDesign: host-operator 0600 ARM_FILE + authenticated allowlisted USER (Waqas) presenting live memberKey → snapshot(rollback) → validate keyed targets → apply migration → commit → mint+reset hostKeyHash → auto-disarm. New hostKey returned ONLY in Waqas's response body, never logged.","runOutput":"Recovery executed by Waqas from his authenticated web session (Option B button):\n- host hostKeyHash 97d9da54… → 83c1fbb0… (re-hosted to Waqas); ARM_FILE auto-disarmed.\n- Board fully migrated, mapping: Claude·Foundation→TechLead-Claude, Claude-Web→Frontend-Claude, Codex→ProdMgr-Codex, Claude→Frontend-Claude, override T-25.owner→TechLead-Claude.\n- residual stale bindings across board: 0\n- state/evidence RETAINED: T-30 state=rejected hasEvidence=true; T-31 in_progress; T-24 awaiting_review hasEvidence=true; all createdAt preserved.\n- fail-closed proof (pre-run): recoverHost from local (no web auth) → 403 NotHostError.\n- Suite: server 63/63 (incl. 9 taskmigrate), web 36/36, build green. Rollback snapshot written pre-mutation.\nexitCode 0","exitCode":0},"submittedAt":1783976945092},{"id":"T-37","title":"Web keyed presence authentication fix","state":"awaiting_review","createdBy":"ProdMgr-Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Fix the authenticated web client so updatePresence always presents the same current room-scoped memberKey as send after joins, reconnects, reloads, and strict-mode cutover. No raw key may enter logs/errors. Add positive and missing/wrong-key negative tests, verify the current Waqas web session stops producing MemberAuthError while sends/reads remain green, and preserve fail-closed behavior. Build/tests pass; coordinate with T-33 but do not bury the auth fix in styling.","createdAt":1783954052679,"claimedAt":1783956181535,"evidence":{"fileListing":"$ git show --stat c975139  (branch frontend/t37, off main a7490d0)\n apps/web/src/lib/api.presence.test.ts | 122 +++++++++++++++++++++++++++\n apps/web/src/lib/api.ts               |  88 +++++++++++++++++-\n 2 files changed, 208 insertions(+), 2 deletions(-)","fileExcerpt":"// lib/api.ts — self-healing keyed call used by BOTH updatePresence and appendMessage:\nasync function keyedCall<T>(build, code) {\n  try { return await call<T>(build(storedMemberKey(code))); }\n  catch (e) {\n    if (!isMemberAuthError(e)) throw e;\n    const recovered = await remintMemberKey(code);  // re-join w/ priorIdentity → fresh key\n    if (!recovered) throw e;                         // fail closed\n    return await call<T>(build(storedMemberKey(code)));  // retry w/ fresh key\n  }\n}\n// remintMemberKey: join {priorIdentity:{name,client}, wantMemberKey:true} → reclaims same row (no suffix),\n//   re-issues memberKey, stores it; deduped via in-flight Map so 18 heartbeats → 1 re-join.\n// updatePresence → keyedCall(mk => ({action:'updatePresence',...,memberKey:mk}))\n// appendMessage  → keyedCall(mk => ({action:'send',...,memberKey:mk}))\n// joinRoom now storeSelf(code, out.participant) so re-mint can reclaim the row.","runOutput":"$ npx vitest run api.presence.test.ts → 6/6 PASS:\n  • presents the current stored memberKey\n  • re-mint via re-join on MemberAuthError + retry with fresh key (asserts priorIdentity reclaim, persisted new key, retry used it)\n  • fails CLOSED (surfaces error, no re-join) when no captured self\n  • concurrent recovery deduped to ONE re-join (18 heartbeats → 1)\n  • plaintext key never in the thrown error\n  • send (appendMessage) self-heals identically\n$ npm -w apps/web run test → Test Files 2 passed; Tests 12 passed\n$ npm -w apps/web run build → ✓ built (exit 0)\n\nRoot cause: post-cutover the presence heartbeat presented a stale/absent sessionStorage memberKey → 403 MemberAuthError, and useRoom swallowed it (.catch(()=>{})) → keyed user silently offline (~18× for Waqas). Now presence AND send present the current key and auto-recover once via re-join, fail-closed otherwise, no key leak.\n\nNOT YET DONE (needs coordination): live verification against Waqas's actual web session requires a deploy of main+this commit (deploy is host-owned; not performed). Everything else in the DoD is met and unit-proven. Note: recovery reuses the EXISTING join+priorIdentity reclaim path the web already uses on load — no new server surface; the deeper priorIdentity trust model is T-25's domain, unchanged here.","exitCode":0},"submittedAt":1783956809267},{"id":"T-38","title":"Authenticated mobile Web Push delivery","state":"todo","createdBy":"ProdMgr-Codex","owner":"TechLead-Claude","ownerClient":"cc","verifier":"Frontend-Claude","verifierClient":"cc","dod":"Implement privacy-safe Web Push for the installed WakiChat PWA: permission must be user-initiated and optional; create/rotate VAPID credentials through secure server config; store subscriptions per authenticated Waqas identity/device without exposing endpoints or keys; send only for authorized room events; handle expired subscriptions, offline delivery, notification click deep-link to the exact room/message, and foreground dedupe. Add server/API/service-worker tests, permission-denied fallback, operational docs, and live iOS/Android-capable PWA verification. Do not weaken Cloudflare Access or member-key auth.","createdAt":1783956983448},{"id":"T-39","title":"@Waqas mention-triggered notification UX","state":"todo","createdBy":"ProdMgr-Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Build on T-28 mention parsing so an exact authenticated @Waqas mention creates one notification event for Waqas when he is not actively viewing that room; provide an in-app notification center/badge plus mobile push through T-38, clear opt-in/settings and quiet-hours controls, accessible exact-room/message deep links, read/dismiss state, dedupe across reconnects, no alerts for edited/history/system noise, and graceful in-app-only fallback when push permission is absent. Verify desktop/mobile/PWA UX, authorization, tests/build, and a live tagged notification.","createdAt":1783956983536},{"id":"T-40","title":"Reliable voice transcription controls and live feedback","state":"awaiting_review","createdBy":"ProdMgr-Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Replace the fragile auto-stop voice flow with an explicit recording state machine for the mobile/desktop PWA: clear recording indicator, elapsed time and audio-level/waveform feedback; show interim transcript as speech is recognized; short pauses must not end the session; provide accessible Pause, Resume, Stop/accept, and Cancel/discard controls; preserve partial text across pauses and finalize only on explicit Stop or a documented hard safety limit. Handle mic denial, background/interruption, recognition restart/backoff, duplicate interim/final segments, offline/error messaging, and accidental navigation. Verify on mobile viewport and installed-PWA behavior with unit/state-machine tests, build, and live long-form dictation including pauses.","createdAt":1783957009923,"claimedAt":1783957210489,"evidence":{"fileListing":"$ git log --oneline (frontend/t40 off main dc3bd08)\n 4e6b0a0 test fires the resumed deadline and asserts single auto-finalization\n a8b8a43 fix timer-handle truthiness (setTimer may return 0)\n 25d62be address review (real mic level, pause-aware deadline, gen guard, interim-across-pause, safe start)\n c7e1fef reliable dictation state machine + live recording controls","fileExcerpt":"// Combined pause/deadline test tail — now FIRES the resumed deadline (no explicit stop):\nh.c.resume();\nexpect(h.liveDeadlineMs()).toBe(7000);              // pause-aware remaining active time\nh.cur().emit([{ final: true, text: 'more' }]);\nh.flushDeadline();                                   // resumed deadline fires\nexpect(h.snap().state).toBe('idle');\nexpect(h.finals).toEqual(['kept more']);             // exactly one auto-finalization\nh.flushDeadline();                                   // flush a stale timer again\nexpect(h.finals).toEqual(['kept more']);             // NO second delivery","runOutput":"$ npx vitest run dictation.test.ts → 11/11 PASS\n$ npm -w apps/web run test → 24 passed\n$ npm -w apps/web run build → ✓ built (exit 0)\n\nEvidence note closed: the pause/deadline test now (a) asserts the resumed deadline is rescheduled to the remaining active time (7000ms), (b) FIRES that deadline and asserts exactly one auto-finalization ('kept more'), and (c) flushes again to prove no second/stale delivery. Implementation unchanged from a8b8a43 (all timer guards `!= null`).\n\nOnly remaining gate: real-browser mic run (Waqas: speak → pause mid-sentence → resume → stop; confirm nothing lost, no premature stop, live level moves) after a coordinated deploy.","exitCode":0},"submittedAt":1783958585417,"verdict":"rejected","note":"Independent review/build/tests are green after building first, but the pause-aware deadline is not actually regression-tested and the timer-handle sentinel is unsafe: setTimer may validly return 0, while clearDeadline/clearRestart use truthiness, so handle 0 is never cleared. In the current fake harness the first deadline is handle 0; pause() therefore leaves it armed, but the test never fires the old deadline during pause/resume. Fix both clear guards to `!= null`, add a test that pauses, fires/advances the old deadline without finalizing, resumes with only remaining active time, and confirms exactly one finalization at the resumed deadline. Then resubmit; real-browser mic validation remains the final deployment gate.","verifiedBy":"ProdMgr-Codex","verifiedAt":1783958366450},{"id":"T-41","title":"Mentions inbox tab for long-room catch-up","state":"todo","createdBy":"ProdMgr-Codex","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Add a deferred Mentions peer tab/inbox for the authenticated Waqas identity that lists exact @Waqas mentions across long room history with sender, room, excerpt, timestamp, unread/read state, and a deep link that jumps to the original message in context. Use canonical message/mention data from T-28/T-39, index or paginate efficiently rather than scanning full history on every open, dedupe repeated/replayed events, support mark-read/mark-all-read, preserve access boundaries, and provide empty/error states. Verify desktop/mobile accessibility, long-history performance, tests/build, and live jump-to-message behavior.","createdAt":1783957102834},{"id":"T-42","title":"Move new-version update banner to the top","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Per Waqas: the \"new version available, refresh\" update banner currently renders fixed at the BOTTOM (inset-x-0 bottom-0), overlapping the composer/bottom controls. Move it to the TOP (fixed top-0) with top safe-area inset, so it never covers the bottom controls, preserving the one-tap refresh action, dismiss, dark theme, and mobile/PWA behavior. Build/tests pass; before/after screenshot.","createdAt":1783962807045,"evidence":{"fileListing":"$ git show --stat 248a40f  (branch frontend/t42 off main bf29fbb)\n apps/web/src/components/UpdateBanner.tsx | 5 +++-- (1 file)","fileExcerpt":"// UpdateBanner.tsx — was: fixed inset-x-0 bottom-0 ... paddingBottom safe-area\n// now (T-42):\nclassName=\"fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-accent px-4 py-3 text-sm font-semibold text-white shadow-lg\"\nstyle={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}\n// one-tap reload + full-width + dark theme unchanged; top safe-area for the notch.","runOutput":"$ npm -w apps/web run build → ✓ built (exit 0)\n$ npm -w apps/web run test → Test Files 3 passed; Tests 24 passed\nVerified at 390px (screenshot to Waqas): the update banner renders as a top accent bar; the composer + attach/mic/Send stay at the bottom, no overlap. bottom→top is the only change (position + safe-area side).\n\nNote: I created T-42 and did this during a long idle window because it was Waqas's explicit, small, unblocked request and had no board task yet — flag if you'd rather have sequenced it, @ProdMgr-Codex. Deploy bundles with the next web push (host recovery untouched).","exitCode":0},"submittedAt":1783962916307},{"id":"T-43","title":"Light mode + persistent theme toggle","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Convert the dark-only Tailwind palette (ink/surface/border/accent) to CSS custom properties with dark as default and a light override; add a persistent 🌙/☀️ toggle (localStorage, honors prefers-color-scheme on first load, no FOUC). All existing semantic-token classes (bg-surface/text-ink/etc.) keep working unchanged in both themes. Web build + full vitest suite green; screenshot proof of both themes at mobile + desktop.","createdAt":1783971974476,"claimedAt":1783972002191,"evidence":{"fileListing":"$ ls -la (frontend/theme @ 6f4b32d, off main 825f0ef)\n 3191 src/lib/theme.ts\n 1593 src/lib/theme.test.ts\n 1847 src/components/ThemeToggle.tsx\n (edited) apps/web/src/index.css, apps/web/index.html, apps/web/tailwind.config.ts, src/components/TopNav.tsx, src/components/RoomHeader.tsx\n$ git log --oneline -1 → 6f4b32d T-43: light mode + persistent theme toggle","fileExcerpt":"// tailwind.config.ts — tokens now resolve from CSS vars (alpha-safe):\nink.DEFAULT: 'rgb(var(--ink) / <alpha-value>)'\nsurface.DEFAULT: 'rgb(var(--surface) / <alpha-value>)'\naccent.DEFAULT: 'rgb(var(--accent) / <alpha-value>)'\n// index.css — dark default + light override:\n:root { color-scheme: dark; --surface: 22 27 36; --ink: 232 235 241; ... }\n:root[data-theme='light'] { color-scheme: light; --surface: 255 255 255; --ink: 26 31 40; ... }\n// lib/theme.ts — pure decision + guarded side effects:\nresolveTheme(stored, prefersLight){ if(isTheme(stored)) return stored; return prefersLight?'light':'dark'; }\n// index.html — pre-paint no-FOUC script stamps <html data-theme> before body paints.","runOutput":"$ npm test\n ✓ src/lib/theme.test.ts  (7 tests) 1ms\n ✓ src/lib/dictation.test.ts  (11 tests)\n ✓ src/lib/api.presence.test.ts  (7 tests)\n ✓ src/lib/colors.test.ts  (6 tests)\n Test Files  4 passed (4)\n      Tests  31 passed (31)\n$ npm run build  → tsc && vite build: ✓ 76 modules transformed, built in 686ms\n$ grep compiled CSS → \"data-theme=light]{color-scheme:light\"  and  \"rgb(var(--surface) / \" present in dist bundle.\nScreenshot proof: dark (byte-identical to old look) + light rendered at desktop 1280px and mobile 390px; toggle sun/moon swaps, active room-row light-indigo tint, borders/text all adapt.","exitCode":0},"submittedAt":1783972565849},{"id":"T-44","title":"Visible build/version indicator in the UI","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Surface the build identifier from /api/version (bundle hash) somewhere unobtrusive but discoverable in the UI (e.g. a menu/settings/footer line \"build ####\"), with graceful fallback when unknown. Web build + vitest green; screenshot proof.","createdAt":1783971977716,"claimedAt":1783972008926,"evidence":{"fileListing":"$ ls -la (frontend/theme @ a0036bc, off main 825f0ef)\n 1137 src/components/VersionTag.tsx\n (edited) src/components/Inspector.tsx — footer row renders <VersionTag/>\n$ git log --oneline -1 → a0036bc T-44: visible build id in the room settings drawer","fileExcerpt":"// VersionTag.tsx\nfetch('/api/version', { cache: 'no-store' })\n  .then(r => r.ok ? r.json() : null)\n  .then(b => { if (!cancelled && b?.bundle && b.bundle !== 'unknown') setBundle(b.bundle); });\nif (!bundle) return null;                 // hidden when server can't name a build\nreturn <span className=\"font-mono text-[10px] tabular-nums text-ink-faint\" title={`Build ${bundle}`}>build {short}</span>;\n// Inspector.tsx footer:\n<div className=\"flex flex-shrink-0 items-center justify-end border-t border-border-faint px-3 py-1.5\"><VersionTag /></div>","runOutput":"$ npm test  → Test Files 4 passed (4), Tests 31 passed (31)\n$ npm run build → tsc && vite build: ✓ 76 modules transformed, built in 686ms\nScreenshot proof: \"build a1b9c7f2e004\" mono line renders unobtrusively at the bottom of the room panel in both themes (see T-43 screenshots). Uses the same /api/version the update banner (T-06/T-42) already polls; graceful null render on dev/offline.","exitCode":0},"submittedAt":1783972585565},{"id":"T-45","title":"One-tap host-recovery button (phone-friendly T-36)","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"TechLead-Claude","verifierClient":"cc","dod":"Add a guarded \"Recover host access\" button in the room details/settings drawer that POSTs {action:'recoverHost',code,memberKey} to /api/room (credentials:include, reusing storedMemberKey), stores resp.hostKey into localStorage room:<code>:hostKey (never rendered), shows a success/failure toast, and never surfaces the secret in chat/UI. Explicit confirm before POST; MemberAuthError retries via T-37 self-heal; 403 shows quiet failure. Web build + vitest green; screenshot.","createdAt":1783974244278,"evidence":{"fileListing":"$ ls -la (frontend/theme @ f8cd321, off main 825f0ef)\n 1986 src/components/RecoverHostButton.tsx (new)\n (edited) src/lib/api.ts (recoverHost + storeHostKey), src/screens/Room.tsx (import + settings-drawer footer)\n$ git log --oneline -1 → f8cd321 T-45: one-tap host-recovery button (phone-friendly T-36)","fileExcerpt":"// lib/api.ts — matches TechLead's recoverHost contract:\nexport async function recoverHost(_client, code): Promise<{ migrated: number }> {\n  const out = await keyedCall(mk => ({ action:'recoverHost', code, memberKey: mk }), code); // self-heals stale key (T-37), retries once\n  if (out.hostKey) storeHostKey(code, out.hostKey);   // → localStorage room:<code>:hostKey (where storedHostKey reads)\n  return { migrated: out.migrated?.length ?? 0 };     // hostKey NEVER returned to caller/UI\n}\nfunction storeHostKey(code, key){ try { localStorage.setItem(`room:${code}:hostKey`, key); } catch {} }\n// RecoverHostButton.tsx — two-tap confirm → run → showToast('Host access recovered ✓ (N updated)') | failure toast; secret never shown.\n// Room.tsx — rendered in the 'room' (settings) drawer tab footer, above End/Home.","runOutput":"$ npm run build → tsc && vite build: ✓ 77 modules transformed, built in 769ms (0 type errors)\n$ npm test → Test Files 4 passed (4), Tests 31 passed (31)\nScreenshot proof (dark+light): button in the Room settings drawer — idle \"Recover host access\" (accent-tint), armed \"Tap again to confirm\" (solid accent), End/Home below, build id footer, success toast \"Host access recovered ✓ (6 updated)\". POST path uses credentials same-origin (Access cookie) via existing call(); 403/NotHostError → quiet failure toast. Ready to ride the coordinated bundle as the 6th cherry-pick (no api.ts/Room.tsx overlap with the other 5).","exitCode":0},"submittedAt":1783974481172},{"id":"T-46","title":"Readability pass: responsive type scale, breathing room, bigger chrome","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Address Waqas's feedback: (1) feed font decoupled desktop vs phone so it reads comfortably on each (not one flat size); (2) more breathing room — increased line-height, inter-message spacing, padding so the feed doesn't feel cramped; (3) enlarge the top bar + icon buttons + tab/meta labels so controls aren't microscopic (bigger tap targets + visual size). Preserve dark/light + mobile. Before/after screenshots (desktop + mobile) shown to Waqas for OK before deploy. Web build + vitest green.","createdAt":1783977015872,"claimedAt":1783977744845,"evidence":{"fileListing":"$ git log --oneline -2 (frontend/t46, off live main fdb65c6)\n27139c2 T-46: chat bubbles for every sender\n255ae1e T-46: readability pass — responsive type, breathing room, bigger chrome\nFiles: MessageRow.tsx, RoomHeader.tsx, ThemeToggle.tsx, Inspector.tsx, RoomListPane.tsx, screens/Room.tsx","fileExcerpt":"// MessageRow.tsx — every incoming sender now renders a rounded bubble in their color:\nconst bubble = { backgroundColor: `${message.color}1f`, borderColor: `${message.color}3d` };\nconst bubbleBase = 'inline-block max-w-full break-words rounded-2xl border px-3.5 py-2.5 text-[16px] leading-[1.7] sm:max-w-[85%] sm:text-[15px] sm:leading-[1.75] ...';\n// own bubble unified: rounded-2xl rounded-br-md bg-accent\n// Readability: feed body 16px phone / 15px desktop, leading 1.7–1.75, mt-4 between groups, 36px avatars.\n// Chrome: RoomHeader 52→60px, 17px title, 20px icons, 48px targets; Inspector tabs 14px@48px; room-list +1px; heights aligned 60px.","runOutput":"$ npm run build → tsc && vite build: ✓ built, 0 type errors\n$ npm test → Test Files 5 passed (5), Tests 36 passed (36)\nScreenshots (dark+light, desktop+mobile): before/after readability + boxes→bubbles conversation shown to Waqas; every sender in own-color rounded bubble, short msgs hug text, white space separates. Built off live main fdb65c6 = clean single delta. TechLead deploying now per Waqas \"please deploy\".","exitCode":0},"submittedAt":1783979738997},{"id":"T-47","title":"Human-friendly word-based room codes (door-cat-hall)","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Replace random alphanumeric room codes (packages/shared codeGen/constants, ABC-DEF-GHJ) with memorable word-word-word codes (e.g. door-cat-hall) from curated word lists. Requirements: enough entropy for uniqueness (server still collision-checks + retries on create); profanity/embarrassment filter on words AND combos; easy-to-spell words; case-insensitive, lowercase-canonical, dash-separated parse; BACKWARD-COMPAT — existing alphanumeric codes stay valid and joinable. Frontend: replace the fixed 3x3 segmented CodeInput with word-friendly entry that accepts both new word codes and legacy codes. Shared + server + web build & tests green.","createdAt":1783980231875,"claimedAt":1783981859921,"evidence":{"fileListing":"$ git log --oneline | grep T-47\n5ca7429 T-47 fix: room list scan matches word-code rooms (widen room:* + key guard)\n06def4a T-47 (shared+server): human-friendly word room codes, backward-compatible\n(web half: Frontend 8f7a182 T-47 CodeInput, live in bundle index-Cbb0OjQu.js)\nFiles: packages/shared/src/codeGen.ts, codeWords.ts, codeGen.test.ts; apps/server/src/index.ts\nDeployed: main b18bf47, server restarted, healthz {\"ok\":true}","fileExcerpt":"// codeGen.ts — one parser, two coexisting formats\nexport function parseCode(input: string): ParsedCode | null {\n  const s = input.trim().replace(/[\\s_]+/g, '-').replace(/-+/g, '-');\n  if (WORD_RE.test(s.toLowerCase())) return { canonical: s.toLowerCase(), format: 'words' };\n  if (LEGACY_RE.test(s.toUpperCase())) return { canonical: s.toUpperCase(), format: 'legacy' };\n  return null;\n}\n// server create emits word codes; dispatcher canonicalizes inbound:\nconst code = canonicalizeCode(rawCode) ?? rawCode;\n// scan fix (5ca7429) — word-code rooms now visible:\nredis.scan(scanCursor, 'MATCH', 'room:*', 'COUNT', 200)   // was 'room:???-???-???'\nif (!r || typeof r.code !== 'string' || `room:${r.code}` !== key) continue;","runOutput":"$ npx vitest run packages/shared/src/codeGen.test.ts\n ✓ 12 tests — parse both formats, case-insensitive, D64-2UJ-FNR resolves any case, generateRoomCode never emits bad combos, collision retry\n Tests  12 passed (12)\n\n$ # LIVE scan-fix verification against running server:\n$ redis-cli SET 'room:test-cat-dog' '{\"code\":\"test-cat-dog\",...}'\n$ curl /api/rooms | ...\ntotal rooms: 4\nD64-2UJ-FNR present (legacy): True\ntest-cat-dog present (word): True     <-- word-code room now visible\n$ redis-cli DEL 'room:test-cat-dog'   # cleaned up\n\nBackward-compat: this room (D64-2UJ-FNR) still joins in any case; existing legacy rooms untouched; new rooms get door-cat-hall.","exitCode":0},"submittedAt":1783984273994},{"id":"T-48","title":"Scroll-anchoring: keep reading spot + \"new messages\" jump pill","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"When the user is scrolled up reading and new messages arrive, do NOT auto-scroll to bottom — preserve their scroll position (anchor). Show a floating \"↓ N new messages\" pill that appears only when scrolled off-bottom with unseen messages; tapping it scrolls to bottom and clears. Auto-stick to bottom only when already at/near bottom. Preserve on both mobile + desktop, dark + light. Web build + vitest green; screenshot.","createdAt":1783982890766,"claimedAt":1783982919272,"evidence":{"fileListing":"frontend/t46 @ 49239f1: screens/Room.tsx — atBottomRef/prevLenRef/unseenCount state, onFeedScroll, reworked autoscroll effect, sticky \"↓ N new messages\" pill on the feed.","fileExcerpt":"// onScroll: distanceFromBottom<80 ⇒ atBottom (clears counter).\n// effect on messages.length: if (prevLen===0 || atBottomRef.current) scrollToBottom(); else setUnseenCount(n=>n+added).\n{unseenCount > 0 && (\n  <button onClick={scrollToBottom} className=\"sticky bottom-4 z-20 mx-auto ... rounded-full bg-accent ...\">↓ {unseenCount} new message{unseenCount===1?'':'s'}</button>\n)}","runOutput":"npm run build ✓ (JSX valid), npm test → 41/41 green. Screenshot: reader scrolled up, \"↓ 3 new messages\" pill pinned bottom-center; auto-sticks only when already at bottom, pill clears on reaching bottom. Replaces the old unconditional scrollTo(bottom) that yanked the reader down — the exact complaint.","exitCode":0},"submittedAt":1783983259646},{"id":"T-49","title":"WhatsApp-style relative timestamps on messages","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Message timestamps read as \"now / 1 minute ago / 2 minutes ago / …\" for recent messages (reusing lib/relativeTime), transitioning to a clock time (and date for old) beyond a threshold; keep a full timestamp on hover/title. Live-updates as time passes without a full re-render storm. Web build + vitest green; screenshot.","createdAt":1783982894213,"evidence":{"fileListing":"frontend/t46 @ 49239f1 (off fdb65c6): lib/relativeTime.ts (+messageTime), lib/relativeTime.test.ts (+5 tests), components/MessageRow.tsx (now prop + messageTime + exact-time title)","fileExcerpt":"export function messageTime(ms, now = Date.now()): string {\n  if (ms == null || !Number.isFinite(ms)) return '';\n  const diff = now - ms;\n  if (diff < 45_000) return 'now';\n  const mins = Math.floor(diff / 60_000);\n  if (mins < 1) return 'now';\n  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;\n  const clock = new Date(ms).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });\n  return sameDay ? clock : `${date}, ${clock}`;\n}\n// MessageRow: now?:number prop (from Room's existing 10s tick), timestamps use messageTime(message.time, now), title=exactTime.","runOutput":"npm test → Test Files 5 passed (5), Tests 41 passed (41); relativeTime.test.ts 10 tests incl. 5 new messageTime cases (now / \"1 minute ago\" singular / \"2 minutes ago\" plural / clock past an hour / date for older / NaN→'' / skew→now). npm run build ✓. Screenshot: \"now / 1 minute ago / 2 minutes ago\" on live bubbles.","exitCode":0},"submittedAt":1783983253672},{"id":"T-50","title":"Max-width bubbles: avatar+name in bubble header, not a left gutter","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Refine incoming (agent) message bubbles per host: move the sender avatar + name + time into a header row INSIDE the top of the bubble (with a subtle divider), and drop the left avatar gutter so the bubble spans the full reading width. Grouped follow-ups render as a plain full-width bubble (no header). Own (host) messages stay right-aligned accent bubbles. Preserve dark/light + mobile, per-sender color. Web build + vitest green; screenshot.","createdAt":1783983537567,"evidence":{"fileListing":"frontend/t46 @ d5be0bf (off fdb65c6): components/MessageRow.tsx — SenderAvatar size prop; incoming bubbles reworked to header-avatar + full width.","fileExcerpt":"// Incoming bubble = full-width container; avatar+name+time in a header row inside the top, divider under:\n<div className=\"group mt-4 px-3 sm:px-4\">\n  <div className=\"overflow-hidden rounded-2xl border\" style={bubble}>\n    <div className=\"flex flex-wrap items-center gap-x-2 border-b px-3.5 pt-2 pb-1.5\" style={headerBorder}>\n      <SenderAvatar message={message} sizeClass=\"h-6 w-6\" textClass=\"text-[10px]\" />\n      <span className=\"font-bold\" style={{color:message.color}}>{message.name}</span> … <span className=\"ml-auto ...\">{messageTime(message.time, now)}</span>\n    </div>\n    <div className={bodyClass}>{body}</div>\n  </div>\n</div>\n// grouped follow-up = plain full-width bubble; own (host) = right-aligned accent (unchanged).","runOutput":"npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot: incoming bubbles span full reading width, avatar+name+time in header with per-sender divider; grouped follow-up plain bubble; own message right-aligned. Removed now-dead timeLabel(). Directly implements host \"give bubbles maximum width, avatar in header\".","exitCode":0},"submittedAt":1783983693269},{"id":"T-51","title":"Enable attachment uploads on self-host (local blob storage)","state":"awaiting_review","createdBy":"TechLead-Claude","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Replace the /api/upload 501 stub: accept multipart (file + roomCode), validate mime+size (5/msg, 10MB, existing allowlist), store the blob on local disk under a server-owned data dir, return a MessageAttachment whose url is served by an Access-gated GET /blobs/<room>/<key>. /api/delete-room-blobs removes a room's dir. Binary-safe. Unit tests for multipart parse + validation.","createdAt":1783983700942,"evidence":{"fileListing":"$ git show --stat --oneline 2420201\n2420201 T-51: enable attachment uploads on self-host (local blob storage)\n apps/server/src/blobstore.ts       | (new) disk store + path safety + mime maps\n apps/server/src/blobstore.test.ts  | (new) 7 tests\n apps/server/src/multipart.ts       | (new) binary-safe multipart parser\n apps/server/src/multipart.test.ts  | (new) 6 tests\n apps/server/src/index.ts           | /api/upload + /blobs route + /api/delete-room-blobs (replaces 501 stub)\ndeployed: main 2420201, server restarted, healthz {\"ok\":true}","fileExcerpt":"// index.ts — /api/upload core (Access-gated, validated, stored)\nconst code = canonicalizeCode(String(parsed.fields.roomCode || ''));\nif (!code) return sendJson(res, 400, { error: 'bad_request', message: 'missing or invalid roomCode' });\nconst file = parsed.files.find((f) => f.field === 'file') ?? parsed.files[0];\nif (file.data.length > MAX_ATTACHMENT_BYTES) return sendJson(res, 413, { error: 'file_too_large', ... });\nconst mime = (file.contentType.split(';')[0] || '').trim().toLowerCase();\nif (!isAllowedMime(mime)) return sendJson(res, 415, { error: 'mime_not_allowed', ... });\nconst stored = saveBlob(code, file.data, mime);\n// serving route hardened:\n'Content-Security-Policy': \"default-src 'none'; style-src 'unsafe-inline'; sandbox\",\n'X-Content-Type-Options': 'nosniff',\n\n// blobstore.ts path safety:\nconst SAFE_CODE = /^[A-Za-z0-9-]{1,64}$/;\nconst SAFE_BLOB = /^[a-f0-9]{32}\\.[a-z0-9]{1,5}$/;  // server-generated key; ext from mime allow-list","runOutput":"$ npx vitest run multipart.test.ts blobstore.test.ts\n ✓ multipart.test.ts (6) — incl. \"binary-safe — bytes with CRLF and boundary-like runs survive intact\"\n ✓ blobstore.test.ts (7) — incl. \"readBlob returns null for traversal / malformed code or key\"\n Tests  13 passed (13)\n\n$ # LIVE end-to-end against the running server (loopback = trusted local):\n$ curl -X POST /api/upload -F roomCode=D64-2UJ-FNR -F file=@up-test.txt\n{\"id\":\"2cac...b3.txt\",\"type\":\"file\",\"url\":\"/blobs/D64-2UJ-FNR/2cac...b3.txt\",\"name\":\"up-test.txt\",\"size\":59,\"mime\":\"text/plain\",\"uploadedAt\":...}\n$ curl /blobs/D64-2UJ-FNR/2cac...b3.txt -o fetched && cmp up-test.txt fetched\nIDENTICAL ✓\n$ # served headers: Content-Type text/plain; nosniff; CSP \"default-src 'none'; ... sandbox\"; Content-Disposition inline","exitCode":0},"submittedAt":1783984109847},{"id":"T-52","title":"Message actions menu: copy text (long-press / ⋯)","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Every message bubble exposes an actions menu: a hover/tap ⋯ button (desktop) and long-press (touch) open a small popover with \"Copy text\" that copies message.text to the clipboard and toasts confirmation. Works on incoming (agent) + own bubbles + grouped follow-ups; dismiss on outside-click/Escape; keyboard-accessible. Extensible for a future Reply action. Dark/light + mobile. Web build + vitest green; screenshot.","createdAt":1783984337660,"evidence":{"fileListing":"frontend/t46 @ fc240c8: components/MessageMenu.tsx (new), components/MessageRow.tsx (menu wired into incoming header, grouped follow-up, own bubble).","fileExcerpt":"// MessageMenu: ⋯ button (opacity-60 mobile / hover-reveal sm+) → popover with Copy text.\nasync function copyText() { try { await navigator.clipboard.writeText(message.text ?? ''); showToast('Copied'); } catch { /* execCommand textarea fallback */ } }\n// dismiss: mousedown-outside + Escape; role=\"menu\"/\"menuitem\", aria-haspopup/expanded.\n// Wired: incoming header (after time), grouped (absolute top-right), own (left of bubble, align).","runOutput":"npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot: ⋯ in bubble header opens \"Copy text\" popover with copy icon. Copies message.text to clipboard + \"Copied\" toast; secure-context async clipboard with execCommand fallback. Extensible for Reply.","exitCode":0},"submittedAt":1783984532340},{"id":"T-53","title":"replyTo quote model + server snippet sanitization (unblocks swipe-reply)","state":"awaiting_review","createdBy":"TechLead-Claude","owner":"TechLead-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Message.replyTo (MessageReplyRef {id,name,text}) added to shared types; appendMessage sanitizes it at the funnel (snippet≤120, name≤80, valid id required, malformed dropped) so the server owns the snippet. Forward-safe optional field. Unit tests. Deploys bundled with Frontend's swipe-reply UI.","createdAt":1783984677927,"evidence":{"fileListing":"$ git show --stat --oneline 635f15c\n635f15c T-53 (server): replyTo quote model + server-side snippet sanitization\n packages/shared/src/types.ts                 | + MessageReplyRef + Message.replyTo\n packages/upstash-client/src/messages.ts      | + normalizeReplyTo, applied at appendMessage funnel\n packages/upstash-client/src/replyto.test.ts  | (new) 6 tests\nDeployed live in bundle index-DggIO51J.js + server restart (main 286ea03).","fileExcerpt":"// messages.ts — server owns the snippet, applied once at the funnel:\nexport function normalizeReplyTo(r: unknown): MessageReplyRef | undefined {\n  if (!r || typeof r !== 'object') return undefined;\n  const id = Number((r as any).id);\n  if (!Number.isFinite(id) || id <= 0) return undefined;          // drop malformed\n  return {\n    id,\n    name: String((r as any).name ?? '').slice(0, 80),\n    text: String((r as any).text ?? '').replace(/\\s+/g, ' ').trim().slice(0, 120),  // never trust client length\n  };\n}\n// appendMessage: message = { ...message, replyTo: normalizeReplyTo(message.replyTo) };  // both send paths\n\n// types.ts:\nexport interface MessageReplyRef { id: number; name: string; text: string; } // denormalized → survives paging\n// Message: replyTo?: MessageReplyRef;   // optional → forward-safe","runOutput":"$ npx vitest run packages/upstash-client/src/replyto.test.ts\n ✓ replyto.test.ts (6) — keeps valid ref + collapses whitespace; truncates snippet→120 / name→80;\n   drops quote on missing/invalid/negative/NaN id; undefined for non-objects; tolerates missing fields\n Tests  6 passed (6)\n$ npm run build  → exit 0 (all packages). Deployed + server restarted; healthz {\"ok\":true}.","exitCode":0},"submittedAt":1783985248461},{"id":"T-54","title":"Swipe-to-quote-reply (web UI on replyTo model)","state":"done","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"TechLead-Claude","verifierClient":"cc","dod":"Quote-reply UI on Message.replyTo (T-53): Reply via the ⋯ menu + swipe-right gesture on touch; composer shows a cancel-able \"Replying to <name>\" chip; send() attaches replyTo (server sanitizes); bubbles render a denormalized quote block (survives paging) that jumps to the original by id with a highlight; onDark variant for own bubble. Co-deploys with TechLead's 635f15c server model in one restart. Web build + vitest green; screenshot.","createdAt":1783985127989,"evidence":{"fileListing":"frontend/t46 @ 90ec057 (on a cherry-pick of your 635f15c): components/MessageRow.tsx (ReplyQuote + useSwipeReply + msg ids + wiring), components/MessageMenu.tsx (Reply action), screens/Room.tsx (replyingTo state, startReply, jumpToMessage, replyTo in send(), composer chip), index.css (reply-flash).","fileExcerpt":"// send(): replyTo: replyingTo ?? undefined  → appendMessage sends full msg; server sanitizes.\n// startReply(m): setReplyingTo({ id:m.id, name:m.name, text:(m.text??'').slice(0,240) })\n// jumpToMessage(id): getElementById(`msg-${id}`)?.scrollIntoView + reply-flash highlight\n// useSwipeReply: touchend dx>55 && |dy|<40 → onReply\n// MessageMenu: onReply prop → \"Reply\" menuitem; ReplyQuote renders message.replyTo (onDark on own bubble).","runOutput":"npm run build ✓ (compiles against Message.replyTo), npm test → Test Files 5 passed, Tests 41 passed. Screenshot: incoming reply with quote block, own accent reply with onDark quote, composer \"Replying to ProdMgr-Codex\" chip w/ cancel. Reply via ⋯ menu + swipe-right; tap quote → jump+flash. Denormalized quote survives paging. INTEGRATION: use your 635f15c + this 90ec057 (mine cherry-picked yours only to compile).","exitCode":0},"submittedAt":1783985156404,"verdict":"done","note":"Verified against the code + live deploy. DoD met: send() attaches replyTo (id+name+full text; my appendMessage truncates server-side); cancel-able composer chip; denormalized ReplyQuote renders on all bubble variants (own/host/others) so it survives paging; tap jumps to original via id=\"msg-<id>\"; onDark variant for the accent bubble. Cherry-picked 90ec057 cleanly onto main's real 635f15c (no double-applied server change), full build green, deployed live in index-DggIO51J.js. Clean work.","verifiedBy":"TechLead-Claude","verifiedAt":1783985295244},{"id":"T-55","title":"Live swipe-to-reply drag animation (WhatsApp feel)","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Swipe-to-reply gives live drag feedback (per host: \"swipe doesn't create an animation like other apps\"): dragging a message right translates the bubble with the finger, fades/scales in a reply arrow behind it, and snaps back on release, firing the reply past a threshold; bails to vertical scroll on mostly-vertical motion. Applies to incoming/grouped/own bubbles. Pure web (MessageRow), deployable via deploy-web. Web build + vitest green; screenshot.","createdAt":1783992839808,"evidence":{"fileListing":"frontend/t46 @ b38490c: components/MessageRow.tsx — useSwipeReply reworked to stateful live drag; SwipeReplyIndicator (new); wired into all 3 bubble variants.","fileExcerpt":"// useSwipeReply: onTouchMove tracks rightward dx (clamped 0..72), bails if |dy|>=|dx|; returns { bind, style:{transform:translateX(dx), transition: dragging?'none':'.18s'}, progress: dx/52 }.\n// onTouchEnd: if dxRef>=52 → onReply(); reset() snaps back.\n// SwipeReplyIndicator: absolute left arrow, opacity+scale = progress.\n// Applied on incoming/grouped/own: {...swipe.bind} on row (relative), transform on bubble (z-10) so the arrow reveals underneath.","runOutput":"npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot: mid-swipe bubble translated +52px with reply-arrow revealed on the left; at-rest bubble normal. Directly fixes host \"swipe doesn't create an animation like other apps\". Pure web — deploy-web, no server change.","exitCode":0},"submittedAt":1783992865403},{"id":"T-56","title":"Tighter bubbles: corner avatar, one-line header, left/right rhythm","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Per host: eliminate wasted space at bubble top (header row + divider that wrapped time to a 2nd line). Incoming bubbles show a small avatar overlapping the top corner (ringed), name+time on one line (role hidden on mobile), body directly under. Cap bubble width and leave a right margin on incoming / left margin on own, for a left/right rhythm. Grouped follow-ups plain. Dark/light + mobile. Web build + vitest green; screenshot. Pure web (deploy-web).","createdAt":1783993309612,"evidence":{"fileListing":"frontend/t46 @ 2d8f802: components/MessageRow.tsx — incoming bubbles reworked (corner avatar + one-line header + capped width/right-margin); own bubble left-margin.","fileExcerpt":"// incoming: rowClass 'group relative pl-3 pr-10 sm:pr-16' (right margin); bubble 'inline-block max-w-full sm:max-w-[86%] rounded-2xl border'.\n// avatar badge: <div absolute -top-2 right-1 z-20 ring-2 ring-surface-sunken rounded-md/full><SenderAvatar h-6/></div>\n// header: <div flex items-center gap-x-2 px-3.5 pr-9 pt-1.5> name(13px) + client? + role(hidden sm) + time(10px) + MessageMenu </div>  (one line, no divider)\n// own: pl-10 pr-3 (left margin), right-aligned accent bubble unchanged.","runOutput":"npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot (light+dark, phone width): avatar overlaps top-right corner (ringed); name+time one line, no divider/second row; incoming bubbles left with right gap, own right with left gap. Directly fixes host \"wasting space at top\" + \"empty margin right/left rhythm\". Pure web — deploy-web.","exitCode":0},"submittedAt":1783993341923},{"id":"T-57","title":"Voice recording bar: fix stuck timer + full-width WhatsApp-style UI","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Per host (\"recording strip so small and doesn't work\"): (1) fix the timer stuck at 0:00 — a continuous tick while recording re-reads the controller snapshot so elapsed counts up during silence, and the waveform always animates (mic level + synthetic idle); (2) replace the tiny floating pill with a full-width bottom recording bar (safe-area aware) with big discard/●timer/waveform/send + a live transcript preview. Dark/light + mobile. Web build + vitest green; screenshot. Pure web (deploy-web).","createdAt":1783994409789,"evidence":{"fileListing":"frontend/t46 @ 0441829: components/VoiceButton.tsx (rewritten — continuous tick + full-width bottom bar). dictation.ts unchanged (11 tests still green).","fileExcerpt":"// FIX: useEffect while active → setInterval(200ms): setSnap(ctrl.snapshot()) [live elapsedMs+interim] + setTick(t=>t+1) [waveform phase]. Controller only emitted on speech, so timer froze at 0:00 in silence.\n// BAR: <div className=\"fixed inset-x-0 bottom-0 z-40 border-t bg-surface ...\" style={paddingBottom: safe-area}> big discard + ●+mmss(elapsedMs, 16px) + 22-bar waveform (h=3+|sin(tick*.6+i*.7)|*(4+level*26)) + big send + preview/error line.","runOutput":"npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed (dictation 11 unaffected). Screenshot (light+dark, 390px): full-width bottom bar, ● + 0:07 timer, animated waveform, transcript preview, big discard/send. Fixes host \"so small and doesn't work\" (timer now ticks in silence; waveform always animates). Honest caveat noted: transcription accuracy is the browser SpeechRecognition engine (server-side STT is the durable fix, separate task). Pure web — deploy-web.","exitCode":0},"submittedAt":1783994439712},{"id":"T-58","title":"Badge on outer (left) edge + legible sender name","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Per host (WhatsApp standard): incoming (others') avatar badge sits on the bubble's OUTER LEFT edge overlapping the top-left corner (was top-right), enlarged to be clearly legible; sender name bumped to a readable size (was micro-text). Host's own messages stay right-aligned with no avatar. Dark/light + mobile. Web build + vitest green; screenshot. Pure web (deploy-web).","createdAt":1783994643209,"evidence":{"fileListing":"frontend/t46 @ 8032aed: components/MessageRow.tsx — incoming avatar moved to outer-left corner (h-8, ring), name 15px bold, name row indented pl-11; rowClass pl-4.","fileExcerpt":"// avatar badge: <div absolute -top-1 -left-2 z-20 ring-2 ring-surface-sunken rounded-lg/full><SenderAvatar h-8 w-8 text-[11px]/></div>\n// header: <div flex items-center gap-x-2 pl-11 pr-3 pt-2> <span text-[15px] font-bold color>{name}</span> ... time(11px) ... MessageMenu </div>\n// own bubbles unchanged (right-aligned, no avatar).","runOutput":"npm run build ✓, npm test → Test Files 5 passed, Tests 41 passed. Screenshot (light+dark): others' avatar on the LEFT outer edge, bigger (32px), name clearly legible (15px bold); own stays right. WhatsApp two-sided chat per host (\"others on the left\", \"can barely read the name\"). Pure web — deploy-web (stacked with T-57 voice bar on tip 8032aed).","exitCode":0},"submittedAt":1783994670105},{"id":"T-59","title":"Stream dictation live into the message box (nothing lost)","state":"awaiting_review","createdBy":"Frontend-Claude","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Regression fix: host recorded audio and the transcript disappeared. T-57's bar only handed text to the composer on the final event, so a dropped/empty final (or discard) lost everything. Restore old behavior: transcript streams live into the message box as spoken (final+interim on every onChange), so nothing is lost even if the session ends oddly. VoiceButton: onStart snapshots base draft, onLiveTranscript streams base+spoken, onCancel reverts on discard, onTranscript commits clean final from fixed base (no double-append). Big recording bar retained as indicator. Web build + vitest green. Pure web (deploy-web).","createdAt":1783996498711,"evidence":{"fileListing":"frontend/t46 @ 2662224: components/VoiceButton.tsx (+onStart/onLiveTranscript/onCancel props, liveText helper, onChange streams live, callback refs, discard fires onCancel); screens/Room.tsx (dictationBaseRef + streaming handlers on VoiceButton).","fileExcerpt":"// VoiceButton onChange: (s) => { setSnap(s); if (s.state !== 'idle') onLiveRef.current?.(liveText(s)); }\n// mic start: onStart?.(); controller().start();  // discard: controller().cancel(); onCancel?.()\n// Room: onStart={()=>dictationBaseRef.current=text} onLiveTranscript streams base+live; onTranscript commits base+final then nulls base; onCancel reverts to base.","runOutput":"npm run build ✓ (index-BR68v2y-.js). npm test → 5 files, 41 passed. Regression fix per host (\"recorded audio, it just disappeared / liked the old one that transcribes as I speak\"): transcript now streams live into the composer as spoken, nothing lost on odd end; discard reverts. Pure web — deploy-web (tip 2662224).","exitCode":0},"submittedAt":1783996516854},{"id":"T-60","title":"Restore Claude/Codex room connectivity and durable reconnection workflow","state":"in_progress","createdBy":"ProdMgr-Codex","owner":"ProdMgr-Codex","ownerClient":"cc","verifier":"Waqas","verifierClient":"web","dod":"Identify why Codex and both Claude clients stopped listening (distinguish app/process restart, usage-limit pause, MCP listener loss, and stale sessions); restore the Claude app/CLI agents to current keyed room participants without duplicate identities or auth weakening; verify each active agent can receive and send a fresh room message; clean only demonstrably stale local sessions without losing work; add a concise operator runbook plus a reliable reconnect/health-check design that surfaces disconnected/paused/usage-limited states and gives explicit user steps only when human action is genuinely required. Preserve strict member-key auth and current room history.","createdAt":1784052792603,"claimedAt":1784052801020},{"id":"T-61","title":"App-wide legibility floor (no more 9-11px panels)","state":"todo","createdBy":"Frontend-Claude (2)","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Host: \"why so tiny content? one of you has an obsession with tiny text.\" Chat got the legibility bump but panels (Inspector tabs People/Project/Outputs/Room, room list) were still 9-12px. Clamp the type utilities themselves rather than chasing call sites: text-[9/10/11px] floor to 12px desktop; on phones (<640px) labels floor to 13px and text-xs/12px body floors to 14px. `text-fixed` opts out where size is load-bearing (avatar initials). Deployed as index-C5K6eGeG.js (main 2e3d47f). Build + 48/48 green.","createdAt":1784054465155},{"id":"T-62","title":"Unread counts + true last-update on the rooms screen","state":"todo","createdBy":"Frontend-Claude (2)","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Host: \"this screen should have last update and number of unread messages (that I haven't opened).\" (a) Home card aged off createdAt (room's birthday, not last update) → now uses lastActivityAt, which the server already sent but RoomSummary never declared. (b) Unread badge on Home + desktop room list, denominated in the server's ABSOLUTE message counter (survives LTRIM; retained-list length would under-count). useRoom now surfaces messageTotal; room marks read only while parked at the bottom, so scrolled-up reading correctly leaves messages unread. No marker = seed to read (avoids a false \"59 unread\" on rooms already read). Read state is per-device (localStorage); cross-device needs a server-side per-identity marker. Deployed index-C5K6eGeG.js (main 970d26a). 48/48 green, 7 new tests.","createdAt":1784054473740},{"id":"T-63","title":"Single-row composer (Teams-style), stop wasting the bottom of the screen","state":"todo","createdBy":"Frontend-Claude (2)","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Host: \"this persistent big panel across the bottom ... you are wasting so much space; notice how Teams does it.\" Composer was three permanent stacked rows (Ask-your-agents chips / input / a separate row for attach+mic+expand+Send). Now one row: tools inline inside the input's right edge, Send is an icon not a labelled slab, and chips show only while the draft is empty (vanish on typing). ~130px of permanent chrome → ~56px. Controls stay 44px (tap targets), win comes from deleting rows not shrinking buttons. Deployed index-C5K6eGeG.js (main 23699f5). 48/48 green.","createdAt":1784054483172},{"id":"T-64","title":"Desktop tabs are peers of the chat, not a side column","state":"todo","createdBy":"Frontend-Claude (2)","owner":"Frontend-Claude","ownerClient":"cc","verifier":"ProdMgr-Codex","verifierClient":"cc","dod":"Host: \"instead of a sidebar with tabs, can you make all tabs peers of the chat, so there's more space.\" People/Project/Outputs/Room lived in a permanent 320px right column, squeezing the conversation between the room list and the inspector. Now peers of Chat in one tab strip under the room header; selected tab owns the full pane, Chat gets full width back. Desktop only — phone keeps the slide-over sheet, and the header's inspector toggle is now mobile-only (on desktop it would open a sheet that no longer exists). Deployed index-C5K6eGeG.js (main ed54e21). 48/48 green.","createdAt":1784054491566}]}}
```
wakichat:state:end -->
<!-- wakichat:tasks:end -->
