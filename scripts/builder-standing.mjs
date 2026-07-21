#!/usr/bin/env node
// Computed builder standing (T-87 rev2). Standing is a VIEW over immutable
// classified rows, never a stored number. Rules per the Master Lead ruling:
// - ONLY adjudicator-confirmed rows score; zero confirmed rows => UNSCORED,
//   never a default 100.
// - Six category subscores plus an overall, each UNSCORED without evidence.
// - Rolling window: the last 10 confirmed rows drive the headline; the rows
//   before them drive the trend comparison (improving/steady/declining).
// - Relapse tracking: after each confirmed defect, the agent's next 3
//   confirmed rows are watched for the same class (relapsed / clean /
//   watching n/3).
// - Agents are keyed by stable agentId, never display name.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "docs/builder-quality/ledger.jsonl"), "utf8");
const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));

const superseded = new Set(rows.filter((r) => r.kind === "correction" && r.supersedes).map((r) => r.supersedes));
// A correction row scores as its effectiveKind so replacements stay visible.
const active = rows.filter((r) => !superseded.has(r.id))
  .map((r) => (r.kind === "correction" ? { ...r, kind: r.effectiveKind } : r));

const CATEGORIES = [
  "functional-correctness", "visual-interaction-quality", "verification-discipline",
  "dod-compliance", "regression-containment", "candor-recovery",
];
const SEV_WEIGHT = { minor: 4, moderate: 10, serious: 18, critical: 30 };
const CREDIT_WEIGHT = 8;
const WINDOW = 10;

function scoreRows(list) {
  if (list.length === 0) return null; // UNSCORED
  const deduction = list.filter((r) => r.kind === "defect")
    .reduce((s, r) => s + (SEV_WEIGHT[r.severity] ?? 10), 0);
  const credit = list.filter((r) => r.kind === "credit" || r.kind === "recovery").length * CREDIT_WEIGHT;
  return Math.max(0, Math.min(100, 100 - deduction + credit));
}
const fmt = (s) => (s === null ? "UNSCORED (no confirmed evidence)" : `${s}/100`);

const byAgent = new Map();
for (const r of active) {
  const key = r.agentId ?? r.agent;
  if (!byAgent.has(key)) byAgent.set(key, { display: r.agent, confirmed: [], pending: [] });
  const b = byAgent.get(key);
  (r.adjudication?.status === "confirmed" ? b.confirmed : b.pending).push(r);
}

for (const [agentId, b] of byAgent) {
  b.confirmed.sort((x, y) => x.recordedAt - y.recordedAt);
  const recent = b.confirmed.slice(-WINDOW);
  const prior = b.confirmed.slice(0, Math.max(0, b.confirmed.length - WINDOW));
  const headline = scoreRows(recent);
  const priorScore = scoreRows(prior);
  const trend = headline === null || priorScore === null ? "insufficient history for trend"
    : headline > priorScore ? "improving" : headline < priorScore ? "declining" : "steady";

  console.log(`\n=== ${b.display} (${agentId}) ===`);
  console.log(`confirmed rows: ${b.confirmed.length} (window: last ${recent.length}) · pending unscored: ${b.pending.length}`);
  console.log(`overall standing: ${fmt(headline)}${headline !== null && recent.length < 5 ? " · LOW SAMPLE, indicative only" : ""}`);
  console.log(`trend vs prior rows: ${trend}`);

  for (const cat of CATEGORIES) {
    const catRows = recent.filter((r) => r.category === cat);
    console.log(`  ${cat}: ${fmt(scoreRows(catRows))}${catRows.length ? ` (n=${catRows.length})` : ""}`);
  }

  // Relapse tracking: for each confirmed defect, watch the next 3 confirmed rows.
  const relapses = [];
  b.confirmed.forEach((r, i) => {
    if (r.kind !== "defect") return;
    const next = b.confirmed.slice(i + 1, i + 4);
    const relapse = next.find((x) => x.kind === "defect" && x.class === r.class);
    const status = relapse ? `RELAPSED (${relapse.id})`
      : next.length >= 3 ? "clean" : `watching ${next.length}/3`;
    relapses.push(`  ~ ${r.class} [${r.id}]: ${status}`);
  });
  if (relapses.length) { console.log("relapse watch:"); relapses.forEach((l) => console.log(l)); }

  const classes = {};
  for (const r of b.confirmed.filter((x) => x.kind === "defect")) classes[r.class] = (classes[r.class] ?? 0) + 1;
  const repeats = Object.entries(classes).filter(([, c]) => c > 1);
  if (repeats.length) console.log(`recurring classes: ${repeats.map(([k, c]) => `${k} x${c}`).join(", ")}`);

  if (b.pending.length) {
    console.log("pending adjudication (not scored):");
    for (const r of b.pending) console.log(`  ? [${r.kind}${r.severity ? "/" + r.severity : ""}] ${r.class}: ${r.summary}`);
  }
}

if (process.argv.includes("--brief")) {
  const parts = [];
  for (const [agentId, b] of byAgent) {
    const s = scoreRows(b.confirmed.slice(-WINDOW));
    parts.push(`${b.display}: ${s === null ? "UNSCORED" : s + "/100"} (${b.confirmed.length} confirmed, ${b.pending.length} pending)`);
  }
  console.log(`\nBRIEF: ${parts.join(" · ")}`);
}
