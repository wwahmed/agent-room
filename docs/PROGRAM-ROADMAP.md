# WakiChat canonical program roadmap

Status: **DRAFT FOR HOST REVIEW — work freeze active; no implementation authorized**

This roadmap replaces the accidental sequence of component tickets with six
user-outcome programs. Historical tasks remain evidence. Once this roadmap is
approved, every non-done task is absorbed by exactly one program and ceases to
compete as an independent source of priority.

## Operating constraints

1. The host approves this roadmap before implementation resumes.
2. One active implementation slice per builder; one release candidate total.
3. Every slice names three distinct roles: builder, UX reviewer, independent
   verifier. A person cannot approve their own work or their own walkthrough.
4. No UI candidate reaches live before Program 1 provides immutable staging,
   a mechanical gate, a complete primary-surface walkthrough receipt, and an
   independently authenticated approval for the exact artifact.
5. Planning/specification may run during the freeze. Code, deploys, promotions,
   task submissions, verdicts, and governance watcher posts may not.
6. A host-found primary-screen defect freezes its program, opens an incident,
   identifies the failed fixture/reviewer step, and becomes a permanent
   regression before the program resumes.
7. “Superseded” preserves evidence. Until the board gains a superseded state,
   this artifact is the canonical absorption map; old tasks are not deleted.
8. Release/incident debt is a typed register with owner, blocking scope,
   creation trigger, clearing evidence, and age. Hotfix debt blocks all feature
   promotion; it cannot be represented by an easy-to-ignore local marker.
9. Board-truth sweeps run when a freeze lifts, at every role handoff, before
   every release candidate, after every incident, and at each program exit.
   The named program verifier owns the sweep; automation reminds silently in
   quiet mode and posts one digest only when quiet mode ends.

## Dependency order

```text
Host approves roadmap
        |
        v
1. Release Safety & Quality Governance
        |
        v
2. Identity & People
        |
        +----------------------+
        v                      v
3. Architecture V2         4. Phone Reliability
   (spec starts now)           (physical QA required)
        |
        v
6. Performance & Data Truth
        |
        v
5. Desktop Workspace
```

Program 6 may prepare read-only analysis earlier, but no product change bypasses
Entry Gates 1–2 or the approved V2 data contract. Because Claude currently
fills five proposed builder roles, implementation is strictly serial despite
the conceptual branch after Gate 2. Program 4 phone validation and Programs
3/5/6 design work may overlap only as non-mutating analysis; there remains one
release candidate total.

## Entry Gate 1 — Release Safety & Quality Governance

**Priority:** P0, first implementation program  
**Outcome:** Waqas is never the first person to discover a primary-screen
regression, and the bytes reviewed are the bytes promoted.  
**Proposed builder / reviewer / verifier:** ReleaseSystemsBuilder (Claude) /
Master UX Lead (Codex UX Reviewer) / RoomSystemsVerifier (UX-Adversary)  
**Absorbs:** T-61, T-63, T-86, T-87, T-89, T-93.

Entry: host approves this roadmap; current live artifact is captured by digest;
no feature candidate is in flight.

Smallest safe first slice: immutable full-SHA artifacts, versioned release
directories, durable non-production preview, atomic pointer promotion, and a
rollback/roll-forward drill using the current live bytes. No new UI and no
approval semantics in this first slice.

Exit:

- isolated staging data and durable preview;
- machine-readable touched-state manifest and complete interactive fixtures;
- semantic geometry + visual gate with deliberately broken regression proofs;
- real-user walkthrough receipt from `docs/PRIMARY-SURFACE-WALKTHROUGH.md`;
- full artifact/manifest/frame/gate digests and authenticated builder !=
  reviewer != verifier enforcement;
- narrow named-incident lane, automatic post-hotfix gate, feature freeze debt;
- versioned atomic promotion and proven rollback;
- quiet, classified quality ledger events with deterministic tests.

Host checkpoint: approve the pipeline architecture and rollback drill before it
is allowed to promote a product change.

## Entry Gate 2 — Identity, Presence & People Control Plane

**Priority:** P0, second implementation program  
**Outcome:** one real participant has one stable lineage; people can address,
manage, rename, recover, and audit the exact participant they intend.  
**Proposed builder / reviewer / verifier:** IdentitySystemsBuilder (Claude) /
Master UX Lead (Codex UX Reviewer) / RoomSystemsVerifier (UX-Adversary).  
**Absorbs:** T-06, T-09, T-17, T-18, T-20, T-25, T-33, T-49, T-50, T-51,
T-52, T-54, T-66, T-91, T-92.

Entry: Program 1 stages immutable artifacts; protocol/schema and migration
dry-run approved; no destructive cleanup authorized.

Smallest safe first slice: add opaque participant/session/lineage IDs and
propagate them read-only through join, room state, messages, and task views.
Do not merge, rename, or delete existing rows in this slice.

Exit:

- enforced role/provider join negotiation and names like
  `ReleaseCodeReviewer (Codex)`;
- exact reclaim, graceful leave, stale/offline/replacement semantics;
- structured stable-ID mentions, notifications, tasks, direct invoke, replies;
- editable role/display label without breaking provenance;
- visible audit of role/name/lifecycle changes and People control plane;
- safe quarantine/reconciliation of this room's duplicates, never by name;
- fixture agents/data isolated from human work views;
- this room migrated without losing task, message, or mention history.

Host checkpoints: approve protocol and dry-run; approve proposed migration rows;
approve cleanup only after rollback is demonstrated.

## Design Gate 3 — Collaboration Architecture V2, RoomOS & Owner Artifacts

**Priority:** P0 architecture specification now, additive implementation after
Entry Gate 2 identity primitives

**Outcome:** rooms are durable, typed collaboration environments—not chats plus
a flat task list—and existing V1 rooms continue working throughout migration.
**Proposed designer / reviewer / verifier:** RoomSystemsDesigner
(UX-Adversary) / Master UX Lead / ProductSystemsAdvisor (to be admitted only
after the identity dry-run). Implementation builder is assigned at the approved
design boundary, never inferred from an old display-name owner.  
**Absorbs:** T-05, T-19, T-29, T-37, T-43, T-94, plus the T-97 V2 architecture
epic created from the upstream review.

Entry: T-94 north star approved; canonical participant and permission model
available; owner privacy model reviewed; named ProductSystemsAdvisor admitted
as the third seat before implementation starts.

Boundary: T-94 owns reusable semantics, schemas, templates, and rituals; T-92
owns enforcement in roster, server, MCP/web join, mentions, tasks, and People.
Neither may redefine the other's identity model.

Smallest safe first slice: schemas and a read-only V2 projection beside V1—no
room mutation. Versioned Room Brief plus Owner Interview/Survey artifacts build
on the existing Questions primitive; no autonomous planning mutations.

Exit:

- room charter, success measures, role roster, working agreements, WIP policy;
- explicit distinction between room type, versioned template, enabled modules,
  and lifecycle state; types are composable presets, not hard-coded schemas;
- program/epic/task hierarchy with priority/dependency/supersession semantics;
- project hierarchy supports Goal → Theme → Epic → Task without requiring every
  room to instantiate every level;
- decision, risk, research, critique, QA, release, incident, handoff, and
  retrospective artifacts with permissions/history/export/retention;
- private owner answers and explicit publishable summaries;
- templates for product build, greenfield, incident, design review, research,
  and ongoing operations rooms;
- classified governance automation with a room-level quiet mode so planning
  and bookkeeping never produce scoreboard/status spam;
- migration of this room proves the system handles tonight's fragmentation,
  paper approvals, identity ambiguity, fixture pollution, and missed reviews.
- V1/V2 dual-read compatibility, idempotent per-room migration plan, explicit
  type/template migration, reversible cutover, and old-client contract tests.

Host checkpoint: approve the information architecture, example interview, and
example room dashboard before implementation.

## Program 4 — Phone Reliability, Reading & Capture

**Priority:** P1 after Programs 1 and staffing checkpoint  
**Outcome:** on a physical phone, reading space is humane and every compose,
attachment, and voice flow remains reachable and sendable.  
**Proposed builder / reviewer / verifier:** PhoneExperienceBuilder (Claude) /
Master UX Lead / PhysicalDeviceQA.  
**Absorbs:** T-08, T-62, T-70, T-73, T-76, T-77, T-79, T-80, T-82, T-84,
T-85.

Entry: Program 1 complete; physical-device role present; frozen candidate is
rebased into an immutable release without unrelated changes.

Smallest safe first slice: do not add features. Run the frozen phone candidate
through the complete gate and physical Android/iPhone walkthrough; convert all
real failures—including 24px/32px targets and floating collisions—into blockers.

Exit:

- contextual chrome and final-message clearance across real viewport changes;
- 52–60px resting composer, >=68% inner-width field, measured dynamic stack;
- attachment dialog/chip/progress/error/retry and truthful one-tap capture;
- 40-second dictation, stop/cancel/edit/send, keyboard/orientation, no beeps;
- light/dark, 390/430/short height, Android and iPhone evidence;
- no geometry, occlusion, accessibility, or whole-frame walkthrough findings.

Host checkpoint: approve only after the physical-device tester signs; Waqas is
not the routine tester, though host confirmation remains welcome.

## Program 5 — Desktop Workspace & Navigation

**Priority:** P1 after Gates 1–3 and Program 6's performance/data contract;
follows the phone release candidate

**Outcome:** desktop behaves like a calm, continuous, resizable workspace—not a
web page that remounts, wastes space, and exposes test debris.  
**Proposed builder / reviewer / verifier:** DesktopExperienceBuilder (Claude) /
Master UX Lead / ProductSystemsAdvisor, with UX-Adversary auditing the receipt.  
**Absorbs:** T-11, T-24, T-30, T-38, T-39, T-45, T-46, T-53, T-60, T-64,
T-65, T-67, T-68, T-71, T-81, T-88, T-90.

Entry: immutable staging and identity-aware People model exist; V2 shell/data
contract and Program 6 budgets approved; north-star full-frame designs approved
at compact desktop 981/1024 plus 1280/1440/2032 before implementation.

Smallest safe first slice: T-90 shell persistence. Remove the keyed room
remount only after `useRoom` has code-keyed cancellation/reinitialization and a
regression for the original end-room/create-room stale-state bug. No restyle in
the same slice.

Exit:

- incremental room switching preserves shell, rail, scroll, pane, focus, cache;
- global, session-rare actions (New room, Join, Install) live in header/nav or
  account chrome instead of consuming the prime Home canvas; Home uses desktop
  width for current work, attention, and useful context rather than centering a
  phone-width column in an empty field;
- 56–64px progressive composer; contextual tools and bounded expansion;
- accessible persisted rail/context resizing and intentional surplus width;
- grouped real rooms, fixture tenancy hidden, virtualized 100+ room behavior;
- theme-aware accessible scrollbars, refined message/action/reply/media objects;
- cohesive tokens and primary tabs without residual/superseded UI layers;
- complete 981/1024/1280/1440/2032, 125%/150%, keyboard and five-minute
  walkthrough.

Host checkpoint: approve full-frame north-star designs and a working shell-only
slice before the visual rebuild continues.

## Program 6 — Performance, Data Truth, Findability & Scale

**Priority:** P1 architecture/performance foundation before Program 5; read-only
profiling may start during the freeze

**Outcome:** users can find the right room and trust counts, activity, sorting,
history boundaries, and account controls without refreshing, while long rooms
stay fast and memory-bounded.
**Proposed builder / reviewer / verifier:** DataTruthBuilder (Claude) / Master
UX Lead / RoomSystemsVerifier (UX-Adversary).  
**Absorbs:** T-15, T-23, T-26, T-27, T-75.

Entry: Entry Gates 1–2 complete; Design Gate 3 defines V2 query boundaries;
Home/rail information architecture is approved; T-26/T-27 disposition is
reconciled with completed T-78.

Smallest safe first slice: instrument current room bootstrap, tab payloads,
count/activity staleness, retained DOM nodes, heap growth across room switches,
and room-list load behavior without changing UI; publish measured budgets and a
data-flow/cache/eviction contract.

Exit:

- live count/activity/unread truth without full refresh;
- counts, tabs, filters, and summaries exclude hidden fixture tenancy by the
  same predicate as the visible list—never “Active 19” beside four real rooms
  and “15 test rooms hidden”;
- bounded, virtualized, searchable 100+ room list with stable grouping/sorting;
- room bootstrap returns bounded summaries/cursors rather than whole domains;
  tabs, artifact bodies, attachment bodies, People history, and Project trees
  load on demand with cancellable keyset pagination;
- message/feed virtualization retains scroll-anchor measurements while evicting
  off-window DOM and heavy entities; room switches abort stale requests and
  evict previous-room payloads under an explicit LRU/TTL budget;
- metadata/thumbnail-first attachments and artifacts; idle prefetch is bounded,
  cancellable, and measured rather than unconditional;
- performance budgets cover bootstrap bytes/time, room-switch latency, maximum
  rendered nodes, network duplication, and heap growth across 20 switches;
- explicit all-caught-up/history-boundary semantics;
- one canonical account/sort surface, not duplicate T-26/T-27 variants;
- slow/error/offline behavior and accessible keyboard navigation verified.

Host checkpoint: approve measured performance budgets and the V2 query/cache
contract before implementation; approve final truth/performance evidence before
Program 5 desktop work begins.

## Awaiting-review truth sweep

After roadmap approval and before implementation, reviewers perform a
no-code disposition sweep:

- likely superseded into canonical programs: T-18, T-25, T-26, T-27, T-30,
  T-46, T-60, T-61, T-63, T-70, T-73;
- independently re-verify or reject on current evidence: T-20, T-29, T-37,
  T-80, T-87.

No task is accepted merely to reduce the queue. A still-useful isolated result
may be accepted only if its current evidence meets its original DoD and does
not conflict with the canonical program architecture.

## Staffing recommendation

Do not add participants before Program 2's naming/identity protocol prevents
more ambiguity. After the protocol dry-run, add exactly:

1. `PhysicalDeviceQA (<Provider>)`: Android + iPhone/device-lab execution,
   visualViewport/keyboard/voice/attachment evidence, independent of builders.
2. `ProductSystemsAdvisor (<Provider>)`: room information architecture,
   accessibility, desktop first-person review, and T-94/T-88 north-star advice.

Do not add another general builder yet. Reassess only after two program slices
show a genuine throughput bottleneck rather than a quality/rework bottleneck.

## Owner decision points

1. Approve or revise the six-program grouping and dependency order.
2. Approve the strict one-candidate WIP limit.
3. Approve the two specialist roles after identity protocol dry-run.
4. Approve each program's first slice before it starts.
5. Explicitly unfreeze implementation; silence is not authorization.
6. Approve V2 additive architecture and migration boundaries before any V2
   write path is built.

## Collaborative record

- Claude proposed release discipline first, identity second, frozen phone then
  desktop, data truth, and reusable room mechanics; supplied the absorption map
  and immutable-artifact first slice.
- UX-Adversary required explicit builder/reviewer/verifier separation, release
  and identity roots before surface work, board-truth sweep, isolated fixtures,
  physical-device QA, and permanent desktop adversarial pressure.
- Codex identity/data proposal: unavailable because no `Codex` participant is
  currently present; its many board assignments are stale ownership, which is
  itself evidence for Entry Gate 2. The Lead supplied the identity/data map
  from source and board evidence rather than silently impersonating that role.
- Lead reconciliation: data analysis may prepare early, but no product change
  interleaves ahead of release governance; a second general builder is deferred
  in favor of device QA and product-systems review.
- UX-Adversary's RoomOS v0.1 at `docs/room-os/SPEC.md` defines thirteen core
  objects and the spec/enforcement boundary. Its critique is adopted: Gates 1
  and 2 are entry gates, board hygiene has fixed event cadence, WIP is explicit,
  and release/incident debt is a first-class blocking register.
