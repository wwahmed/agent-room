#!/usr/bin/env node
// Mechanical validation for docs/verifier-audit/ledger.jsonl (T-69 rev2).
// Exit 0 on a valid ledger; exit 1 with one line per violation.
//
// Enforced beyond field shapes:
// - evidence ref FORMATS per type, and EXISTENCE where locally provable
//   (repo file paths via fs, commit SHAs via git cat-file)
// - remediated rows must cite closing proof: at least one commit or
//   room_message ref, never task/file assertions alone
// - correction <-> supersedes: only kind 'correction' may supersede, and it
//   must supersede an earlier existing id
// - append-only HISTORY: the last committed version of the ledger must be a
//   byte-exact prefix of the working file (git show HEAD:<path>), so edits
//   or deletions of committed lines fail even though the file still parses
//
// Usage:
//   node scripts/validate-verifier-ledger.mjs                 # canonical ledger
//   node scripts/validate-verifier-ledger.mjs <file>          # custom file
//     --baseline <file>   enforce prefix against this file instead of git
//     --no-history        skip the history-prefix check (fixtures only)

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_REL = "docs/verifier-audit/ledger.jsonl";

const args = process.argv.slice(2);
let ledgerPath = null;
let baselinePath = null;
let skipHistory = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--baseline") baselinePath = args[++i];
  else if (args[i] === "--no-history") skipHistory = true;
  else ledgerPath = args[i];
}
if (!ledgerPath) ledgerPath = join(root, CANONICAL_REL);

const KINDS = new Set(["miss", "catch", "false_finding", "correction"]);
const REMEDIATION_STATUS = new Set(["open", "remediated", "recurred"]);
const ADJUDICATION_STATUS = new Set(["pending", "confirmed", "rejected"]);
const FORBIDDEN_FIELDS = ["score", "tally", "standing", "total"];
const ID_RE = /^VA-\d{4}$/;
const REF_FORMATS = {
  task: /^T-\d{2,4}$/,
  room_message: /^\d{13}$/,
  commit: /^[0-9a-f]{7,40}$/,
  attachment: /^[a-z0-9-]+\/[0-9a-f]{16,64}\.[A-Za-z0-9]{1,8}$/,
  file: /^[^\s:][^:\n]*(:\d+)?$/,
};

const errors = [];
const fail = (line, msg) => errors.push(`line ${line}: ${msg}`);

function commitExists(sha) {
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", `${sha}^{commit}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function validateRef(n, j, ev) {
  if (typeof ev !== "object" || ev === null || typeof ev.type !== "string" ||
      typeof ev.ref !== "string" || !ev.ref.trim()) {
    fail(n, `evidenceRefs[${j}] must be {type, ref: non-empty string}`);
    return;
  }
  const re = REF_FORMATS[ev.type];
  if (!re) {
    fail(n, `evidenceRefs[${j}] unknown type '${ev.type}' (allowed: ${Object.keys(REF_FORMATS).join("|")})`);
    return;
  }
  if (!re.test(ev.ref)) {
    fail(n, `evidenceRefs[${j}] ref '${ev.ref}' does not match the ${ev.type} format ${re}`);
    return;
  }
  if (ev.type === "file") {
    const p = ev.ref.split(":")[0];
    const abs = isAbsolute(p) ? p : join(root, p);
    if (isAbsolute(p)) fail(n, `evidenceRefs[${j}] file ref must be repo-relative, got absolute '${p}'`);
    else if (!existsSync(abs)) fail(n, `evidenceRefs[${j}] file '${p}' does not exist in the repo`);
  }
  if (ev.type === "commit" && !commitExists(ev.ref)) {
    fail(n, `evidenceRefs[${j}] commit '${ev.ref}' does not exist in this repository`);
  }
}

const raw = readFileSync(ledgerPath, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);
const seen = new Map();
let prevIdNum = 0;

// Superseded rows are frozen history: their recorded flaws are exactly why a
// correction was appended. Structural rules still apply to them, but
// provenance-quality rules (remediated-proof) are enforced on ACTIVE rows only.
const supersededIds = new Set();
for (const text of lines) {
  try {
    const e = JSON.parse(text);
    if (e && e.kind === "correction" && typeof e.supersedes === "string") supersededIds.add(e.supersedes);
  } catch { /* structural failure reported in the main pass */ }
}

lines.forEach((text, i) => {
  const n = i + 1;
  let e;
  try {
    e = JSON.parse(text);
  } catch {
    fail(n, "not valid JSON");
    return;
  }

  for (const f of FORBIDDEN_FIELDS) {
    if (f in e) fail(n, `forbidden field '${f}': scores are adjudicator-only, never stored`);
  }

  if (typeof e.id !== "string" || !ID_RE.test(e.id)) {
    fail(n, `id must match VA-NNNN, got ${JSON.stringify(e.id)}`);
  } else {
    if (seen.has(e.id)) fail(n, `duplicate id ${e.id} (first at line ${seen.get(e.id)})`);
    seen.set(e.id, n);
    const num = Number(e.id.slice(3));
    if (num <= prevIdNum) fail(n, `id ${e.id} not strictly increasing (append-only order)`);
    prevIdNum = Math.max(prevIdNum, num);
  }

  if (!Number.isInteger(e.recordedAt) || e.recordedAt <= 0) fail(n, "recordedAt must be epoch ms");
  if (typeof e.recordedBy !== "string" || !e.recordedBy) fail(n, "recordedBy required");
  if (!KINDS.has(e.kind)) fail(n, `kind must be one of ${[...KINDS].join("/")}`);

  if (e.kind === "correction") {
    if (typeof e.supersedes !== "string") {
      fail(n, "kind 'correction' requires supersedes pointing at an earlier entry");
    } else if (!seen.has(e.supersedes) || e.supersedes === e.id) {
      fail(n, `correction supersedes '${e.supersedes}' which is not an earlier entry`);
    }
  } else if (e.supersedes !== null && e.supersedes !== undefined) {
    fail(n, `kind '${e.kind}' must have supersedes: null; only corrections supersede`);
  }

  for (const f of ["issue", "surface", "userHarm", "firstReporter"]) {
    if (typeof e[f] !== "string" || !e[f].trim()) fail(n, `${f} required`);
  }

  if (e.kind === "miss" || e.kind === "false_finding") {
    if (typeof e.missedState !== "string" || !e.missedState.trim()) {
      fail(n, `missedState required for kind ${e.kind}`);
    }
  } else if (e.missedState !== null && typeof e.missedState !== "string") {
    fail(n, "missedState must be a string or null");
  }

  if (e.priorVerdict !== null) {
    const p = e.priorVerdict;
    if (typeof p !== "object" || p === null || typeof p.taskId !== "string" ||
        typeof p.verdict !== "string" || !Number.isInteger(p.verifiedAt)) {
      fail(n, "priorVerdict must be null or {taskId, verdict, verifiedAt}");
    }
  }

  const r = e.remediation;
  if (typeof r !== "object" || r === null || !REMEDIATION_STATUS.has(r.status) ||
      (r.taskId !== null && typeof r.taskId !== "string")) {
    fail(n, "remediation must be {taskId: string|null, status: open|remediated|recurred}");
  }

  if (!Array.isArray(e.evidenceRefs) || e.evidenceRefs.length === 0) {
    fail(n, "evidenceRefs must be a non-empty array: claims without references do not enter the ledger");
  } else {
    e.evidenceRefs.forEach((ev, j) => validateRef(n, j, ev));
    if (r && r.status === "remediated" && !supersededIds.has(e.id)) {
      const hasProof = e.evidenceRefs.some((ev) => ev && (ev.type === "commit" || ev.type === "room_message"));
      if (!hasProof) {
        fail(n, "remediation.status 'remediated' requires a closing commit or room_message ruling ref; task/file assertions alone are not provenance");
      }
    }
  }

  const a = e.adjudication;
  if (typeof a !== "object" || a === null || !ADJUDICATION_STATUS.has(a.status) ||
      typeof a.adjudicator !== "string" || !a.adjudicator ||
      (a.ref !== null && typeof a.ref !== "string")) {
    fail(n, "adjudication must be {status: pending|confirmed|rejected, adjudicator, ref: string|null}");
  } else if (a.status !== "pending" && a.ref === null) {
    fail(n, `adjudication.status '${a.status}' requires a ref to the on-record ruling`);
  }

  if (e.notes !== null && e.notes !== undefined && typeof e.notes !== "string") {
    fail(n, "notes must be a string or null");
  }
});

// Append-only history: the committed version must be a byte-exact prefix.
if (!skipHistory) {
  let baselineRaw = null;
  let baselineDesc = null;
  if (baselinePath) {
    baselineRaw = readFileSync(baselinePath, "utf8");
    baselineDesc = baselinePath;
  } else if (ledgerPath === join(root, CANONICAL_REL) || ledgerPath === CANONICAL_REL) {
    // In a clean tree the working file IS HEAD's version, so comparing against
    // HEAD proves nothing. When they match, step back to the parent commit so
    // CI still catches a rewrite that was already committed.
    try {
      const headRaw = execFileSync("git", ["-C", root, "show", `HEAD:${CANONICAL_REL}`], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      let rev = "HEAD";
      if (headRaw === raw) {
        try {
          execFileSync("git", ["-C", root, "cat-file", "-e", `HEAD^:${CANONICAL_REL}`], { stdio: "pipe" });
          rev = "HEAD^";
        } catch {
          rev = null; // first commit of the ledger: HEAD version is the only history
        }
      }
      if (rev !== null) {
        baselineRaw = rev === "HEAD" ? headRaw
          : execFileSync("git", ["-C", root, "show", `${rev}:${CANONICAL_REL}`], { stdio: ["pipe", "pipe", "pipe"] }).toString();
        baselineDesc = `${rev}:${CANONICAL_REL}`;
      }
    } catch {
      baselineRaw = null; // no committed version yet: nothing to protect
    }
  }
  if (baselineRaw !== null) {
    const baseLines = baselineRaw.split("\n").filter((l) => l.trim().length > 0);
    if (baseLines.length > lines.length) {
      fail(0, `history violation: working ledger has fewer lines (${lines.length}) than committed baseline ${baselineDesc} (${baseLines.length}); committed rows were deleted`);
    } else {
      baseLines.forEach((bl, i) => {
        if (lines[i] !== bl) {
          fail(i + 1, `history violation: committed line ${i + 1} of ${baselineDesc} was rewritten; corrections must be appended, never edited in place`);
        }
      });
    }
  }
}

if (errors.length > 0) {
  for (const err of errors) console.error(`ledger INVALID: ${err}`);
  process.exit(1);
}
console.log(`ledger OK: ${lines.length} entries, ids ${lines.length ? JSON.parse(lines[0]).id + "..." + JSON.parse(lines[lines.length - 1]).id : "none"}, schema + provenance + history checks passed`);
