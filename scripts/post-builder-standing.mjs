#!/usr/bin/env node
// T-87 rev4: regenerate-and-post. This script is the single posting path for
// builder standing. It ALWAYS regenerates SCOREBOARD.md first and takes the
// brief from that same run, so the posted line and the linked artifact can
// never disagree and the scoreboard can never be stale at post time.
//
// Invoked automatically by scripts/builder-standing-watch.mjs on every task
// verification or host incident; can also be run by hand:
//   WAKICHAT_MEMBERKEY_FILE=/path/to/keyfile node scripts/post-builder-standing.mjs
// The member key is read from a file (never a CLI arg, never committed) so
// it stays out of shell history and the transcript.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOM = process.env.WAKICHAT_ROOM ?? "twig-ant-stem";
const API = process.env.WAKICHAT_API ?? "http://127.0.0.1:8210/api/room";

const keyFile = process.env.WAKICHAT_MEMBERKEY_FILE;
if (!keyFile) {
  console.error("WAKICHAT_MEMBERKEY_FILE is required (path to the sender's member key)");
  process.exit(1);
}
const memberKey = readFileSync(keyFile, "utf8").trim();

// Regenerate the artifact and capture the brief from the SAME computation.
const out = execFileSync("node", [join(root, "scripts/builder-standing.mjs"), "--write-scoreboard"], { encoding: "utf8" });
const m = out.match(/Brief: ([\s\S]*)$/);
if (!m) {
  console.error("could not parse brief from builder-standing output:\n" + out);
  process.exit(1);
}
const brief = m[1].trim();

const trigger = (process.env.WAKICHAT_TRIGGER ?? "").trim();
const text = `[SCOREBOARD]${trigger ? ` (${trigger})` : ""} ${brief} — SCOREBOARD.md regenerated with this post`;

const body = JSON.stringify({
  action: "send", code: ROOM, kind: "msg", memberKey,
  message: {
    id: Date.now(), type: "msg", name: process.env.WAKICHAT_SENDER ?? "UX-Adversary (2)",
    initials: "UA", color: "#7c5cff", role: "UX/UI Assessor",
    text, client: "cc", time: Date.now(),
  },
});
const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body });
console.log(res.ok ? "scoreboard brief posted" : `post failed: HTTP ${res.status}`);
process.exit(res.ok ? 0 : 1);
