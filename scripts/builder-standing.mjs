#!/usr/bin/env node
// Computed builder standing (T-87 rev3). Standing is a VIEW over immutable
// classified rows, never a stored number.
//
// Scoring model (locked by the Master Lead ruling):
// - Six categories with fixed weights:
//     functional-correctness 25, visual-interaction-quality 25,
//     verification-discipline 20, dod-compliance 15,
//     regression-containment 10, candor-recovery 5.
// - Each category scores 0-100 from its confirmed rows (severity-weighted
//   deductions, credit offsets). Overall = weight-normalized composite over
//   the categories that HAVE evidence; zero confirmed rows anywhere =>
//   UNSCORED, never a default.
// - Windows and relapse are keyed to SUBMISSIONS, not raw rows: a submission
//   is the row's taskRef (conduct rows with taskRef null form their own
//   singleton events). The headline uses the agent's last 10 distinct
//   submissions; relapse for a confirmed defect watches the agent's next 3
//   RELEVANT submissions (same category) for a same-class defect.
// - Only adjudicator-confirmed rows score. Rows whose evidence cannot be
//   machine-verified are marked manual-review and stay visibly flagged.
//
// Modes:
//   (default)            full per-agent report
//   --brief              one-line room-ready summary
//   --write-scoreboard   regenerate docs/builder-quality/SCOREBOARD.md

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "docs/builder-quality/ledger.jsonl"), "utf8");
const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));

const superseded = new Set(rows.filter((r) => r.kind === "correction" && r.supersedes).map((r) => r.supersedes));
const active = rows.filter((r) => !superseded.has(r.id))
  .map((r) => (r.kind === "correction" ? { ...r, kind: r.effectiveKind } : r));

const WEIGHTS = {
  "functional-correctness": 25,
  "visual-interaction-quality": 25,
  "verification-discipline": 20,
  "dod-compliance": 15,
  "regression-containment": 10,
  "candor-recovery": 5,
};
const CATEGORIES = Object.keys(WEIGHTS);
const SEV_WEIGHT = { minor: 10, moderate: 25, serious: 45, critical: 70 };
const CREDIT_WEIGHT = 20;
const WINDOW_SUBMISSIONS = 10;

const submissionKey = (r) => r.taskRef ?? `conduct:${r.id}`;

function categoryScore(list) {
  if (list.length === 0) return null;
  const deduction = list.filter((r) => r.kind === "defect")
    .reduce((s, r) => s + (SEV_WEIGHT[r.severity] ?? 25), 0);
  const credit = list.filter((r) => r.kind === "credit" || r.kind === "recovery").length * CREDIT_WEIGHT;
  return Math.max(0, Math.min(100, 100 - deduction + credit));
}

function composite(confirmed) {
  const cats = {};
  let weightSum = 0, weighted = 0, any = false;
  for (const cat of CATEGORIES) {
    const s = categoryScore(confirmed.filter((r) => r.category === cat));
    cats[cat] = s;
    if (s !== null) { any = true; weighted += WEIGHTS[cat] * s; weightSum += WEIGHTS[cat]; }
  }
  return { overall: any ? Math.round(weighted / weightSum) : null, cats };
}
const fmt = (s) => (s === null ? "UNSCORED (no confirmed evidence)" : `${s}/100`);

const byAgent = new Map();
for (const r of active) {
  const key = r.agentId ?? r.agent;
  if (!byAgent.has(key)) byAgent.set(key, { display: r.agent, confirmed: [], pending: [] });
  const b = byAgent.get(key);
  (r.adjudication?.status === "confirmed" ? b.confirmed : b.pending).push(r);
}

function report(out = console.log) {
  const briefParts = [];
  for (const [agentId, b] of byAgent) {
    b.confirmed.sort((x, y) => x.recordedAt - y.recordedAt);

    // Distinct submissions in time order; window = last 10 submissions.
    const subOrder = [];
    for (const r of b.confirmed) {
      const k = submissionKey(r);
      if (!subOrder.includes(k)) subOrder.push(k);
    }
    const windowSubs = new Set(subOrder.slice(-WINDOW_SUBMISSIONS));
    const priorSubs = new Set(subOrder.slice(0, Math.max(0, subOrder.length - WINDOW_SUBMISSIONS)));
    const recent = b.confirmed.filter((r) => windowSubs.has(submissionKey(r)));
    const prior = b.confirmed.filter((r) => priorSubs.has(submissionKey(r)));

    const { overall, cats } = composite(recent);
    const priorOverall = composite(prior).overall;
    const trend = overall === null || priorOverall === null ? "insufficient history for trend"
      : overall > priorOverall ? "improving" : overall < priorOverall ? "declining" : "steady";

    out(`\n=== ${b.display} (${agentId}) ===`);
    out(`confirmed rows: ${b.confirmed.length} across ${subOrder.length} submissions (window: last ${windowSubs.size} submissions) · pending unscored: ${b.pending.length}`);
    out(`overall standing: ${fmt(overall)}${overall !== null && windowSubs.size < 5 ? " · LOW SAMPLE, indicative only" : ""}`);
    out(`trend vs prior submissions: ${trend}`);
    for (const cat of CATEGORIES) {
      const n = recent.filter((r) => r.category === cat).length;
      out(`  ${cat} (w${WEIGHTS[cat]}): ${fmt(cats[cat])}${n ? ` (n=${n})` : ""}`);
    }

    // Relapse: for each confirmed defect, the next 3 RELEVANT submissions
    // (same category) are watched for a same-class defect.
    const relapses = [];
    for (const r of b.confirmed) {
      if (r.kind !== "defect") continue;
      const laterSubs = subOrder.slice(subOrder.indexOf(submissionKey(r)) + 1);
      const relevant = laterSubs.filter((k) =>
        b.confirmed.some((x) => submissionKey(x) === k && x.category === r.category)).slice(0, 3);
      const relapse = relevant.find((k) =>
        b.confirmed.some((x) => submissionKey(x) === k && x.kind === "defect" && x.class === r.class));
      const status = relapse ? `RELAPSED (in ${relapse})`
        : relevant.length >= 3 ? "clean" : `watching ${relevant.length}/3 relevant submissions`;
      relapses.push(`  ~ ${r.class} [${r.id}]: ${status}`);
    }
    if (relapses.length) { out("relapse watch:"); relapses.forEach((l) => out(l)); }

    const manual = [...b.confirmed, ...b.pending].filter((r) => r.evidenceReview === "manual-required");
    if (manual.length) out(`manual factual review flagged: ${manual.map((r) => r.id).join(", ")}`);

    if (b.pending.length) {
      out("pending adjudication (not scored):");
      for (const r of b.pending) out(`  ? [${r.kind}${r.severity ? "/" + r.severity : ""}] ${r.class} @${r.taskRef ?? "conduct"}: ${r.summary}`);
    }
    briefParts.push(`${b.display}: ${overall === null ? "UNSCORED" : overall + "/100"} (${b.confirmed.length} confirmed / ${b.pending.length} pending)`);
  }
  return briefParts;
}

if (process.argv.includes("--brief")) {
  const parts = report(() => {});
  console.log(`Builder standing — ${parts.join(" · ")}`);
} else if (process.argv.includes("--write-scoreboard")) {
  const lines = [];
  const parts = report((l) => lines.push(l));
  const md = [
    "# Builder Quality Scoreboard",
    "",
    "Generated by `node scripts/builder-standing.mjs --write-scoreboard`.",
    "Run after every task verification or host-reported incident, then post",
    "the `--brief` line to the room (`scripts/post-builder-standing.mjs`).",
    "Standing is computed from `ledger.jsonl`; this file is a rendered",
    "artifact, never the source of truth.",
    "",
    "```",
    ...lines.map((l) => l.replace(/^\n/, "")),
    "```",
    "",
  ].join("\n");
  writeFileSync(join(root, "docs/builder-quality/SCOREBOARD.md"), md);
  console.log(`SCOREBOARD.md written. Brief: ${parts.join(" · ")}`);
} else {
  report();
}
