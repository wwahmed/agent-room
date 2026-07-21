#!/usr/bin/env node
// Mechanical validation for docs/verifier-audit/ledger.jsonl (T-69).
// Exit 0 on a valid ledger; exit 1 with one line per violation otherwise.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = process.argv[2] ?? join(root, "docs/verifier-audit/ledger.jsonl");

const KINDS = new Set(["miss", "catch", "false_finding", "correction"]);
const REMEDIATION_STATUS = new Set(["open", "remediated", "recurred"]);
const ADJUDICATION_STATUS = new Set(["pending", "confirmed", "rejected"]);
const EVIDENCE_TYPES = new Set(["room_message", "task", "commit", "attachment", "file"]);
const FORBIDDEN_FIELDS = ["score", "tally", "standing", "total"];
const ID_RE = /^VA-\d{4}$/;

const errors = [];
const fail = (line, msg) => errors.push(`line ${line}: ${msg}`);

const raw = readFileSync(ledgerPath, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);
const seen = new Map(); // id -> line number
let prevIdNum = 0;

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

  if (e.supersedes !== null) {
    if (typeof e.supersedes !== "string" || !seen.has(e.supersedes)) {
      fail(n, `supersedes must be null or an earlier entry id, got ${JSON.stringify(e.supersedes)}`);
    } else if (e.supersedes === e.id) {
      fail(n, "entry cannot supersede itself");
    }
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
    if (
      typeof p !== "object" || p === null ||
      typeof p.taskId !== "string" ||
      typeof p.verdict !== "string" ||
      !Number.isInteger(p.verifiedAt)
    ) {
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
    e.evidenceRefs.forEach((ev, j) => {
      if (typeof ev !== "object" || ev === null || !EVIDENCE_TYPES.has(ev.type) ||
          typeof ev.ref !== "string" || !ev.ref.trim()) {
        fail(n, `evidenceRefs[${j}] must be {type: ${[...EVIDENCE_TYPES].join("|")}, ref: non-empty string}`);
      }
    });
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

if (errors.length > 0) {
  for (const err of errors) console.error(`ledger INVALID: ${err}`);
  process.exit(1);
}
console.log(`ledger OK: ${lines.length} entries, ids ${lines.length ? JSON.parse(lines[0]).id + "..." + JSON.parse(lines[lines.length - 1]).id : "none"}, all schema checks passed`);
