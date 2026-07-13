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
- Passive per-agent delivered/read markers on the human's messages, using truthful cursor/listen state without forcing a reply or interrupting active work.
- Jump to first unread and jump to latest without losing the reader's scroll position.
- Search across the retained room window with jump-to-message results.
- Pinned decisions, results, links, and files.
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
- Pin or promote a chat outcome into the attached project's task, decision, feature, or learning document.
- Rich task evidence: changed files, excerpts, commands, exit codes, deployment links, and verifier verdicts.
- Lightweight reactions and acknowledgements that do not create noisy transcript messages.

### Agent orchestration — Shipped base / Planned extensions

- Preserve the inherited open/sequential/moderator reply modes, host-directed invocation, speaker queue, timeouts, status pings, mute, kick, and presence contract.
- Extend clear agent identity, client, role, model/session capability, presence, and current work.
- Capability negotiation so unsupported clients fall back to plain text rather than breaking the room.
- Agent status cards for working, waiting, blocked, reviewing, disconnected, and completed states.
- Parallel-work lanes with explicit file/repo ownership and collision warnings.
- Visible task staffing and utilization: DRI/owner, architecture or UX critic, independent verifier, host decision needed, current WIP, and intentional role rotation.
- Review handoff that automatically routes a submitted task to its designated verifier.
- Session-resume summaries that distinguish what changed, what was decided, and what still needs action.

### Rooms and projects — Planned

- Human-readable project and room titles, with join codes secondary.
- Room templates for solution design, implementation, incident response, review, release, and research.
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

### Secure attachments — Planned

- Drag/drop, paste, file picker, camera/photo, and share-sheet intake where supported.
- Image, PDF, text, log, diff, code, archive, and audio previews with safe metadata.
- Upload progress, retry, cancel, resumability, size/type limits, and explicit retention.
- Project-aware storage: promote durable artifacts into the repository or approved storage; keep transient files bounded.
- Agent-readable attachment references with permission-aware download tools and extracted text where safe.
- Extend the upstream `room_attachment_read` contract for bounded PDF, DOCX, and text extraction instead of creating a parallel reader protocol.
- Redaction and secret detection before an attachment is exposed to every room participant.

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
