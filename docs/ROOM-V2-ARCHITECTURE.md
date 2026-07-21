# Collaboration Room V2 architecture

Status: **lead draft for T-101 review; V1 remains authoritative; no V2 writes
or migration are authorized**

Upstream reference: `ebin198351-akl/agent-room` at
`78a5a34f970b19c530e475400fdede1a073b35be`.

## Decision summary

V2 should be an additive collaboration architecture, not a parallel product or
a big-bang schema rewrite. Existing rooms and MCP clients continue to operate
through V1. V2 data lives beside V1, is projected and compared before cutover,
and becomes authoritative one room at a time through a reversible pointer.

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
`questions`, `research`, `review`, `incident`, `release`, `reports`. A client
renders only enabled modules and may combine them into tabs at narrow widths.
Module data remains addressable even when its UI is not currently enabled.

### Lifecycle

Lifecycle is orthogonal to type: `draft`, `active`, `paused`, `ended`,
`archived`. Migration state is separate: `v1`, `shadow`, `v2`, `rollback`.

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

`WorkNode` permits Goal → Theme → Epic → Task, but does not require all levels.
A small room may attach a task directly to a goal. A mature project may use the
full hierarchy. The system validates against cycles and unreasonable depth.

Initial artifact types:

- charter, brief, decision, finding, learning, research-source;
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

## Compatibility and migration

1. **Baseline:** record V1 behavior, payloads, performance, and all room codes.
2. **Sidecar:** create V2 metadata/projections only for isolated fixture rooms;
   V1 remains authoritative.
3. **Shadow read:** project a selected existing room into V2 read models and
   publish a semantic diff; no UI cutover.
4. **Owner preview:** show proposed type, template, modules, roster mapping,
   work hierarchy, artifacts, unresolved identities, and data-retention impact.
5. **Explicit migration:** run an idempotent per-room plan with checkpoints and
   content hashes. Ambiguous identities or unsupported data block cutover.
6. **Pointer cutover:** atomically select the V2 read model for that room while
   retaining V1 and the previous pointer for rollback.
7. **Compatibility adapter:** old MCP clients continue core lifecycle, chat,
   tasks, and export through V1-shaped responses backed by stable V2 IDs.
8. **Observe:** compare counts, transcript order, task states, artifacts,
   latency, and memory; rollback on mismatch.
9. **New-room default:** only after representative migrations pass may new rooms
   default to V2. Existing rooms remain opt-in until a retirement decision.

Room type migration uses the same process. Moving `collaboration` to `project`
may add Work and promote selected decisions/findings. Moving
`interview-research` to `project` may publish an owner-approved summary while
private answers remain private. No target type deletes source artifacts.

## Failure and rollback rules

- Migration is blocked on ambiguous identity, missing source versions,
  unsupported artifact visibility, or a non-idempotent diff.
- Dual writing is avoided unless an explicit invariant and reconciliation job
  exist; silent best-effort dual writes are forbidden.
- Projection lag is visible in UI and telemetry; stale derived counts never
  masquerade as current truth.
- Rollback flips the authority pointer; it does not reverse-delete V2 data.
- Fixture migrations use isolated tenancy and TTL; production rooms are never
  gate fixtures.
- Every migration produces an exportable manifest and dry-run report.

## Architecture decisions still required

1. Exact durable store for V2 project/artifact payloads and event retention.
2. Initial numerical performance budgets after T-100 baseline.
3. Whether a room may attach to more than one project (recommendation: one
   primary project in V2; cross-project links remain artifact references).
4. Host/owner authority for type migration and private artifact publication.
5. Minimal old-client compatibility window and capability negotiation shape.
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
