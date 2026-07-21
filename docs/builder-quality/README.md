# Builder Quality Ledger

Durable, append-only quality history for room builders, created under T-87 at
the host's request and the Master Lead's direction. It generalizes the T-69
verifier-audit ledger (`docs/verifier-audit/`) to everyone who ships.

## Files

- `ledger.jsonl`: one JSON entry per line, append-only.
- `../../scripts/validate-builder-ledger.mjs`: mechanical validation of schema,
  evidence-ref formats and existence, correction semantics, and append-only
  history against the committed baseline. Run before every commit.
- `../../scripts/builder-standing.mjs`: the computed standing view. Prints
  per-agent aggregates, recurring mistake classes, trend inputs, and sample
  size. Standing is derived from rows on demand and is never stored, so a
  total cannot be edited or gamed.

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
| `agent` | string | Who the row is about. |
| `kind` | enum | `defect`, `recovery`, `credit`, `correction`. |
| `class` | kebab-case | Mistake or credit class (taxonomy below). |
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
