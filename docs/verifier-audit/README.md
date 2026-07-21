# Verifier Audit Ledger

Durable, append-only quality history for room verifiers, starting with
UX-Adversary (2). Created under T-69. The chat-attachment draft
(`verifier-audit-log.md`, blob `aa57790d627a9608929a74894f1feaed.md`) is
superseded by this document and retained only as provenance.

## Files

- `ledger.jsonl`: one JSON entry per line, append-only.
- `../../scripts/validate-verifier-ledger.mjs`: mechanical validation of
  schema, evidence-ref formats and existence, remediation proof, correction
  semantics, and append-only history against the committed baseline.
  Run: `node scripts/validate-verifier-ledger.mjs`.
- `../../scripts/validate-verifier-ledger.test.mjs`: test harness running the
  validator against the real ledger, the committed fixtures below, and
  simulated history rewrite/deletion. Run before every ledger commit.
- `fixtures/`: committed positive and negative fixtures. Each `invalid-*`
  file must fail validation with its specific error; `valid-minimal.jsonl`
  must pass.

## Rules

1. Append-only, mechanically enforced. A wrong or stale entry is corrected by
   appending a `correction` entry with `supersedes` pointing at the old id.
   The validator diffs the working file against `HEAD:` and fails if any
   committed line was edited or deleted; only corrections may supersede, and
   every correction must supersede an earlier entry. Superseded rows are
   frozen history: structural rules still apply to them, but provenance rules
   are enforced on active rows only, since a superseded row's recorded flaw is
   exactly why its correction exists.
2. No published score. The ledger records rows; only the adjudicator
   (currently Codex UX Reviewer, Master Lead) rules on totals or standing.
   The validator rejects any entry carrying score or tally fields.
3. Self-reported catches do not score until `adjudication.status` is
   `confirmed` by the adjudicator with a reference. Open notes are not fixed
   catches: `remediation.status` stays `open` until the remediation task is
   verified done.
4. Every entry carries stable evidence references, validated by format per
   type (`T-NN` tasks, 13-digit room message ids, commit SHAs, room/hash
   attachment keys, repo-relative file paths with optional `:line`) and by
   existence where locally provable (file paths on disk, commits via
   `git cat-file`). A `remediated` status additionally requires a closing
   commit or room_message ruling ref; task or file assertions alone are not
   provenance. Claims without a valid reference do not go in the ledger.
5. Recurrence is only asserted with instrumentation behind it (a gate
   assertion or fixture). Otherwise `remediation.status` stays at
   `open`/`remediated` and no recurrence claim is made.

## Entry schema

Required fields for every entry:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `VA-NNNN` | Stable, unique, strictly increasing. |
| `recordedAt` | epoch ms | When the row was appended. |
| `recordedBy` | string | Author of the row. |
| `kind` | enum | `miss`, `catch`, `false_finding`, `correction`. |
| `supersedes` | id or null | Earlier entry this row corrects. |
| `issue` | string | One-sentence defect statement. |
| `surface` | string | Screen/state or subsystem. |
| `missedState` | string or null | Exact state not examined (required for `miss` and `false_finding`). |
| `userHarm` | string | Concrete harm to a user. |
| `firstReporter` | string | Who surfaced the whole-story failure first. |
| `priorVerdict` | object or null | `{taskId, verdict, verifiedAt}` for the verdict now known wrong. |
| `remediation` | object | `{taskId, status}` where status is `open`, `remediated`, or `recurred`. |
| `evidenceRefs` | array | Each `{type, ref}` with type `room_message`, `task`, `commit`, `attachment`, or `file`. Non-empty. |
| `adjudication` | object | `{status, adjudicator, ref}` where status is `pending`, `confirmed`, or `rejected`. |

## Adjudication

The adjudicator confirms or rejects rows by appending a `correction` entry or
by an on-record room ruling whose message id is then written into
`adjudication.ref` via a superseding row. Nothing in this ledger is scored
until that happens.
