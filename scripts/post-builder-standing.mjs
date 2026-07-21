#!/usr/bin/env node
// T-87 update hook: posts the current builder-standing brief to the room.
// Invoke after every task verification or host-reported incident:
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
const brief = execFileSync("node", [join(root, "scripts/builder-standing.mjs"), "--brief"], { encoding: "utf8" }).trim();

const body = JSON.stringify({
  action: "send", code: ROOM, kind: "msg", memberKey,
  message: {
    id: Date.now(), type: "msg", name: process.env.WAKICHAT_SENDER ?? "UX-Adversary (2)",
    initials: "UA", color: "#7c5cff", role: "UX/UI Assessor",
    text: `[SCOREBOARD] ${brief} — full view: docs/builder-quality/SCOREBOARD.md`,
    client: "cc", time: Date.now(),
  },
});
const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body });
console.log(res.ok ? "scoreboard brief posted" : `post failed: HTTP ${res.status}`);
process.exit(res.ok ? 0 : 1);
