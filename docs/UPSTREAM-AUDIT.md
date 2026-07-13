# WakiChat Upstream Framework Audit

Date: 2026-07-13

Board: T-20

Upstream: [`ebin198351-akl/agent-room`](https://github.com/ebin198351-akl/agent-room)

## Executive decision

WakiChat is a product fork of Agent Room, not a replacement protocol. Keep the upstream room lifecycle, multi-client MCP contract, presence model, reply modes, task verification model, attachment envelope, structured artifact syntax, reports, templates, and client-install/hook machinery wherever they remain sound. Extend them for WakiChat's project-backed workflow.

Do not inherit upstream deployment assumptions wholesale. WakiChat's dynamic app stays on the local Mac behind Cloudflare Tunnel and Cloudflare Access; the browser talks only to authenticated server APIs; repository Markdown holds durable project outcomes; chat history stays bounded. Hosted Agent Room project memory, direct browser-to-Upstash access, Vercel-centric deployment, analytics, pricing, and viral growth UI are not architectural defaults for WakiChat.

The most important immediate finding is a source/release mismatch: the fetched open-source repository ends at MCP `0.25.1`, while npm publishes `agent-room-mcp@0.25.4`. The newer package adds project attachment/memory fields, evidence-gated task tools, attachment text extraction, private/locked local state writes, and task-board guidance. WakiChat should selectively port or depend on those capabilities only after source parity, tests, and an explicit version pin are established.

## Provenance and divergence

Evidence gathered from the local checkout, a fresh upstream fetch, GitHub metadata, and npm package tarballs:

- Git remote `upstream` points to `https://github.com/ebin198351-akl/agent-room.git`.
- `upstream/main` is commit `34992456b1e8cac2ab9b66d82ef245335144f549`, committed 2026-06-14.
- That commit is the exact merge base of WakiChat `main`; at audit time WakiChat is 24 commits ahead and upstream is 0 commits ahead.
- The upstream repository is active, non-forked, and MIT licensed. Keep the upstream copyright/license notice with substantial reused code.
- Open-source `apps/mcp/package.json` reports `0.25.1`.
- npm `latest` reports `0.25.4`, published 2026-07-10 (`dist.shasum` `106e8c06e70d66b67b084f2b0fc084644e94cddb`). Its tarball adds `mammoth` and `unpdf`; package diff confirms capabilities not present in the fetched source tree.

Primary references:

- [Upstream README](https://github.com/ebin198351-akl/agent-room/blob/main/README.md)
- [Agent Room Protocol](https://github.com/ebin198351-akl/agent-room/blob/main/docs/AGENT_ROOM_PROTOCOL.md)
- [Known gaps](https://github.com/ebin198351-akl/agent-room/blob/main/docs/KNOWN-GAPS.md)
- [Published MCP package](https://www.npmjs.com/package/agent-room-mcp)
- WakiChat roadmap: [`../FEATURES.md`](../FEATURES.md)
- Focused room-template audit: [`ROOM-TEMPLATE-AUDIT.md`](ROOM-TEMPLATE-AUDIT.md)

## Decision vocabulary

- **Adopt** — preserve the upstream contract or implementation, then add regression coverage.
- **Extend** — keep the upstream primitive but add WakiChat-specific behavior or UI.
- **Rebuild** — preserve useful semantics while replacing an architecture that conflicts with WakiChat boundaries.
- **Skip** — intentionally do not carry the capability or product assumption forward.

## Capability decisions

| Upstream capability | Evidence / current behavior | Decision | WakiChat action |
| --- | --- | --- | --- |
| Cross-client MCP room lifecycle | Create, join, send, listen, list, leave, end, reactivate, minutes, export, watch/unwatch across Claude, Cursor, Codex, Gemini, and compatible MCP clients | **Adopt** | Treat these operations as the compatibility floor. Add contract tests whenever server transport changes. |
| Persistent listen contract and harness-aware timeouts | `listenAfterJoin`, long polling, Stop/session hooks, client-specific timeout handling, durable cursor state | **Adopt + harden** | Preserve the no-nudge listening loop. Test resume, timeout, kicked/ended cleanup, duplicate state files, and client upgrades. |
| Presence and moderation | Listening/online/idle/disconnected states; mute, kick, host controls | **Adopt** | Keep as shipped foundation. Extend with truthful passive read markers and clearer working/waiting/reviewing states. |
| Open, sequential, and moderator reply modes | Server-enforced speaker order, direct invoke, skip, role timeouts, non-turn-consuming status updates | **Extend** | Keep the protocol. Add staffing visibility, collision warnings, review routing, and project/task context rather than inventing a separate orchestration layer. |
| Evidence-gated task board | npm `0.25.4` adds create/claim/submit/verify/list with distinct owner/verifier and required evidence | **Adopt protocol; extend storage** | Retain the state machine and verifier rule. T-18 makes repository Markdown durable and the room board the fast synchronized view. |
| Project-backed room attachment and memory | npm `0.25.4` accepts `projectId` + `projectKey` and returns project prompt/memory context | **Rebuild storage; preserve compatibility** | Use server-approved project ids and compatible room metadata, but resolve to local allowlisted repositories and existing docs. Do not depend on hosted opaque memory as WakiChat's source of truth. Board: T-18. |
| Room templates and role presets | Upstream ships blank, code review, feature build, bug fix, incident, strategy, and delivery templates plus Facilitator/Researcher/Skeptic/Builder/Writer/QA roles | **Extend** | Reuse the data-driven template/role model. Add Waki-specific solution design, release, research, and project resume templates; allow project defaults without hard-coding agent brands. |
| Structured message markers | `[DECISION]`, `[TODO]`, `[STATUS]`, `[RESULT]` render in chat and extract into artifacts | **Extend** | Preserve as plain-text interoperability and graceful fallback. Promote marked outcomes into first-class project decisions/tasks/results with provenance; do not make markers the only structured-work interface. |
| Reports and Markdown export | Ended-room Save & Share, outcome board, evidence snippets, transcript anchors, Markdown export, report/OG endpoints | **Extend** | Keep source-linked reports. Add durable project handoff/ADR/release formats, authenticated export policy, bounded server-side paging, and explicit retention. |
| Attachments | Inline MCP/web upload envelope, bounded MIME/size list, R2 support; npm `0.25.4` adds `room_attachment_read` with PDF/DOCX/text extraction | **Extend + secure** | Reuse the envelope and reader contract. Add authz, retention/deletion, scanning, redaction/secret detection, upload recovery, project promotion, and extraction limits. |
| Browser voice composition | Web Speech API button accumulates final/interim text into the composer | **Extend** | T-10 adds long-form pause/resume/cancel/error recovery, draft-safe merge, mobile/background behavior, and accessibility. Do not replace it merely for novelty. |
| Poll cursor and reconnect fixes | Upstream history includes no-cache POSTs, server-counter anchoring, LTRIM cursor repair, focus catch-up, hidden-tab cadence, and optimistic send | **Adopt, then evolve** | Preserve these regression lessons. T-17 replaces full retained-window loads with bounded cursor pages and a separate incremental path. |
| Local MCP state hardening | npm `0.25.4` writes state mode `0600` and serializes updates through a lock directory | **Adopt after source parity** | Port with tests for concurrent processes, stale locks, atomic rename, file permissions, and crash recovery. Pin the MCP version rather than silently floating on npm latest. |
| Prompt chips that delegate to the user's agents | Upstream removed hosted draft AI and prefills "ask for minutes/reply" messages | **Adopt** | This respects user-selected agents and leaves output in the transcript. Extend with editable structured prompts and task/project context. |
| Direct browser-to-Upstash data path | Upstream web client historically imports the Redis REST client and deployment env | **Rebuild / prohibit** | T-12 already moved WakiChat to same-origin JSON APIs with credentials server-side. Never regress to browser Redis protocol or tokens. |
| Hosted/public Vercel product shell | Public Vercel app, public room semantics, GA/third-party assets, pricing/waitlist/viral report CTAs appeared across upstream history | **Skip as defaults** | Reuse isolated UX ideas only when they serve Waqas. Dynamic WakiChat remains local behind Cloudflare Tunnel + Access; analytics and external calls require a privacy decision. |
| Payments and commercial unlock flows | Upstream history contains Clerk, Stripe, Resend, and report-unlock work, later stripped from the open repo | **Skip** | Do not reintroduce billing or commercial growth mechanics without an explicit product decision and separate task. |

## High-value upstream gaps to carry forward

Upstream's own known-gaps document remains useful, but WakiChat should translate it into current architecture rather than copy the old fixes literally.

1. **Room mutation atomicity.** Upstream `casRoom` is a read-mutate-write retry loop, not a Redis transaction/Lua operation. Project binding, participant changes, and moderation make this more important now. Add an atomic compare-and-set primitive with concurrency tests.
2. **Source/package parity.** npm `0.25.4` is ahead of the public source checkout. Establish a documented update path: pinned version, source commit or audited tarball hash, changelog, compatibility tests, and a deliberate port/rebase decision.
3. **Task/project split-brain recovery.** Redis mutation plus asynchronous Markdown write can diverge. T-18 must make failure visible and recoverable, persist reconciliation state beyond room TTL, and avoid silent success when the durable ledger did not update.
4. **Attachment trust boundary.** Extraction is useful but expands attack surface. Enforce byte/page/text limits, timeouts, supported parsers, authorization, safe error messages, and no implicit execution of attachment contents.
5. **Room-code collision handling.** The 9-character space makes collision unlikely, but local durable projects raise the cost of misbinding. Prefer create-if-absent semantics rather than probabilistic overwrite.
6. **Typed tool dispatch and API schemas.** Replace broad `Record<string, any>` dispatch gradually with shared per-action schemas so browser, server, MCP package, and project sync cannot drift silently.
7. **Build-warning and dependency hygiene.** Resolve the mixed static/dynamic Toast import, pin runtime versions, and keep the npm workspace/install path deterministic. These are small, recurring sources of noise during production verification.

## Roadmap reconciliation

The audit changes priorities in four ways:

1. **T-18 should extend the upstream project/task contract, not invent an incompatible second model.** Local repository Markdown and server-side allowlists remain WakiChat-specific.
2. **Client reliability is product infrastructure.** MCP package pinning, installer/hook compatibility, locked private state, and resume tests belong in the reliability roadmap.
3. **Attachments already have useful upstream primitives.** Plan around secure extension and project promotion, not a ground-up upload protocol.
4. **Templates, role presets, structured markers, orchestration, and reports are inherited assets.** Preserve them and improve their WakiChat presentation before building parallel substitutes.

## Upgrade policy

For future upstream changes:

1. Fetch `upstream/main` and record the old/new upstream commits.
2. Compare upstream source, npm `latest`, npm tarball contents, license, and published dependency changes.
3. Classify each change with this audit's Adopt/Extend/Rebuild/Skip model.
4. Port small compatible fixes as isolated commits with upstream references; do not merge deployment/auth assumptions accidentally.
5. Run shared protocol, MCP tool-list, state/resume, auth, server, web, mobile-width, and production smoke tests.
6. Update this audit and `FEATURES.md` only when the product decision changes.
