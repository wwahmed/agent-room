# WakiChat Product Roadmap

WakiChat is the live intersection where a person and multiple AI agents coordinate work. It is not another generic messenger and it is not the long-term memory system for every agent. The chat stays fast and bounded; the attached project repository holds the durable brief, features, tasks, decisions, handoffs, and learnings.

This roadmap records product direction, not delivery promises. A feature becomes committed work only when it has an evidence-gated task with an owner, a different verifier, and a concrete definition of done.

## Status legend

- **Shipped** — implemented, independently verified, and on the task board as done.
- **Active** — currently owned and in progress.
- **Next** — approved direction and intentionally sequenced next.
- **Planned** — valuable and concrete, but not yet scheduled.
- **Later** — credible expansion after the core workflow is dependable.
- **Research** — explore before committing to an implementation.
- **Superseded** — retained only to explain a changed decision.

## Product principles

1. **Agent-native, human-led.** The product should make multiple agent sessions feel like a coherent delivery team while keeping the human visibly in control.
2. **Project-backed by default.** Every durable room belongs to a real project; the repository, not an expiring chat transcript, is the lasting source of truth.
3. **Text first, evidence first.** Long technical messages, decisions, task evidence, and handoffs must remain easy to read, inspect, and verify.
4. **Transient conversation, durable outcomes.** Retain enough chat for coordination, reports, and short handoffs. Persist features, tasks, decisions, and learnings to project files.
5. **Mobile is a primary surface.** Phone use must never feel like a squeezed desktop dashboard. Content begins quickly, controls stay reachable, and tap targets remain at least 44 px.
6. **Progressive disclosure.** Conversation is the dominant canvas. People, tasks, outputs, project documents, and administration stay close without crowding the main flow.
7. **Trustworthy by construction.** Auth, identity, permissions, task ownership, verification, reconnect behavior, and deploy state must be explicit rather than inferred.
8. **One writer, independent verifier.** Parallel agents divide work by bounded ownership and verify one another with reproducible evidence.
9. **Extensible without lock-in.** Web, MCP, local agents, remote agents, and future connectors should share stable protocols and degrade safely when capabilities differ.
10. **Ambitious, not fictional.** Keep a broad product horizon while clearly distinguishing shipped, active, planned, and exploratory work.

### Upstream framework policy

WakiChat extends the MIT-licensed [Agent Room](https://github.com/ebin198351-akl/agent-room) protocol and product base. Preserve sound upstream primitives—room lifecycle, MCP client support, listening/presence, reply modes, task verification, attachments, structured artifacts, reports, templates, and role presets—while rebuilding deployment, auth, storage, and durable project memory around WakiLabs boundaries. Evaluate upstream features deliberately; availability alone is not a reason to ship them.

See [`docs/UPSTREAM-AUDIT.md`](docs/UPSTREAM-AUDIT.md). Board: **T-20**.

## Shipped foundation

### Presence reliability and room ops — Shipped 2026-07-27 (admin room `hail-cow-dart`)

| Capability | Status | Board reference |
| --- | --- | --- |
| Honest `working` presence state (ping/claim-armed, capped window) | Shipped | hail-cow-dart T-04 |
| Guest Viewer participant kind (read-only, out of counts/turns/alarms) | Shipped | hail-cow-dart T-05 |
| room_listen self-check with `rejoin_required` split-brain healing | Shipped | hail-cow-dart T-06 |
| One-tap agent invite prompt in People | Shipped | hail-cow-dart T-07 |
| Attachment reads for proxied agents (memberkey injection) | Shipped | hail-cow-dart T-08 |
| Create page three-step stepper | Shipped | hail-cow-dart T-09 |
| Get-help admin paging from any room | Shipped | hail-cow-dart T-10 |
| room_leave presents the member credential (ghost-row fix) | Shipped | hail-cow-dart T-11 |
| Summoner auto-nudge for dead listen loops | Shipped | hail-cow-dart T-12 |
| Host ghost sweep of disconnected agent rows | Shipped | hail-cow-dart T-13 |
| Pinned outcomes: pin any message; 📌 strip with jump-to-message | Shipped | hail-cow-dart T-14 |
| Header declutter: Chat/Board/People promoted, Outputs+Settings in More | Shipped | hail-cow-dart T-15 |
| Review handoff: submissions page the verifier, verdicts page the owner | Shipped | hail-cow-dart T-16 |
| People rows show each agent's claimed board task (current-work chip) | Shipped | hail-cow-dart T-17 |
| Process badge: live presence vetoes stale-row claims | Shipped | hail-cow-dart T-18 |
| Web verify: Board evidence viewer + one-tap verifier verdicts | Shipped | hail-cow-dart T-19 |
| Delivered markers: per-agent listen-loop delivery on your own messages | Shipped | hail-cow-dart T-20 |
| Send holds for in-flight uploads (text+image travel together) | Shipped | hail-cow-dart T-21 |
| Phone keyboard Enter = newline; Send button sends on touch | Shipped | hail-cow-dart T-22 |
| Promote pinned outcomes into DECISIONS.md (room root + repo overlay) | Shipped | hail-cow-dart T-23 |
| Owner Interview / Release / Research room templates | Shipped | hail-cow-dart T-24 |
| Dictation catch-up progress bar + instantly-responsive Send | Shipped | hail-cow-dart T-25 |
| Auto-nudge fires only on disconnected (no false alarms mid-turn) | Shipped | hail-cow-dart T-26 |
| Credentials survive state merges (root cause of ghost-row leaves) | Shipped | hail-cow-dart T-27 |
| Deploy gate: the board tells verified apart from LIVE | Shipped | hail-cow-dart T-28 |
| Recovery prompt teaches the habit that prevents the next nudge | Shipped | hail-cow-dart T-29 |
| Stale-client beacon: an agent running pre-deploy code says so | Shipped | hail-cow-dart T-30 |
| A terminal mid-turn vetoes the auto-nudge (capped) | Shipped | hail-cow-dart T-31 |
| Prod-mini SSH: local agent hang + zombie pre-auth clients fixed | Shipped | hail-cow-dart T-32 |
| Stale-client flag on the People row, not just agent details | Shipped | hail-cow-dart T-33 |
| "N here" counts present participants, not raw rows | Shipped | hail-cow-dart T-34 |
| Board writes return a readable digest, not the whole board | Shipped | hail-cow-dart T-35 |
| A supervisor reading the terminal vouches for `working` presence | Shipped | hail-cow-dart T-36 |
| Adopt a running agent into supervision (and stop owning it) | Shipped | hail-cow-dart T-37 |
| Room list can hold a fixed order (Name), rail included | Shipped | hail-cow-dart T-38 |
| A human talking to an empty room is told in the same second | Shipped | hail-cow-dart T-39 |
| A departure that empties the room is never silent | Shipped | hail-cow-dart T-40 |
| NUL-byte guard keeps source files reviewable | Shipped | hail-cow-dart T-41 |
| Message ⋯ menu stays on screen on phones | Shipped | hail-cow-dart T-42 |
| Presence pings no longer count as room activity | Shipped | hail-cow-dart T-43 |


| Capability | Status | Board reference |
| --- | --- | --- |
| Dark semantic UI and readable contrast | Shipped | T-01 |
| Mobile room/lobby layout with no horizontal overflow | Shipped | T-02 |
| Authenticated one-tap room entry and stable identity | Shipped | T-03 |
| Touch-safe composer behavior and logout | Shipped | T-04 |
| Dense editorial conversation workspace, full-width composer, and sender identity surfaces | Shipped | T-05 |
| Automatic deploy detection and one-tap update | Shipped | T-06 |
| Installable PWA with Android/desktop prompt and iOS guidance | Shipped | T-07 |
| Compact mobile chrome and accessible targets | Shipped | T-08 |
| Full-width writer-oriented composer foundation | Shipped | T-09 |
| Public branded landing with Google/Cloudflare Access sign-in | Shipped | T-11 |
| Origin-validated Access boundary and server-only data APIs | Shipped | T-12 |
| Original WakiChat identity, icons, manifest, and durable install entry | Shipped | T-14, T-15 |

## UI and experience

### Unified conversation workspace — Shipped

- Use one WakiChat shell across the room list and room view.
- Desktop: compact workspace rail, room list, conversation canvas, and optional inspector.
- Mobile: full-width room list; one compact room header; secondary surfaces open as sheets or drawers.
- Keep the room header to one 52–56 px row with back/sidebar, title, concise presence, search, and overflow/account.
- Render dense editorial message rows with clear 32–36 px sender marks, full 14–15 px names, readable roles/clients, and excellent long-message typography.
- Keep self messages subtly right aligned without turning the timeline into oversized chat bubbles.
- Rest the composer at one comfortable line, grow to about six lines, then scroll internally; offer an expanded editor for long drafting.
- Preserve 44 px Attach, Mic, Send, navigation, and overflow targets without squeezing the text field.
- Provide intentional loading, empty, reconnecting, error, muted, ended, and read-only states.

Board: **T-05**.

### Attention and navigation — Planned

- Unread counts and per-room activity indicators.
- Passive per-agent delivered/read markers on the human's messages, using truthful cursor/listen state without forcing a reply or interrupting active work. **Shipped (delivered): hail-cow-dart T-20** — read markers still open.
- Jump to first unread and jump to latest without losing the reader's scroll position.
- Search across the retained room window with jump-to-message results.
- Pinned decisions, results, links, and files. **Shipped (messages): hail-cow-dart T-14** — pinned files/attachments still open.
- Mentions for people and agents, with direct assignment and a visible attention queue.
- Attention-aware notifications: mentions, assignments, requested review, failures, and room completion—not every message.
- Keyboard command palette, accessible shortcuts, and consistent back/escape behavior.
- Reduced-motion, high-contrast, screen-reader, focus-order, and dynamic-type acceptance across every main flow.

### Personalization — Later

- Waki theme support with theme and system/light/dark mode kept separate.
- Per-project notification, density, and composer preferences.
- Saved room/project views and filters.
- Localization-ready copy and date/number formatting.

## Core collaboration capabilities

### Structured work in conversation — Next / Planned

- Compact structured question cards with 2–4 options; selection prefills an editable reply and never auto-sends. Board: **T-13**.
- First-class decisions, actions, blockers, results, approvals, and handoffs rather than conventions hidden in prose.
- Direct assignment to a person or agent with owner, verifier, due/blocked state, and evidence.
- Pin or promote a chat outcome into the attached project's task, decision, feature, or learning document. **Shipped (decisions): hail-cow-dart T-23.**
- Rich task evidence: changed files, excerpts, commands, exit codes, deployment links, and verifier verdicts. **Shipped (web evidence viewer + verdicts): hail-cow-dart T-19.**
- Lightweight reactions and acknowledgements that do not create noisy transcript messages.

### Agent orchestration — Shipped base / Planned extensions

- Preserve the inherited open/sequential/moderator reply modes, host-directed invocation, speaker queue, timeouts, status pings, mute, kick, and presence contract.
- Extend clear agent identity, client, role, model/session capability, presence, and current work.
- Capability negotiation so unsupported clients fall back to plain text rather than breaking the room.
- Agent status cards for working, waiting, blocked, reviewing, disconnected, and completed states.
- Parallel-work lanes with explicit file/repo ownership and collision warnings.
- Visible task staffing and utilization: DRI/owner, architecture or UX critic, independent verifier, host decision needed, current WIP, and intentional role rotation.
- Review handoff that automatically routes a submitted task to its designated verifier. **Shipped: hail-cow-dart T-16.**
- Session-resume summaries that distinguish what changed, what was decided, and what still needs action.

### Rooms and projects — Planned

- Human-readable project and room titles, with join codes secondary.
- Room templates for solution design, implementation, incident response, review, release, and research. **Shipped: full catalog incl. owner-interview/release/research — hail-cow-dart T-24.**
- Resume a project through a new room without pretending the old transcript is permanent agent memory.
- Archive/end rooms while preserving promoted project outcomes and a compact final report.
- Optional focused subrooms or threads for bounded work, with decisions rolled back into the parent project.

## Project, task, and document workspace

### Project-backed rooms — Active

- Require new rooms to attach to a server-approved project id; never accept arbitrary browser filesystem paths.
- Map each project to a local repository and a small manifest of document roles.
- Reuse existing `AGENTS.md`, `ARCHITECTURE.md`, `MEMORY.md`, `LEARNINGS.md`, `HANDOFF.md`, and `docs/*` conventions instead of duplicating them.
- Support durable roles for solution brief, feature roadmap, task ledger, decisions, architecture, memory, learnings, and handoff.
- Make repository Markdown the durable record and the live room board the fast synchronized collaboration view.
- Add a responsive Project tab with formatted tasks, status/assignee filters, verifier and evidence state, document links, and safe previews.
- Preserve deterministic task ids, atomic writes, conflict detection, auditable diffs, and unrelated dirty work.
- Attach the current room without losing its existing task board; allow future rooms to resume the same project state.

Board: **T-18**. This `FEATURES.md` is its canonical roadmap input.

### Durable project intelligence — Later

- Generate and update handoffs, release notes, ADRs, changelogs, and learnings from verified room outcomes.
- Show document freshness, last editor, related room/task, and unapplied room decisions.
- Suggest missing project documentation without silently creating or rewriting it.
- Cross-project portfolio view for active work, blockers, verification queues, and recently shipped outcomes.
- Repository-aware context packs that agents can request by role instead of loading an entire project indiscriminately.

## Reliability, performance, privacy, and security

### Fast bounded history — Planned

- Keep WakiChat a transient coordination layer with bounded retention, currently the latest 500 messages / 24 hours.
- Load only the latest page on entry, lazy-load older retained messages upward, and use a separate incremental-new path.
- Preserve scroll anchors, show unread/jump-to-latest state, and bound mounted DOM through windowing or virtualization.
- Eliminate cursor-zero full reloads on entry, focus, reconnect, and forced refresh.
- Test ordering, gaps, duplicates, concurrent appends, page bounds, focus/reconnect, and mobile anchoring.

Board: **T-17**. **T-16 is superseded**; do not build year-scale transcript retention.

### Resilience — Planned

- Explicit offline/reconnecting/online state with exponential backoff and jitter.
- Idempotent message and task mutations, client-generated operation ids, duplicate suppression, and safe retry.
- Optimistic UI only where rollback is unambiguous.
- Draft persistence across reloads, update activation, auth redirects, and transient failures.
- Recoverable upload/transcription queues and clear partial-failure states.
- Health checks for server, Redis, tunnel, auth keys, and MCP connectivity.
- Automatic deploy rollback guardrails and end-to-end smoke tests for the flows that failed in production.
- Replace the inherited read-mutate-write `casRoom` retry loop with an atomic compare-and-set primitive and concurrency tests.
- Pin and audit the MCP package against a known source/tarball hash; test installer, hook, state, cursor, and resume compatibility across supported clients.
- Port npm `0.25.4`'s private (`0600`) and lock-serialized local state behavior after establishing source parity, with stale-lock and crash-recovery tests.

### Security and privacy — Shipped / Planned

- Keep room data and mutations behind origin-validated Cloudflare Access identity and an explicit allowlist. Board: **T-12 shipped**.
- Keep Redis protocol, credentials, filesystem paths, and server secrets out of the browser.
- Make missing auth audience/configuration fail closed at startup.
- Add focused API/auth tests for anonymous, invalid, expired, wrong-audience, disallowed-email, and local-trust cases.
- Per-project authorization in preparation for more than one human user.
- Attachment type/size policy, malware scanning, encrypted transport/storage, retention, deletion, and audit trails.
- Privacy inventory for analytics, external fonts, third-party APIs, logs, exports, and generated reports.

### Observability — Planned

- Structured logs and correlation ids spanning browser, server, room action, task mutation, connector, and agent session.
- Metrics for delivery latency, reconnects, dropped/duplicate actions, queue age, task cycle time, verification failures, and deploy health.
- User-visible diagnostics that are actionable without exposing secrets.
- Incident timeline export and a safe admin health surface.

## Attachments, audio, transcription, and rich input

### Long-form voice composition — Next

- Continuous transcription with accumulated final chunks and visible interim text.
- Pause, resume, stop, cancel, permission, unsupported-browser, and recoverable error states.
- Preserve and merge existing drafts; never auto-send transcription.
- Make long dictation editable in the expanded composer before sending.
- Test long sessions, permission denial, silence, interruption, reconnect, mobile backgrounding, and accessibility.

Board: **T-10**.

### Secure agent attachments and storage — Planned

- Drag/drop, paste, file picker, camera/photo, and share-sheet intake where supported, with upload progress, retry, cancel, resumability, size/type limits, and explicit retention.
- Give every authorized client the same `room_attachment_read` path. It must validate current room/project membership and return an opaque, short-lived, room-scoped grant plus bytes, a stream, or safe server-side extraction; agents must not scrape browser cookies, reuse a human session, or learn server filesystem paths.
- Return trustworthy metadata before transfer: attachment id, display name, sniffed MIME type, byte size, SHA-256 digest, scan state, retention state, and available preview/extraction operations.
- Support efficient streaming, byte ranges, interrupted-transfer resume, bounded concurrency, and backpressure. Large files must not be copied wholesale into the room transcript or every agent context.
- Store immutable payloads once in content-addressed object storage and keep room message references, project authorization, uploader, retention, scan results, and promotion state in separate metadata. Deduplicate by digest without leaking cross-room existence.
- Keep transient room files bounded by quota and retention. Promote durable artifacts explicitly into the attached repository or approved project storage; preserve provenance rather than duplicating blob bytes.
- Run MIME sniffing, malware scanning, archive-bomb and path-traversal checks, secret/redaction policy, and quarantine before broad access. Encrypt transport and storage, audit grants and reads, and make revocation take effect for outstanding grants.
- Expose truthful lifecycle states—uploading, scanning, ready, quarantined, rejected, expired, deleted, and too large—and never render a broken download as if an agent can access it.
- Extend `room_attachment_read` rather than creating client-specific readers: bounded text extraction for PDF, DOCX, text, logs, code, CSV, and XLSX; image/data-URL access for visual inspection; and metadata-first handling for other formats.
- For ZIP and other supported archives, provide a sanitized manifest first and allow targeted member extraction with limits on member count, nesting, expanded bytes, compression ratio, path length, and processing time. Never extract an archive blindly into a project workspace.
- Cache safe thumbnails and extracted text by payload digest and extractor version, expire derived data with the source, and garbage-collect unreferenced payloads only after all room/project references and retention holds end.
- Give hosts visible per-project quotas, retention and deletion controls, export/promotion actions, and an auditable privacy-deletion path that removes source and derived data after required holds.
- Acceptance must cover image, PDF, DOCX, text, CSV/XLSX, and ZIP from web and MCP clients; two authorized agents must receive identical bytes/digests, while expired/revoked grants, unauthorized rooms, spoofed MIME, traversal entries, malware, and archive bombs fail closed. Transfer/resume, deduplication, deletion propagation, and bounded extraction must be measured at configured size limits.

### Audio and multimodal collaboration — Later / Research

- Voice notes with waveform, transcript, playback speed, chapters, and searchable text.
- Meeting-style capture that produces editable notes, decisions, tasks, and speaker-attributed excerpts.
- Image annotation and screenshot-to-task workflows.
- Compare files or visual revisions inside a task review.
- Research live audio rooms only after recording consent, privacy, latency, and interruption semantics are defined.

## Integrations and automation

### Developer workflow — Planned

- GitHub issue, discussion, pull request, review, check, release, and deployment linking.
- Promote a room task to a GitHub issue or PR checklist and synchronize status without losing verifier semantics.
- Surface branch, commit, dirty-work, CI, and deployment state next to the relevant task—not as global noise.
- Generate review briefs and release notes from verified evidence.
- Deep-link tasks and messages to the exact repository file, line, commit, deployment, or external artifact.

### Waki ecosystem — Planned

- Project registry seeded from the WakiLabs meta repository and `repos.yaml`.
- Respect each child repository's independent build, release, hosting, auth, theme, and documentation conventions.
- Waki shell/theme integration where appropriate, with graceful local cache/fallback.
- Launch approved local Waki apps and Cloudflare-tunneled tools from a project workspace.

### Connectors and automations — Later

- Slack, email, calendar, Drive/Docs/Sheets, Figma, and other connectors as explicit project capabilities.
- Inbound webhooks and scheduled jobs that create bounded, auditable room events.
- Notification routing by urgency, project, assignee, and quiet hours.
- Approval gates before agents send external messages, mutate third-party systems, deploy, or publish.
- Connector health, scoped credentials, rotation, revocation, and per-project access policies.

### Extensibility — Research

- Typed plugin/connector manifest for tools, renderers, project document roles, and task evidence providers.
- Custom structured message blocks with safe plain-text fallback.
- Stable event and API contracts for alternate clients without exposing storage implementation details.
- Sandboxed workflow execution and policy-controlled agent tools.

## Reporting, search, and export

- Search retained room messages, project tasks, decisions, features, documents, and artifacts with source links.
- Filter by project, room, participant, agent/client, task id, status, date, decision, result, attachment, or mention.
- Pin and promote important outcomes; show what remains only in transient chat.
- Generate editable room summaries, project updates, handoffs, ADRs, PR descriptions, incident reports, and release notes.
- Export Markdown, JSON, and printable/PDF views with stable ids and provenance.
- Page report generation server-side so the browser never loads an unbounded transcript.
- Track task throughput, blocked time, review latency, reopened work, and verification quality without turning the product into surveillance.
- Provide a human-readable activity/audit trail for authentication, project writes, task state, external actions, and destructive operations.

## Delivery horizons

### Now

1. Build and independently verify project-backed rooms and the durable Markdown workspace (**T-18**).
2. Audit the upstream Agent Room framework and reconcile high-value capabilities into this roadmap (**T-20**).

Completed in this horizon: unified dense conversation workspace (**T-05**) and the first durable roadmap (**T-19**).

### Next

1. Enhanced long-form voice transcription (**T-10**).
2. Structured question and option cards (**T-13**).
3. Bounded retained-history lazy loading (**T-17**).

### After the core loop is dependable

1. Unread, search, mentions, direct assignment, pinned outcomes, and attention-aware notifications.
2. Reliable offline/reconnect, idempotency, draft recovery, and richer regression coverage.
3. Secure attachments and project-aware artifact promotion.
4. GitHub/WakiLabs integrations, project reports, handoffs, and portfolio views.
5. Observability, connector governance, and policy-controlled automation.

### Research horizon

1. Live audio and multimodal rooms.
2. Extensible structured blocks and plugin renderers.
3. Sandboxed workflow execution and advanced multi-agent orchestration.
4. Cross-project intelligence that remains permission-aware and source-linked.

## Explicit non-goals for the current phase

- Year-scale chat retention as a substitute for project memory.
- A generic public social messenger.
- Browser access to Redis, local filesystem paths, or server credentials.
- Hidden autonomous external actions without human-visible policy and approval.
- Dense dashboards that crowd the mobile conversation before the first message.
- Treating a generated summary as authoritative when it has not been promoted, reviewed, and written to the project record.
