# Builder Quality Ledger

Durable, append-only quality history for room builders, created under T-87 at
the host's request and the Master Lead's direction. It generalizes the T-69
verifier-audit ledger (`docs/verifier-audit/`) to everyone who ships.

## Files

- `ledger.jsonl`: one JSON entry per line, append-only.
- `../../scripts/validate-builder-ledger.mjs`: mechanical validation of schema,
  evidence-ref formats and existence, correction semantics, and append-only
  history against the committed baseline. Run before every commit.
- `../../scripts/builder-standing.mjs`: the computed standing view. Only
  adjudicator-confirmed rows score; zero confirmed rows prints UNSCORED,
  never a default number. The scoring model is locked: six categories with
  fixed weights (functional-correctness 25, visual-interaction-quality 25,
  verification-discipline 20, dod-compliance 15, regression-containment 10,
  candor-recovery 5); the overall is the weight-normalized composite over
  evidenced categories. Windows and relapse are keyed to SUBMISSIONS via
  `taskRef` (conduct rows are singleton events): the headline uses the last
  ten distinct submissions, trend compares against the prior submissions,
  and each confirmed defect watches the next three relevant submissions
  (same category) for a same-class relapse. Rows without locally provable
  evidence carry `evidenceReview: manual-required` and are flagged.
  `--write-scoreboard` regenerates `SCOREBOARD.md` (a rendered artifact,
  never the source of truth); `--brief` emits the room line.
- `../../scripts/post-builder-standing.mjs`: the update hook. Run after
  every task verification or host-reported incident; it posts the brief to
  the room using a member key read from `WAKICHAT_MEMBERKEY_FILE`. Standing
  is derived on demand and never stored, so a total cannot be edited or
  gamed. A row's subject can never be its adjudicator; rows about the
  Master Lead are adjudicated by the host.

## Rules

1. Append-only, mechanically enforced; wrong rows are superseded by
   `correction` entries, never edited.
2. Every row links to a task, commit, gate result, room message, or
   attachment. Unlinked claims do not enter the ledger.
3. Rows are classified events, not scores. Only `confirmed` rows enter the
   computed standing; `pending` rows wait for the adjudicator (Master Lead).
   Builders may challenge a row; only the adjudicator can confirm or reject.
4. Credits and recoveries are first-class rows: the purpose is corrective
   behavior, not punishment. Honest self-disclosure and clean recoveries
   raise the computed standing.
5. Recurring classes are the signal: the standing view flags any mistake
   class appearing more than once per agent so relapse is visible after the
   next relevant submissions.

## Entry schema

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `BQ-NNNN` | Stable, unique, strictly increasing. |
| `recordedAt` | epoch ms | When the row was appended. |
| `recordedBy` | string | Author of the row. |
| `agent` | string | Display name of who the row is about. |
| `agentId` | kebab-case | Stable actor id; scoring keys on this, never the display name. |
| `kind` | enum | `defect`, `recovery`, `credit`, `correction`. |
| `effectiveKind` | enum | On corrections only: the kind the replacement scores as. |
| `class` | kebab-case | Mistake or credit class (taxonomy below). |
| `category` | enum | One of the six scoring categories: functional-correctness, visual-interaction-quality, verification-discipline, dod-compliance, regression-containment, candor-recovery. |
| `severity` | enum | Required for defects: `minor` .. `critical`. |
| `summary` | string | One-sentence statement of the event. |
| `evidenceRefs` | array | `{type, ref}` per T-69 formats. Non-empty. |
| `adjudication` | object | `{status, adjudicator, ref}`. |

## Seed taxonomy (2026-07-21)

`conditional-hook`, `untested-interactive-state`, `deploy-before-inspect`,
`evidence-not-matching-source`, `partial-fix-announced-complete`,
`overstated-evidence`, `absent-assignee`, `regression-containment`,
`incomplete-gate-coverage`, `incident-response`, `candid-disclosure`,
`independent-verification`, `thorough-rework`.
