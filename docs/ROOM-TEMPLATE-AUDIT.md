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
  connected.
- The source comment says role-prefilled invite links, but the implementation
  shows generic invite copy plus passive role chips.
- Suggested roles are capabilities, which is good, but there is no mapping
  from those capabilities to the uniquely named live agent sessions that will
  fill them.
- Templates do not set owner/verifier separation, create evidence-gated tasks,
  define expected project documents, or promote outcomes into the attached
  repository.
- Templates do not address duplicate display names. The current room proved
  that two Claude sessions can collapse into one board identity while editing
  the same checkout.

## What to reuse from npm 0.25.4

Adopt the demo scenarios' plain-language copy structure:

- one sentence saying when the room shape is useful;
- a specific first-message checklist;
- two or three editable examples;
- one practical pro tip.

Skip the hard-coded Builder/Claude and Reviewer/GPT assumptions, marketing
examples, and duplicated scenario taxonomy. PRD Review, Positioning, and
Competitor Analysis fit under WakiChat's broader Plan / Explore shape.
Delivery / Client Report is an expected output or handoff preset, not a
separate room lifecycle.

## Recommended WakiChat template contract

A future durable template record should contain:

```ts
interface WakiRoomTemplate {
  id: string;
  label: string;
  whenToUse: string;
  firstMessageFields: string[];
  examplePrompts: string[];
  roleSlots: Array<{
    capability: string;
    required: boolean;
    taskRole?: 'owner' | 'verifier' | 'critic' | 'facilitator';
  }>;
  suggestedMode: 'open' | 'sequential' | 'moderator';
  initialTasks: Array<{ title: string; dod: string; ownerSlot?: string; verifierSlot?: string }>;
  expectedOutputs: Array<'decision' | 'tasks' | 'result' | 'report' | 'handoff'>;
  opener: string;
}
```

The template id and applied version must be server-side room metadata. Room
creation should atomically seed the opener and initial task records so refresh,
reconnect, and another device are idempotent.

## Reply-mode recommendation

Keep **Open** as the simple default while agents are connecting. Present an
optional "Structured turns" choice during the Add agents step:

- **Review** can suggest Sequential after the Builder/author and Reviewer are
  uniquely connected.
- **Build**, **Fix**, and **Incident** can suggest Moderator only when a named
  facilitator/moderator slot is filled.
- **Plan** can suggest Sequential for Researcher then Skeptic, but should not
  block a two-person brainstorm.
- **Custom** remains Open.

Do not store a display name in template configuration. Bind a role slot to a
participant's unique server identity only after that participant joins.

## Concrete handoff to T-22 and T-23

T-22's compact chips are a good presentation layer, but the primary choices
should become Build, Fix, Review, Plan, Incident, Project Resume, and Custom.
The selected chip should show when-to-use and first-message guidance inline,
not only in a tooltip.

T-23 should use the selected template to:

1. show required and optional capability slots;
2. let Waqas map Codex, Claude, or another uniquely named session to each slot;
3. generate one-click, role-specific join instructions without host or project
   attach secrets;
4. show pending, connected, listening, duplicate-name, and disconnected state;
5. enable the suggested reply mode only after its required roster exists;
6. seed durable tasks with different owner/verifier identities;
7. confirm the opener/tasks were created once before entering the room.

Add **Project Resume** as the WakiChat-specific default when a project already
has an active task ledger. It should show the existing brief/open tasks and ask
what outcome this new room should advance, rather than posting a generic
welcome message.

## Adoption boundary

Use upstream templates to reduce choices and clarify the first action. Do not
turn them into a hidden autonomous workflow system. Waqas remains the product
owner; templates propose staffing, mode, tasks, and outputs, while the UI makes
those choices visible and editable.
