#!/usr/bin/env node
// Computed builder standing (T-87). Standing is a VIEW over ledger rows,
// never a stored number, so it cannot be gamed by editing a total. Reads
// docs/builder-quality/ledger.jsonl and prints per-agent aggregates with
// trend, sample size, and confidence caveats. Only confirmed rows score;
// pending rows are listed but excluded from the numbers. Corrections
// supersede their targets.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "docs/builder-quality/ledger.jsonl"), "utf8");
const rows = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));

const superseded = new Set(rows.filter((r) => r.kind === "correction" && r.supersedes).map((r) => r.supersedes));
const active = rows.filter((r) => !superseded.has(r.id));

const SEV_WEIGHT = { minor: 2, moderate: 5, serious: 10, critical: 20 };
const CREDIT_WEIGHT = 4;

const byAgent = new Map();
for (const r of active) {
  if (!byAgent.has(r.agent)) byAgent.set(r.agent, { defects: [], credits: [], pending: [] });
  const bucket = byAgent.get(r.agent);
  if (r.adjudication?.status !== "confirmed") { bucket.pending.push(r); continue; }
  if (r.kind === "defect") bucket.defects.push(r);
  else if (r.kind === "credit" || r.kind === "recovery") bucket.credits.push(r);
}

for (const [agent, b] of byAgent) {
  const deduction = b.defects.reduce((s, r) => s + (SEV_WEIGHT[r.severity] ?? 5), 0);
  const credit = b.credits.length * CREDIT_WEIGHT;
  const score = Math.max(0, Math.min(100, 100 - deduction + credit));
  const classes = {};
  for (const r of b.defects) classes[r.class] = (classes[r.class] ?? 0) + 1;
  const repeats = Object.entries(classes).filter(([, c]) => c > 1);
  console.log(`\n=== ${agent} ===`);
  console.log(`confirmed defects: ${b.defects.length}, credits/recoveries: ${b.credits.length}, pending (unscored): ${b.pending.length}`);
  console.log(`computed standing: ${score}/100 (sample n=${b.defects.length + b.credits.length}${b.defects.length + b.credits.length < 5 ? ", LOW SAMPLE - treat as indicative only" : ""})`);
  if (repeats.length) console.log(`recurring classes: ${repeats.map(([k, c]) => `${k} x${c}`).join(", ")}`);
  for (const r of b.defects) console.log(`  - [${r.severity}] ${r.class}: ${r.summary}`);
  for (const r of b.credits) console.log(`  + ${r.class}: ${r.summary}`);
}
