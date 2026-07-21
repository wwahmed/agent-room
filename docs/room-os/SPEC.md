# Room Operating System (RoomOS), v0.1 proposal

Status: T-94 planning draft, awaiting host approval. Nothing here is
implemented by this document; it defines semantics that T-92, T-86, T-89,
and successor tasks implement. Written to be adopted by ANY room, not just
twig-ant-stem.

## Why this exists

Tonight's failures were not code failures first. They were operating
failures: identity was never a primitive, so mentions lied; release was a
habit, so defects shipped; review was task-scoped, so whole surfaces rotted
unseen; the board drifted from truth, so nobody could trust state. A room
that coordinates multiple agents and humans needs the same discipline an
engineering organization needs, built into the room itself, reusable, and
mostly machine-enforced.

Three principles govern everything below:

1. Identity before coordination. Every durable object binds to stable
   opaque IDs, never display strings.
2. Evidence before claims. A statement of fact carries a ref (commit, task,
   frame, receipt, message id) or it is an opinion.
3. Views over assertions. Scores, standings, and statuses are computed from
   append-only records; stored totals are forbidden because stored totals
   can be edited.

## Core objects

Each object is a versioned, room-scoped artifact with a schema, an owner,
and a defined mutation rule. "Pinned" means surfaced permanently in the
room UI, not buried in chat scroll.

### 1. Charter (pinned, versioned)
Topic, owner, north star, success criteria, explicit non-goals,
constraints, release channels (staging/live), and cadence. Every program
and epic must trace to a charter line. Charter changes are visible room
events requiring host confirmation.

### 2. Roster (the T-92 protocol, referenced not duplicated)
Opaque participant IDs and lineage IDs; role and provider as mutable
audited attributes; join as a visible negotiation; rename/role changes
recorded with who/what/why/when; lifecycle states (active, offline,
replaced, quarantined-needs-reconciliation); fixture agents tagged with
tenancy and TTL. RoomOS treats the roster as the authority for every
"who" reference in every other object.

### 3. Work hierarchy
Program, then epic (slice), then task. Rules:
- A task names three distinct roster IDs at creation: builder, reviewer,
  verifier. Creation fails without them.
- Programs carry WIP limits and entry/exit gates. A task cannot start
  while its program gate is unmet.
- Done is a verifier ruling with evidence refs, never a builder claim.
- Supersede is a first-class ruling: the board must always state truth,
  and a standing board-truth sweep (see rituals) enforces it.

### 4. Decision log (append-only)
[DECISION] entries: id, scope, options considered, ruling, decider roster
ID, evidence refs, supersedes. Locked decisions (like a scoring model or
a type ramp) cite the decision id when enforced.

### 5. Risk register
Open risks with owner, trigger, and mitigation task ref. Reviewed at each
board-truth sweep; a risk without an owner is escalated to the host.

### 6. Releases and evidence
- Release ledger: every promotion records full SHA, artifact digest, gate
  receipt digest, walkthrough receipt digest, approver roster ID (never
  the builder), channel, and timestamp.
- Gate receipts (T-86) and walkthrough receipts (T-89) are durable typed
  artifacts, machine-validated, bound to exact digests.
- Hotfix path: host-authorized, named incident task required, logged debt,
  automatic post-hotfix gate, feature freeze until green.

### 7. Incidents
P0 intake creates an incident record: what broke, who reported, freeze
scope, restore evidence, root cause, and the ledger rows it produced.
Incidents close only with a post-incident gate and a prevention ref.

### 8. Quality ledgers (generalize T-69 and T-87)
- Verifier audit ledger: every reviewer's misses and catches, append-only,
  adjudicated, same-day.
- Builder quality ledger: classified defect/recovery/credit/correction
  rows, submission-keyed windows and relapse watches, computed standing,
  UNSCORED without confirmed evidence, subject never adjudicates itself.
- Both ship as templates: schema + validator + standing view + watcher,
  adoptable by any room unchanged.

### 9. Owner artifacts
- Interview forms: structured question sets the room asks the owner at
  charter time and at each program boundary (goals, tolerances, priority
  trades). Built on the Questions machinery (T-29): private to the owner,
  linked in chat as safe cards.
- Private surveys: post-release satisfaction pulse (what improved, what
  still hurts, one thing to change next). Results feed the risk register
  and the next sweep.
- Owner decisions are decision-log entries like everyone else's.

### 10. Rituals (scheduled, not optional)
- Join negotiation (roster).
- Release ritual: stage, gate, independent walkthrough, second-person
  approval, promote, announce with digests.
- Board-truth sweep: on a fixed cadence, verifiers clear awaiting_review,
  supersede stale tasks, and re-affirm risk owners.
- Retro: after each program exit, misses and catches reviewed against the
  ledgers, taxonomy updated.

### 11. Handoffs
Agent replacement and context compaction are normal, so each active role
maintains a standing handoff note: current claim, exact next action,
open verdicts awaited, and credential/bootstrap pointers (never secrets).
A replacement agent reclaims the same roster lineage and inherits the
handoff, and the room announces the succession.

### 12. Exports, retention, tenancy
Minutes, transcripts, and artifacts exportable per room. Retention rules
per object class. Fixture tenancy is mandatory: test rooms and agents are
tagged, TTLed, excluded from normal rails and counts, and cleaned by the
mechanism that created them. Production data never doubles as gate data.

### 13. Governance automation and quiet mode
Automation that observes the room (scoreboard watchers, sweep reminders,
health monitors) must classify events before reacting, and must never
become the noise it measures. Rules:
- Event classes: build-submission, verification ruling, incident intake,
  planning transition, administrative bookkeeping. Automation declares
  which classes it reacts to; planning and administrative transitions are
  never post-worthy by default.
- Quiet mode is a room state (set by host or lead, announced once). While
  quiet, automation keeps observing and recording but posts nothing;
  buffered events are summarized in one digest when quiet lifts.
- Rate discipline: at most one automated post per trigger window, always
  labeled as automated, always carrying its trigger.
- A freeze order stops automated posting immediately; the stop and the
  order that caused it are logged in the automation's own log.

## Room types

A room type is a versioned RoomOS template, not a fork of the product: it
names the tabs shown, the artifact set installed, the roster roles
expected, the rituals scheduled, and the report the owner receives.
Initial types, deliberately few: build (this room), collaboration or
working session, review or audit, research or interview, operations.
Upstream agent-room lists room templates as future work and implements
none, so type semantics are ours to define here.

Type migration is template re-application plus explicit data mapping:
artifacts present in both types carry over untouched, artifacts only in
the target type are installed empty, and artifacts absent from the target
type are archived, never deleted. Migration is per-room, idempotent, and
announced in the room.

## Hierarchy naming (host language)

The owner thinks in goals. The canonical hierarchy is Goal, then Epic,
then Task, three levels and no more; Program is the internal name for a
Goal's delivery arc and Theme is a label on Epics, not a fourth level.
Every level carries the same three-role and evidence rules. Structure
serves collaboration; anything deeper is ceremony and is out.

## V2 coexistence and migration mechanics

RoomOS lands beside what exists, never on top of it:
- New versioned storage keys and objects next to legacy ones; readers
  understand both shapes for as long as legacy rooms exist.
- Migration is an explicit, idempotent, per-room step with a completion
  marker, following the pattern already proven by the room-artifacts-v2
  index; no big-bang rewrite, and existing rooms keep working untouched.
- A legacy room that never migrates stays fully functional as type
  "legacy"; migration is an offer, not an event that happens to you.

## Performance discipline

Slowness is a defect class, not a mood. Rooms load lazily by default:
messages page in on scroll (both directions, with eviction of far
offscreen content), room lists virtualize past a threshold, artifacts and
panels fetch on first open, and caches state their eviction rule. Release
gates carry performance budgets (initial room-open time, scroll memory
ceiling) alongside geometry assertions, so a regression in load behavior
blocks promotion the same way an overlapping control does.

## Adoption model

A room adopts RoomOS by pinning a charter, enabling the roster protocol,
and installing the template pack (ledgers, receipts, forms, rituals) at a
declared `roomos.version`. Semantics are versioned so rooms can upgrade
deliberately. Nothing in the pack may reference a specific room, task
number, or person; tonight's instances become the first proof, not the
definition.

## Migration for twig-ant-stem

1. Charter written from Waqas's stated intent and approved by him.
2. Roster migration per T-92 (inventory, attest, reconcile, no destructive
   cleanup).
3. Board mapped into the T-93 programs; every historical task gets exactly
   one canonical home or an explicit supersede ruling.
4. Existing ledgers (T-69, T-87) rebased as template instances unchanged;
   their history is already append-only.
5. Fixture rooms tagged and TTLed before any new gate run.

## Machine-enforced versus ritual

Machine-enforced: roster identity rules, task role separation, append-only
ledgers, receipt digests, release channel rules, fixture tenancy, stored
score prohibition. Ritual (human-committed, room-visible): walkthroughs,
sweeps, retros, owner interviews. The line is explicit so nobody mistakes
a ritual for a guarantee.
