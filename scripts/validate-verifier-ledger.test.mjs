#!/usr/bin/env node
// Test harness for validate-verifier-ledger.mjs (T-69 rev2).
// Runs the validator against the real ledger, every committed fixture, and a
// simulated history rewrite/deletion. Exit 0 only if all expectations hold.

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const validator = join(here, "validate-verifier-ledger.mjs");
const fixtures = join(root, "docs/verifier-audit/fixtures");

let failures = 0;
function run(name, args, { expectExit, expectStderrIncludes = [] }) {
  const res = spawnSync("node", [validator, ...args], { encoding: "utf8" });
  const problems = [];
  if (res.status !== expectExit) {
    problems.push(`expected exit ${expectExit}, got ${res.status}`);
  }
  for (const s of expectStderrIncludes) {
    if (!res.stderr.includes(s)) problems.push(`stderr missing: "${s}"`);
  }
  if (problems.length) {
    failures++;
    console.error(`FAIL ${name}`);
    for (const p of problems) console.error(`  - ${p}`);
    if (res.stderr.trim()) console.error(`  stderr was:\n${res.stderr.split("\n").map((l) => "    " + l).join("\n")}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

// 1. The real ledger validates, including its git history-prefix check.
run("real ledger", [], { expectExit: 0 });

// 2. Valid fixture passes (no git baseline applies to fixture paths).
run("fixture valid-minimal", [join(fixtures, "valid-minimal.jsonl"), "--no-history"], { expectExit: 0 });

// 3. Bad ref formats and nonexistent targets fail loudly.
run("fixture invalid-bad-refs", [join(fixtures, "invalid-bad-refs.jsonl"), "--no-history"], {
  expectExit: 1,
  expectStderrIncludes: [
    "does not match the task format",
    "does not match the room_message format",
    "commit 'ffffffffff' does not exist",
    "does not exist in the repo",
  ],
});

// 4. Stored scores are forbidden.
run("fixture invalid-score", [join(fixtures, "invalid-score.jsonl"), "--no-history"], {
  expectExit: 1,
  expectStderrIncludes: ["forbidden field 'score'"],
});

// 5. Correction semantics are bidirectional.
run("fixture invalid-correction", [join(fixtures, "invalid-correction.jsonl"), "--no-history"], {
  expectExit: 1,
  expectStderrIncludes: [
    "kind 'correction' requires supersedes",
    "must have supersedes: null; only corrections supersede",
  ],
});

// 6. Remediated without closing proof fails.
run("fixture invalid-remediated-no-proof", [join(fixtures, "invalid-remediated-no-proof.jsonl"), "--no-history"], {
  expectExit: 1,
  expectStderrIncludes: ["requires a closing commit or room_message ruling ref"],
});

// 7. History rewrite: a committed line edited in place must fail.
const tmp = mkdtempSync(join(tmpdir(), "va-ledger-"));
const validLine = readFileSync(join(fixtures, "valid-minimal.jsonl"), "utf8").trim();
const baseline = join(tmp, "baseline.jsonl");
writeFileSync(baseline, validLine + "\n");
const rewritten = join(tmp, "rewritten.jsonl");
writeFileSync(rewritten, validLine.replace("a real issue", "a rewritten issue") + "\n");
run("history rewrite detected", [rewritten, "--baseline", baseline], {
  expectExit: 1,
  expectStderrIncludes: ["history violation", "was rewritten"],
});

// 8. History deletion: fewer lines than the baseline must fail.
const empty = join(tmp, "empty.jsonl");
writeFileSync(empty, "");
run("history deletion detected", [empty, "--baseline", baseline], {
  expectExit: 1,
  expectStderrIncludes: ["committed rows were deleted"],
});

// 9. Honest append on top of the baseline passes.
const appended = join(tmp, "appended.jsonl");
const appendRow = JSON.parse(validLine);
appendRow.id = "VA-0002";
appendRow.recordedAt += 1000;
writeFileSync(appended, validLine + "\n" + JSON.stringify(appendRow) + "\n");
run("history append allowed", [appended, "--baseline", baseline], { expectExit: 0 });

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall validator tests passed");
