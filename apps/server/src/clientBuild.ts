// T-30: which agents are running pre-deploy client code.
//
// The presence ladder answers "is this agent alive". It cannot answer "is this
// agent running the build that contains the fix I shipped an hour ago" — and
// for a long-lived listen loop those come apart badly. Every MCP process pins
// the bundle it loaded at boot, so a session started before a deploy keeps
// executing the old bytes until someone restarts it. That is invisible today:
// the repo, the tests, and the board all say fixed while the fleet runs stale.
//
// The watermark is derived, never configured, so this needs no per-machine
// setup and cannot drift out of date on its own:
//
//   watermark = max(this server's own bundle build, newest client build seen
//                   among the room's cc rows)
//
// Including the server's build catches the case that matters most — EVERY
// client in the room is stale, so no client can act as the reference. Including
// the newest client catches the mirror case, where the server itself was not
// restarted after a build. A row is behind when it trails the watermark by more
// than the grace window.
//
// Clock caveat, stated rather than hidden: build stamps are file mtimes from
// whichever machine produced the bundle. On the self-host topology every
// component is built on one box, so the comparison is clock-consistent. Across
// machines with skewed clocks the delta is advisory — which is why the payload
// carries the raw stamps too, and why the UI's action is "restart to be sure"
// rather than anything destructive.

import type { Participant } from '@agent-room/shared';

/** Builds inside this window are the same deploy in practice, so a deploy never
 *  flags the very processes it just started.
 *
 *  Sized from a real false positive rather than a guess: this shipped with a
 *  60s window, and the first live probe flagged a BRAND NEW client as "2m
 *  behind" — the MCP bundle had been built two minutes before the server
 *  bundle, which is just what a multi-workspace build looks like when a fix
 *  touches several packages. The signal this exists to raise is a session that
 *  predates a deploy, which is hours old; nothing is lost by ignoring minutes,
 *  and a badge that cries wolf at ordinary build skew is a badge the host
 *  learns to ignore. */
export const CLIENT_BUILD_GRACE_MS = 15 * 60_000;

/** A stamp is evidence only when it is a real, positive epoch-ms value; 0 /
 *  undefined mean "this client never reported one" (legacy row, or stat failed
 *  in its process) and must never be treated as an ancient build. */
export function hasBuildStamp(p: Participant): boolean {
  return Number.isFinite(Number(p.clientBuildAt)) && Number(p.clientBuildAt) > 0;
}

/**
 * Newest build anyone in this conversation can prove exists. `serverBuildAt` is
 * the server's own bundle stamp (0 when unknown, which simply drops it from the
 * max rather than dragging the watermark to zero).
 */
export function buildWatermark(participants: readonly Participant[], serverBuildAt: number): number {
  let max = Number.isFinite(serverBuildAt) && serverBuildAt > 0 ? serverBuildAt : 0;
  for (const p of participants) {
    if (p.client !== 'cc' || !hasBuildStamp(p)) continue;
    const stamp = Number(p.clientBuildAt);
    if (stamp > max) max = stamp;
  }
  return max;
}

/**
 * A cc row that reports NO build stamp while the beacon is operational.
 *
 * This is the case the beacon hits on the day it ships: every session already
 * running predates the field, so the rows most in need of flagging are the ones
 * with nothing to compare. Absence is real evidence here — a current client
 * always reports — but it is evidence of "old enough to predate reporting", NOT
 * a measured delta, and it stays a SEPARATE signal for that reason. Guessing a
 * number here would be the same lie as `lastSeenAgoMs` computing an age from
 * epoch 0 ("last heard 1969").
 *
 * `serverBuildAt` gates it: with no server stamp we cannot tell "old client"
 * from "old server that never asked", and flagging every agent in that case
 * would make the signal worthless. Never keyed off the watermark — that can be
 * raised by a client, and one modern client must not retroactively indict rows
 * on a server too old to be reporting.
 */
export function buildUnknown(p: Participant, serverBuildAt: number): boolean {
  if (p.client !== 'cc' || hasBuildStamp(p)) return false;
  return Number.isFinite(serverBuildAt) && serverBuildAt > 0;
}

/**
 * How far behind the watermark this row's running code is, in ms. 0 means
 * current — or that we have no evidence either way (no stamp on the row, or no
 * watermark at all). Never negative: a client NEWER than the watermark is not
 * "behind by a negative amount", it is simply current (and it raised the
 * watermark itself).
 */
export function clientBehindMs(
  p: Participant,
  watermark: number,
  graceMs: number = CLIENT_BUILD_GRACE_MS,
): number {
  if (p.client !== 'cc' || !hasBuildStamp(p)) return 0;
  if (!(watermark > 0)) return 0;
  const behind = watermark - Number(p.clientBuildAt);
  return behind > graceMs ? behind : 0;
}
