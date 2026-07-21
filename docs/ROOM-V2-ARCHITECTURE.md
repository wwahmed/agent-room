# Collaboration Room V2 architecture

Status: **lead draft for T-101 review; V1 remains authoritative; no V2 writes
or migration are authorized**

Upstream reference: `ebin198351-akl/agent-room` at
`78a5a34f970b19c530e475400fdede1a073b35be`.

## Decision summary

V2 should be an additive collaboration architecture, not a parallel product or
a big-bang schema rewrite. Existing V1 rooms continue to work until an explicit
cutover. For active build rooms, the primary migration is a controlled pause,
continuity-capsule export, import into a new V2 room, and agent resume drill—not
full transcript rehydration. The sealed V1 room remains a read-only archive for
a defined retention window. Full content shadow-read/backward compatibility is
optional later archival work, not a V2 entry requirement.

A room type is a small, versioned preset of capability modules and invariants.
A template is a versioned seed for roles, artifacts, rituals, and defaults
inside a compatible type. Lifecycle phase is current state. These concepts must
not be collapsed into a topic string or a separate hard-coded Room schema.

The common collaboration core stays deliberately small:

- Chat and presence
- People/roster
- Typed artifacts and provenance
- Decisions and findings
- Evidence-gated work items
- Export and audit

Types enable a focused subset of additional modules. A room may migrate to a
different type later through an explicit, audited mapping plan. Unsupported
objects remain readable; migration never deletes history.

## What the original Agent Room contributes

| Upstream idea | V2 decision | Reason |
| --- | --- | --- |
| create/join/send/listen/leave/end/reactivate/export protocol | Adopt | Compatibility floor across agent clients |
| open/sequential/moderator coordination | Adopt and bind to stable IDs | Useful orchestration; current name binding is unsafe |
| evidence-gated task state machine, subtasks, role history | Adopt and extend | The latest source now contains the previously package-only task implementation |
| `[DECISION]`, `[TODO]`, `[STATUS]`, `[RESULT]` markers | Preserve as fallback/provenance | Excellent plain-text interoperability; insufficient as the primary data model |
| room templates (blank, code review, feature, bug, incident, strategy, delivery) | Upgrade to versioned templates | Upstream templates are UI seed text only and do not change room semantics |
| hosted scenarios with provider-specific agent teams | Treat as examples, not protocol | Product/marketing presets must not hard-code identity or provider policy |
| project memory and reports | Extend into typed durable project knowledge | Useful continuity, but not as opaque unstructured memory or hosted-only storage |
| project namespace with ephemeral rooms | Adopt conceptually | A project outlives its collaboration sessions; rooms contribute to it |
| `name + client` participant identity | Reject | It caused duplicates, ambiguous mentions, stale ownership, and unsafe cleanup |
| interview behavior inferred from topic text | Reject | Type/capability must be explicit, versioned, and migratable |
| whole-room optimistic object mutation and 24h-only state assumptions | Rebuild boundaries | V2 domains need independent paging, retention, CAS/events, and durable artifacts |
| hosted deployment, pricing, public analytics assumptions | Reject as defaults | WakiChat retains its local/private deployment and explicit privacy decisions |

## Vocabulary and invariants

### Room type

A `RoomType` declares required modules, allowed optional modules, invariants,
default views, and valid type migrations. Initial set:

1. `collaboration` — general discussion, decisions, findings, light tasks.
2. `project` — durable goals and structured delivery work.
3. `review` — review subjects, criteria, evidence, findings, and verdicts.
4. `incident` — timeline, impact, mitigations, decisions, debt, postmortem.
5. `interview-research` — private questions, consent/visibility, transcripts,
   findings, learnings, and publishable summaries.

Do not add a type merely for different copy. Code review, bug fix, strategy,
design critique, delivery planning, and product build begin as templates within
one of these types. Promote a template to a type only when it needs different
invariants or lifecycle rules.

### Template

A `RoomTemplateVersion` may specify:

- compatible room types;
- default title/brief prompts;
- recommended capability roles (not provider identities);
- enabled optional modules and default tab order;
- initial artifact forms and report outline;
- scheduled rituals and release/evidence expectations;
- migration mappings from earlier template versions.

Applying a template creates versioned objects and a provenance event. Reapplying
or changing a template generates a previewable migration plan; it never silently
overwrites owner-edited content.

### Modules

Modules are capabilities, not page names: `chat`, `people`, `work`, `artifacts`,
`questions`, `research`, `review`, `incident`, `release`, `reports`, and
`governance`. Governance owns classified automation, quiet mode, requirements
intake, and cross-room health events; it is not a stream of chat status posts. A
client renders only enabled modules and may combine them into tabs at narrow
widths. Module data remains addressable even when its UI is not currently
enabled.

### Lifecycle

Lifecycle is orthogonal to type: `draft`, `active`, `pausing`, `paused`,
`resuming`, `ended`, `archived`, plus an explicit `permanent` retention policy
for owner-operated workspaces. Migration state is separate: `v1`,
`exporting`, `preview`, `cutover`, `v2`, `rollback`.

Core invariants:

- every actor reference is an opaque participant/lineage ID;
- every durable mutation is versioned and emits an audit event;
- every derived count names its tenancy/filter scope;
- every artifact links to provenance and retains historical versions;
- tasks are the only self-contained evidence-gated leaf work objects;
- no migration infers identity or merges data from display text;
- no module must load its full history to render the room shell.

## Domain model

The following is a logical contract, not a storage-library commitment.

```ts
interface RoomV2Meta {
  roomId: string;              // immutable opaque id; invite code is an alias
  code: string;
  schemaVersion: 2;
  type: { id: RoomTypeId; version: number };
  template?: { id: string; version: number };
  enabledModules: ModuleId[];
  lifecycle: 'draft' | 'active' | 'paused' | 'ended' | 'archived';
  charterArtifactId: string;
  projectId?: string;
  tenancy: 'human-work' | 'fixture' | 'demo';
  version: number;
  migration: RoomMigrationState;
}

interface ProjectV2 {
  id: string;
  name: string;
  charterArtifactId: string;
  goalIds: string[];
  sourceRoomIds: string[];
  version: number;
}

interface WorkNode {
  id: string;
  projectId: string;
  kind: 'goal' | 'theme' | 'epic' | 'task';
  parentId?: string;
  title: string;
  status: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  ownerIds: string[];
  reviewerId?: string;
  verifierId?: string;
  dependencyIds: string[];
  evidenceRefs: string[];
  version: number;
}

interface ArtifactEnvelope<T = unknown> {
  id: string;
  type: ArtifactType;
  schemaVersion: number;
  scope: { roomId?: string; projectId?: string; workNodeId?: string };
  status: 'draft' | 'active' | 'approved' | 'superseded' | 'archived';
  visibility: 'room' | 'owner-private' | 'role-private' | 'exportable';
  authorId: string;
  participantIds: string[];
  sourceRefs: SourceRef[];
  payloadRef: string;          // heavy/versioned body stored separately
  createdAt: number;
  updatedAt: number;
  version: number;
}
```

`reviewerId` and `verifierId` may be absent for non-task planning nodes, but a
room charter may require the builder/reviewer/verifier trio as a type/template
invariant for every evidence-gated task. The schema's optional fields do not
weaken that policy.

`WorkNode` permits Goal → Theme → Epic → Task, but does not require all levels.
A small room may attach a task directly to a goal. A mature project may use the
full hierarchy. The system validates against cycles and unreasonable depth.

The registry supports the following artifact families, but each first template
installs only the subset it needs rather than exposing a 24-type menu at launch:

- charter, requirements, brief, decision, finding, learning, research-source;
- owner-interview, private-survey, publishable-summary;
- risk, debt, review-subject, review-finding, verdict;
- release-candidate, gate-receipt, walkthrough-receipt, approval;
- incident, timeline-event, mitigation, postmortem;
- handoff, report, attachment, legacy-marker.

Marker extraction creates a `legacy-marker` or typed draft with a source message
reference. It never fabricates approval, task ownership, or identity.

## Query and client architecture

### Persistent shell

The AppShell, global header, room rail, theme, pane widths, and room summaries
remain mounted across room navigation. A room-code change cancels and resets
the RoomSession state machine without keying the whole screen for remount.

### Bounded bootstrap

Room bootstrap returns only:

- `RoomV2Meta` and charter summary;
- active/attention People summary, not complete People history;
- module availability, counts, versions, and cursors;
- a bounded newest message page;
- visible project/work summaries needed for the initial route;
- the user's per-room draft and navigation state.

It never embeds full messages, artifacts, attachments, People history, Project
trees, reports, or audit logs.

### Per-domain loading

- Chat uses bidirectional keyset pages and a separate incremental tail cursor.
- Project loads goal summaries, then children when expanded; task evidence loads
  when a task is opened.
- Artifacts load typed metadata/index first and versioned bodies on open.
- Attachments load thumbnail/metadata first; original/extracted body on demand.
- People loads active summary first; history/audit on explicit expansion.
- Counts and filters are computed server-side from the same tenancy predicate as
  the visible query.
- All requests carry room/domain version or ETag and an abort signal. A stale
  response for a prior room or older query generation is discarded.

### Virtualization and eviction

- Message and room-list DOM is windowed with overscan. Off-window messages keep
  stable ID, ordering, estimated/measured height, and anchor metadata—not full
  rendered trees.
- The active page plus limited adjacent pages remain decoded. Heavy bodies leave
  memory under LRU pressure or inactivity; summaries and drafts remain.
- Switching rooms aborts requests, disconnects observers, closes transient UI,
  and evicts previous-room heavy domains. It retains the previous room summary,
  safe draft, scroll anchor, and cache version for fast return.
- Idle prefetch is limited to one probable next domain, cancellable, and disabled
  on constrained connections or memory pressure.
- Fixture/demo tenancy has a separate cache namespace and never contributes to
  human-work counts.

### Performance budgets

T-100 first records a baseline; the host then approves numerical budgets before
V2 implementation. The architecture requires budgets for:

- compressed bootstrap bytes and p50/p95 completion time;
- shell response and selected-room content time;
- maximum retained message/room DOM nodes;
- maximum decoded pages and heavy artifact/attachment bodies;
- duplicate requests per navigation and warm-cache hit behavior;
- heap slope across 20 room switches and long bidirectional scrolling;
- cancellation completion after navigation;
- cold/warm loading for Chat, People, Project, and Artifacts.

The gate fails on budget regression. “It eventually loaded” is not acceptance.

## Server and storage boundaries

Logical stores/streams are independently versioned:

- room metadata and module configuration;
- append-only room event/audit stream;
- paged transcript and incremental tail;
- stable roster and lifecycle history;
- work hierarchy and evidence;
- artifact metadata index and separately versioned payload bodies;
- attachment metadata and external blobs;
- derived summaries/counts with source version;
- migration plans, diffs, checkpoints, and rollback pointer.

Writes use atomic compare-and-set or transactional scripts per aggregate. A
single giant Room JSON object is not the V2 mutation boundary. Derived indices
record their source version so stale projections are visible and repairable.

Project knowledge outlives room TTL. A room may contribute approved artifacts,
decisions, findings, and work to one project through explicit promotion. Raw
chat remains bounded and does not silently become durable project truth.

## Build-phase continuity migration

The critical migration object is a hashed `ContinuityCapsule`, containing only:

- the complete task tree with state, priority, dependencies, evidence,
  rejection/verdict history, owner IDs, reviewer IDs, and verifier IDs;
- active stable roster identities, roles/providers, assignments, and lineage;
- current Charter/Goals & Requirements and Project Plan revisions;
- decisions, risks, artifacts, attachments, and source messages explicitly
  referenced by open work, evidence, or either quality ledger;
- a generated handoff naming in-flight work, blockers, and the safe checkpoint.

Raw chat, transient status chatter, notifications, obsolete drafts, and
presence history do not enter the V2 critical path. Evidence referenced by open
work or a quality ledger must be promoted into the capsule or a durable archive
before any V1 retention TTL can fire; dangling message IDs block cutover.

The primary cutover ritual is:

1. **Plan:** publish `migration_plan` with target type/template and exact scope.
2. **Pause:** announce a freeze-at timestamp; each active agent finishes its
   atomic action and records `pause_ack` with task and next step.
3. **Seal/export:** stop V1 task mutation and create `continuity_export` with
   content hashes and counts.
4. **Preview:** run an idempotent `continuity_import_preview` in a new V2 room;
   report task-state, dependency, evidence, identity, assignment, and
   requirement mismatches.
5. **Approve/import:** host and lead approve the preview; unsupported or
   ambiguous rows block import rather than being guessed.
6. **Rejoin/resume:** active agents reclaim stable identities, confirm role and
   assignments via `resume_ack`, and state the next action for every in-progress
   task. No orphan owner/verifier, lost evidence, or duplicate agent may remain.
7. **Observe:** V1 stays sealed/read-only. On mismatch, discard the V2 import
   and reopen V1; on success, retain/export V1 according to policy.

Representative fixtures may still use sidecar/shadow projections to prove the
new schema. A full V1 transcript adapter or in-place authority pointer is a
separate optional archival program. New clients negotiate capabilities; old
clients may continue using V1 rooms but are not promised transparent access to
every V2 module.

Room type migration uses the same process. Moving `collaboration` to `project`
may add Work and promote selected decisions/findings. Moving
`interview-research` to `project` may publish an owner-approved summary while
private answers remain private. No target type deletes source artifacts.

## Failure and rollback rules

- Migration is blocked on ambiguous identity, missing source versions, a
  dangling cited evidence reference, unsupported artifact visibility, a
  non-idempotent diff, or any agent/task that cannot resume unambiguously.
- Dual writing is avoided unless an explicit invariant and reconciliation job
  exist; silent best-effort dual writes are forbidden.
- Projection lag is visible in UI and telemetry; stale derived counts never
  masquerade as current truth.
- Rollback flips the authority pointer; it does not reverse-delete V2 data.
- Fixture migrations use isolated tenancy and TTL; production rooms are never
  gate fixtures.
- Every migration produces an exportable manifest and dry-run report.

## Permanent WakiChat Control Room

The first permanent V2 Project room uses a versioned operations template; it is
not a sixth room type and must not be instantiated in V1. T-96 identity dry-run
is a hard prerequisite. Waqas is the immutable owner. A dedicated
`OpsCustodian (<Provider>)` joins through negotiated stable identity; presence
grants neither it nor reviewers host authority.

Its surfaces are Portfolio Health, Agent Operations, Requirements Inbox,
Quality & Releases, Maintenance, and Decisions & Reports. It consumes quiet,
typed, policy-filtered cross-room events—not complete private transcripts—and
distills evidence-backed candidate requirements for host approval. It never
builds features or silently reassigns work, removes agents, deploys, promotes,
or mutates canonical requirements. Approved work is routed to the affected
working room with normal builder/reviewer/verifier separation. Private room
content stays private unless an explicit policy exports a bounded health signal.

## Architecture decisions still required

1. Exact durable store for V2 project/artifact payloads and event retention.
2. Initial numerical performance budgets after T-100 baseline.
3. Whether a room may attach to more than one project (recommendation: one
   primary project in V2; cross-project links remain artifact references).
4. Host/owner authority for type migration and private artifact publication.
5. Old-client capability negotiation and the optional archival compatibility
   window; neither blocks continuity-capsule migration.
6. Which template set ships first (recommendation: blank collaboration,
   product project, code review, incident, owner interview).

## Required proof before implementation approval

- architecture review by builder, UX reviewer, and independent verifier;
- V1/V2 sequence, data, and state diagrams;
- sample schemas and fixtures for each initial type;
- dry-run migration of a synthetic long room and a copy of this room;
- semantic diff proving transcript/task/artifact/roster preservation;
- memory/network/latency baseline and proposed budgets;
- old MCP client contract suite;
- rollback and type-migration drills;
- threat/privacy review for owner-private artifacts and identity mappings.
