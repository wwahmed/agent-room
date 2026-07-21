#!/usr/bin/env node
// Mechanical validation for docs/builder-quality/ledger.jsonl (T-87).
// Same discipline as the T-69 verifier ledger: append-only history enforced
// against the committed baseline, evidence-ref formats validated, no stored
// scores (standing is COMPUTED from rows by scripts/builder-standing.mjs).
//
// Usage:
//   node scripts/validate-builder-ledger.mjs            # canonical ledger
//   node scripts/validate-builder-ledger.mjs <file> [--baseline <file>] [--no-history]

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_REL = "docs/builder-quality/ledger.jsonl";

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

const KINDS = new Set(["defect", "recovery", "credit", "correction"]);
const SEVERITIES = new Set(["minor", "moderate", "serious", "critical"]);
const ADJ = new Set(["pending", "confirmed", "rejected"]);
const FORBIDDEN = ["score", "tally", "standing", "total", "points"];
const ID_RE = /^BQ-\d{4}$/;
const CLASS_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
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
  } catch { return false; }
}

function validateRef(n, j, ev) {
  if (typeof ev !== "object" || ev === null || typeof ev.type !== "string" ||
      typeof ev.ref !== "string" || !ev.ref.trim()) {
    fail(n, `evidenceRefs[${j}] must be {type, ref: non-empty string}`);
    return;
  }
  const re = REF_FORMATS[ev.type];
  if (!re) { fail(n, `evidenceRefs[${j}] unknown type '${ev.type}'`); return; }
  if (!re.test(ev.ref)) { fail(n, `evidenceRefs[${j}] ref '${ev.ref}' does not match the ${ev.type} format`); return; }
  if (ev.type === "file") {
    const p = ev.ref.split(":")[0];
    if (isAbsolute(p)) fail(n, `evidenceRefs[${j}] file ref must be repo-relative`);
    else if (!existsSync(join(root, p))) fail(n, `evidenceRefs[${j}] file '${p}' does not exist`);
  }
  if (ev.type === "commit" && !commitExists(ev.ref)) {
    fail(n, `evidenceRefs[${j}] commit '${ev.ref}' does not exist in this repository`);
  }
}

const raw = readFileSync(ledgerPath, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);
const seen = new Map();
let prevIdNum = 0;

lines.forEach((text, i) => {
  const n = i + 1;
  let e;
  try { e = JSON.parse(text); } catch { fail(n, "not valid JSON"); return; }

  for (const f of FORBIDDEN) {
    if (f in e) fail(n, `forbidden field '${f}': standing is computed, never stored`);
  }
  if (typeof e.id !== "string" || !ID_RE.test(e.id)) {
    fail(n, `id must match BQ-NNNN, got ${JSON.stringify(e.id)}`);
  } else {
    if (seen.has(e.id)) fail(n, `duplicate id ${e.id}`);
    seen.set(e.id, n);
    const num = Number(e.id.slice(3));
    if (num <= prevIdNum) fail(n, `id ${e.id} not strictly increasing`);
    prevIdNum = Math.max(prevIdNum, num);
  }
  if (!Number.isInteger(e.recordedAt) || e.recordedAt <= 0) fail(n, "recordedAt must be epoch ms");
  if (typeof e.recordedBy !== "string" || !e.recordedBy) fail(n, "recordedBy required");
  if (typeof e.agent !== "string" || !e.agent.trim()) fail(n, "agent required (who the row is about)");
  if (!KINDS.has(e.kind)) fail(n, `kind must be one of ${[...KINDS].join("/")}`);

  if (e.kind === "correction") {
    if (typeof e.supersedes !== "string" || !seen.has(e.supersedes) || e.supersedes === e.id) {
      fail(n, "correction must supersede an earlier existing id");
    }
  } else if (e.supersedes != null) {
    fail(n, `kind '${e.kind}' must have supersedes: null`);
  }

  if (typeof e.class !== "string" || !CLASS_RE.test(e.class)) {
    fail(n, "class must be a kebab-case mistake/credit class");
  }
  if (e.kind === "defect" && !SEVERITIES.has(e.severity)) {
    fail(n, "defect rows require severity minor|moderate|serious|critical");
  }
  if (typeof e.summary !== "string" || !e.summary.trim()) fail(n, "summary required");

  if (!Array.isArray(e.evidenceRefs) || e.evidenceRefs.length === 0) {
    fail(n, "evidenceRefs must be non-empty: unlinked claims do not enter the ledger");
  } else {
    e.evidenceRefs.forEach((ev, j) => validateRef(n, j, ev));
  }

  const a = e.adjudication;
  if (typeof a !== "object" || a === null || !ADJ.has(a.status) ||
      typeof a.adjudicator !== "string" || !a.adjudicator ||
      (a.ref !== null && typeof a.ref !== "string")) {
    fail(n, "adjudication must be {status: pending|confirmed|rejected, adjudicator, ref: string|null}");
  } else if (a.status !== "pending" && a.ref === null) {
    fail(n, `adjudication.status '${a.status}' requires an on-record ruling ref`);
  }
  if (e.notes != null && typeof e.notes !== "string") fail(n, "notes must be a string or null");
});

if (!skipHistory) {
  let baselineRaw = null;
  let baselineDesc = null;
  if (baselinePath) {
    baselineRaw = readFileSync(baselinePath, "utf8");
    baselineDesc = baselinePath;
  } else if (ledgerPath === join(root, CANONICAL_REL) || ledgerPath === CANONICAL_REL) {
    try {
      const headRaw = execFileSync("git", ["-C", root, "show", `HEAD:${CANONICAL_REL}`], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      let rev = "HEAD";
      if (headRaw === raw) {
        try {
          execFileSync("git", ["-C", root, "cat-file", "-e", `HEAD^:${CANONICAL_REL}`], { stdio: "pipe" });
          rev = "HEAD^";
        } catch { rev = null; }
      }
      if (rev !== null) {
        baselineRaw = rev === "HEAD" ? headRaw
          : execFileSync("git", ["-C", root, "show", `${rev}:${CANONICAL_REL}`], { stdio: ["pipe", "pipe", "pipe"] }).toString();
        baselineDesc = `${rev}:${CANONICAL_REL}`;
      }
    } catch { baselineRaw = null; }
  }
  if (baselineRaw !== null) {
    const baseLines = baselineRaw.split("\n").filter((l) => l.trim().length > 0);
    if (baseLines.length > lines.length) {
      fail(0, `history violation: committed rows were deleted (baseline ${baselineDesc})`);
    } else {
      baseLines.forEach((bl, i) => {
        if (lines[i] !== bl) fail(i + 1, `history violation: committed line rewritten (baseline ${baselineDesc})`);
      });
    }
  }
}

if (errors.length > 0) {
  for (const err of errors) console.error(`builder ledger INVALID: ${err}`);
  process.exit(1);
}
console.log(`builder ledger OK: ${lines.length} entries, schema + provenance + history checks passed`);
