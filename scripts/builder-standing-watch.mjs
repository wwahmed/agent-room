#!/usr/bin/env node
// T-87 rev4: the automatic-governance daemon. Nobody has to remember to run
// anything: this process watches the room's task board and, whenever a
// verification event happens (a task moves to done or rejected) or a host
// incident lands (a new P0/Urgent/Emergency/incident task appears), it
// regenerates SCOREBOARD.md and posts the standing brief to the room via
// scripts/post-builder-standing.mjs.
//
// Run once, in the background, from the repo root:
//   WAKICHAT_MEMBERKEY_FILE=/path/to/keyfile \
//     nohup node scripts/builder-standing-watch.mjs >> tmp/builder-standing-watch.log 2>&1 &
//
// State (last-seen task states) persists in tmp/builder-standing-watch.json
// so restarts do not re-announce old history. The first run seeds a baseline
// silently. The member key comes only from WAKICHAT_MEMBERKEY_FILE, never a
// CLI arg, never this repo.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOM = process.env.WAKICHAT_ROOM ?? "twig-ant-stem";
const API = process.env.WAKICHAT_API ?? "http://127.0.0.1:8210/api/room";
const POLL_MS = Number(process.env.WAKICHAT_POLL_MS ?? 30_000);
const STATE_PATH = join(root, "tmp/builder-standing-watch.json");
const INCIDENT_RE = /^(P0|Urgent|Emergency)\b|incident/i;

if (!process.env.WAKICHAT_MEMBERKEY_FILE) {
  console.error("WAKICHAT_MEMBERKEY_FILE is required so posts can be sent");
  process.exit(1);
}

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`${ts()} ${msg}`);

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); }
  catch { return null; }
}
function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

async function fetchBoard() {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "taskBoard", code: ROOM }),
  });
  if (!res.ok) throw new Error(`taskBoard HTTP ${res.status}`);
  const data = await res.json();
  const tasks = data?.result?.board?.tasks ?? data?.board?.tasks;
  if (!Array.isArray(tasks)) throw new Error("taskBoard response missing tasks[]");
  return tasks;
}

function detectEvents(prev, tasks) {
  const events = [];
  for (const t of tasks) {
    const before = prev[t.id];
    if (before === undefined) {
      if (INCIDENT_RE.test(t.title ?? "")) events.push(`host incident intake ${t.id}`);
      continue;
    }
    if (before !== t.state && (t.state === "done" || t.state === "rejected")) {
      events.push(`${t.id} ${t.state === "done" ? "verified done" : "rejected"}`);
    }
  }
  return events;
}

function post(trigger) {
  execFileSync("node", [join(root, "scripts/post-builder-standing.mjs")], {
    stdio: "inherit",
    env: { ...process.env, WAKICHAT_TRIGGER: trigger },
  });
}

let state = loadState();
log(`builder-standing watcher up: room ${ROOM}, poll every ${POLL_MS}ms, state ${state ? "restored" : "seeding"}`);

let failures = 0;
for (;;) {
  try {
    const tasks = await fetchBoard();
    const snapshot = Object.fromEntries(tasks.map((t) => [t.id, t.state]));
    if (state === null) {
      state = { tasks: snapshot };
      saveState(state);
      log(`baseline seeded silently: ${tasks.length} tasks`);
    } else {
      const events = detectEvents(state.tasks, tasks);
      if (events.length > 0) {
        const trigger = events.join(", ");
        log(`trigger: ${trigger}`);
        try { post(trigger); log("posted standing brief"); }
        catch (err) { log(`POST FAILED, will not retry this event set: ${err.message}`); }
      }
      state = { tasks: snapshot };
      saveState(state);
    }
    failures = 0;
  } catch (err) {
    failures += 1;
    log(`poll error (${failures} consecutive): ${err.message}`);
  }
  const backoff = Math.min(failures, 10) * 10_000;
  await new Promise((r) => setTimeout(r, POLL_MS + backoff));
}
