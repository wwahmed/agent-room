// T-95 slice 1: the release pipeline as a durable, resumable state machine.
//
// The v1 deploy script (T-86) proved the stage->gate->approve->promote shape
// but the TechLead audit found 8 structural gaps. This module closes them:
//
//   1. Immutable artifacts: every build lands in releases/<full-sha>/dist,
//      hashed (artifactSha256) and chmod'd read-only. A release is never
//      rebuilt or mutated; a re-stage of the same SHA is refused.
//   2. Atomic pointer promotion: live serving is a symlink at apps/web/dist
//      pointing into a release dir. Promote and rollback are both a single
//      rename(2). The read-only artifact also makes the old "bare npm build
//      ships to live" hazard fail loudly instead of shipping.
//   3. Durable phases: staged / gate / approved / promoted live as JSON files
//      under releases/<sha>/phases/. A crashed or interrupted pipeline run
//      resumes from the recorded phase instead of restarting, and the staging
//      preview persists (detached server + pidfile) until a ruling.
//   4. Authenticated approver: approval is a "RELEASE-APPROVE <full-sha>"
//      message in the room, posted through the credentialed clients (web
//      session or memberkey proxy) by someone other than the builder. The
//      pipeline fetches it from the server and records message id + name.
//   5. Fixture tenancy: the gate runs against the staging port only; the
//      fixture-defining sources are hashed (fixtureManifestSha256) so a
//      receipt can prove which fixtures judged the release.
//   6. Post-hotfix debt: a hotfix promote writes .visual-gate/hotfix-pending;
//      only a fully-green NORMAL promote clears it - inside promote(), never
//      by hand.
//   7. Rollback: flip the pointer to the previous release and verify health.
//   8. Walkthrough receipts: a normal promote requires a validated
//      walkthrough receipt (scripts/validate-ux-walkthrough.mjs) unless the
//      release records an explicit, reasoned skip.
//
// Plain node ESM, no deps. bin/deploy-web and bin/rollback-web are thin
// wrappers over the CLI at the bottom.

import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';

export const APPROVAL_PREFIX = 'RELEASE-APPROVE';

export const paths = root => ({
  root,
  releases: join(root, 'releases'),
  current: join(root, 'releases', 'current'),
  previous: join(root, 'releases', 'previous'),
  liveLink: join(root, 'apps', 'web', 'dist'),
  gateState: join(root, '.visual-gate'),
  hotfixPending: join(root, '.visual-gate', 'hotfix-pending'),
  hotfixLog: join(root, '.visual-gate', 'hotfix-log.txt'),
  releaseLog: join(root, 'releases', 'release-log.txt'),
});

const nowIso = () => new Date().toISOString();
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

export function gitInfo(root) {
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const sha = run(['rev-parse', 'HEAD']);
  if (sha.status !== 0) throw new Error(`not a git repository: ${root}`);
  const dirty = run(['status', '--porcelain'])
    .stdout.split('\n')
    .filter(Boolean)
    .map(line => line.slice(3));
  const builder = run(['config', 'user.name']).stdout.trim() || 'unknown';
  return { fullSha: sha.stdout.trim(), shortSha: sha.stdout.trim().slice(0, 7), dirty, builder };
}

// Deterministic content hash of a directory tree: sha256 over the sorted
// list of "relative-path sha256(file)" lines. Symlinks hash their target.
export function hashDirectory(dir) {
  const lines = [];
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isSymbolicLink()) lines.push(`${relative(dir, full)} link:${readlinkSync(full)}`);
      else lines.push(`${relative(dir, full)} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
    }
  };
  walk(dir);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function hashFiles(files) {
  const h = createHash('sha256');
  for (const file of files) h.update(readFileSync(file));
  return h.digest('hex');
}

const readOnlyTree = dir => {
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      chmodSync(full, entry.isDirectory() ? 0o555 : 0o444);
    }
  };
  walk(dir);
  chmodSync(dir, 0o555);
};

// A promoted-then-superseded release dir has to become writable again before
// rm -rf can prune it; exported for ops use, never called by the pipeline.
export const writableTree = dir => {
  const walk = current => {
    chmodSync(current, 0o755);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else chmodSync(full, 0o644);
    }
  };
  walk(dir);
};

// Concurrent-invocation lock (contract item 3): one pipeline mutation at a
// time per repo. A lock whose pid is dead is stale and reclaimed with a log
// line; a live pid fails closed.
export function acquireLock(root, cmd = 'pipeline') {
  const p = paths(root);
  mkdirSync(p.releases, { recursive: true });
  const lockFile = join(p.releases, '.lock');
  if (existsSync(lockFile)) {
    const held = JSON.parse(readFileSync(lockFile, 'utf8'));
    let alive = false;
    try {
      process.kill(held.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`another pipeline run holds the lock (pid ${held.pid}, cmd ${held.cmd}, since ${held.at})`);
    writeFileSync(p.releaseLog, `${readFileSafe(p.releaseLog)}${nowIso()} stale-lock reclaimed (dead pid ${held.pid}, cmd ${held.cmd})\n`);
    rmSync(lockFile);
  }
  writeFileSync(lockFile, `${JSON.stringify({ pid: process.pid, cmd, at: nowIso() }, null, 2)}\n`);
  return () => rmSync(lockFile, { force: true });
}

// Recompute the artifact manifest and compare to the recorded hash (contract
// item 2): called by promote before any pointer moves, and exposed as a CLI
// for independent before/after verification.
export function verifyArtifact(root, fullSha) {
  const dir = releaseDir(root, fullSha);
  const meta = readJson(join(dir, 'meta.json'));
  const actual = hashDirectory(join(dir, 'dist'));
  if (actual !== meta.artifactSha256) {
    throw new Error(`artifact manifest mismatch for ${fullSha}: recorded ${meta.artifactSha256} recomputed ${actual} - the release was mutated; refusing`);
  }
  return { fullSha, artifactSha256: actual };
}

// Hotfix debt clears only when the promoted release CONTAINS the hotfix
// commit (contract item 7) - a green promote of unrelated work leaves the
// debt standing. Unknown/unresolvable markers fail closed (debt survives).
export function debtSettledBy(root, markerSha, promotedSha) {
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const expanded = run(['rev-parse', '--verify', `${markerSha.trim()}^{commit}`]);
  if (expanded.status !== 0) return false;
  return run(['merge-base', '--is-ancestor', expanded.stdout.trim(), promotedSha]).status === 0;
}

export const releaseDir = (root, fullSha) => join(paths(root).releases, fullSha);
export const phaseFile = (dir, name) => join(dir, 'phases', `${name}.json`);
export const hasPhase = (dir, name) => existsSync(phaseFile(dir, name));

export function writePhase(dir, name, data) {
  mkdirSync(join(dir, 'phases'), { recursive: true });
  writeFileSync(phaseFile(dir, name), `${JSON.stringify({ at: nowIso(), ...data }, null, 2)}\n`);
}

export const readPhase = (dir, name) => (hasPhase(dir, name) ? readJson(phaseFile(dir, name)) : null);

// ---------------------------------------------------------------- stage ----

export async function stage(root, opts = {}) {
  const { channel = 'normal', allowDirty = false, buildFn, fixtureFiles } = opts;
  const git = opts.gitInfo ?? gitInfo(root);
  if (git.dirty.length && !allowDirty) {
    throw new Error(
      `working tree is dirty (${git.dirty.length} paths) - an immutable release must map to a commit. ` +
        `Commit first, or set DEPLOY_ALLOW_DIRTY=1 to record the dirty list in the release meta.`,
    );
  }
  const dir = releaseDir(root, git.fullSha);
  if (hasPhase(dir, 'staged')) {
    if (channel === 'hotfix' || opts.reuse) return { dir, meta: readJson(join(dir, 'meta.json')), reused: true };
    throw new Error(`release ${git.fullSha} is already staged - releases are immutable (use status/promote, not re-stage)`);
  }
  const dist = join(dir, 'dist');
  if (existsSync(dist)) writableTree(dist); // a crashed stage may have left it read-only
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  if (buildFn) await buildFn(dist);
  else {
    const build = spawnSync('npm', ['-w', 'apps/web', 'run', 'build', '--', '--outDir', dist, '--emptyOutDir'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (build.status !== 0) throw new Error(`build failed (exit ${build.status})`);
  }

  const bundle = readdirSync(join(dist, 'assets')).find(f => /^index-.*\.js$/.test(f));
  if (!bundle) throw new Error('staged dist has no assets/index-*.js bundle');

  const fixtures = fixtureFiles ?? [join(root, 'scripts', 'visual-gate.mjs'), join(root, 'scripts', 'visual-gate-assertions.mjs')];
  const meta = {
    fullSha: git.fullSha,
    shortSha: git.shortSha,
    channel,
    builder: git.builder,
    dirty: git.dirty,
    bundle,
    artifactSha256: hashDirectory(dist),
    fixtureManifestSha256: hashFiles(fixtures.filter(existsSync)),
    stagedAt: nowIso(),
  };
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  readOnlyTree(dist);
  writePhase(dir, 'staged', { channel, bundle, artifactSha256: meta.artifactSha256, dirty: git.dirty });
  return { dir, meta, reused: false };
}

// ------------------------------------------------------------- staging -----

export function stagingInfo(dir) {
  const file = join(dir, 'staging.json');
  if (!existsSync(file)) return null;
  const info = readJson(file);
  try {
    process.kill(info.pid, 0);
    return info;
  } catch {
    return null; // recorded server is gone; caller restarts it
  }
}

export function serveStaging(root, dir, { port, serverCmd } = {}) {
  const running = stagingInfo(dir);
  if (running) return running;
  const stagingPort = port ?? Number(process.env.STAGING_PORT ?? 8220);
  const [cmd, ...args] = serverCmd ?? ['node', join(root, 'apps', 'server', 'dist', 'index.js')];
  const log = join(dir, 'staging-server.log');
  const logFd = openSync(log, 'a');
  const child = spawn(cmd, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, WEB_DIST: join(dir, 'dist'), PORT: String(stagingPort) },
  });
  child.unref();
  closeSync(logFd);
  const info = { pid: child.pid, port: stagingPort, startedAt: nowIso(), log };
  writeFileSync(join(dir, 'staging.json'), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

export async function waitForHealth(url, { attempts = 40, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

// ---------------------------------------------------------------- gate -----

export function recordGate(root, dir, { exitCode, acked = false, base }) {
  const green = exitCode === 0;
  const ackable = exitCode === 2 || exitCode === 3;
  if (!green && !(ackable && acked)) {
    throw new Error(`gate exit ${exitCode} is not green${ackable ? ' (pixel diffs need VISUAL_GATE_ACK=1)' : ' and never acknowledgeable'}`);
  }
  const reportSrc = join(paths(root).gateState, 'last-report.txt');
  let gateResultSha256 = null;
  if (existsSync(reportSrc)) {
    const copy = join(dir, 'gate-report.txt');
    writeFileSync(copy, readFileSync(reportSrc));
    gateResultSha256 = createHash('sha256').update(readFileSync(copy)).digest('hex');
  }
  writePhase(dir, 'gate', { exitCode, acked, base, gateResultSha256 });
  return { gateResultSha256 };
}

// ------------------------------------------------------------- approval ----

// Approval is a room message "RELEASE-APPROVE <full-sha> ..." from someone
// other than the builder. Sender identity is enforced by the SERVER's send
// path (authenticateSender: a keyed row refuses any send without its
// memberKey; a display name never authenticates), so a message in the log
// from a keyed participant is server-attested. The pipeline additionally
// refuses approvers whose participant row carries no credential hash at all
// (legacy keyless rows are exactly the spoofable ones).
export function parseApproval(messages, { fullSha, builder, participants }) {
  const attested = name => {
    if (!participants) return true; // caller vouches (tests exercise both paths)
    const row = participants.find(p => (p.name ?? '').trim() === (name ?? '').trim());
    return Boolean(row && (row.memberKeyHash || row.authIdHash));
  };
  for (const msg of [...messages].reverse()) {
    const text = (msg.text ?? '').trim();
    if (!text.startsWith(`${APPROVAL_PREFIX} ${fullSha}`)) continue;
    if ((msg.name ?? '').trim() === builder) continue; // self-approval never counts
    if (!attested(msg.name)) continue; // keyless identity cannot approve
    return { approver: msg.name, messageId: msg.id, messageTime: msg.time, text };
  }
  return null;
}

export async function fetchApproval(root, dir, { apiBase, roomCode }) {
  const meta = readJson(join(dir, 'meta.json'));
  const call = body =>
    fetch(`${apiBase}/api/room`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: roomCode, ...body }),
    });
  const msgRes = await call({ action: 'messages' });
  if (!msgRes.ok) throw new Error(`could not fetch room messages (${msgRes.status})`);
  const { messages = [] } = await msgRes.json();
  const roomRes = await call({ action: 'get' });
  if (!roomRes.ok) throw new Error(`could not fetch room participants (${roomRes.status})`);
  const participants = (await roomRes.json()).room?.participants ?? [];
  const approval = parseApproval(messages, { fullSha: meta.fullSha, builder: meta.builder, participants });
  if (!approval) return null;
  writePhase(dir, 'approved', { ...approval, roomCode });
  return approval;
}

// ------------------------------------------------------------ walkthrough --

export async function recordWalkthrough(root, dir, { receiptPath, skipReason }) {
  if (skipReason) {
    writePhase(dir, 'walkthrough', { skipped: true, reason: skipReason });
    return { skipped: true };
  }
  const { validateWalkthrough } = await import('./validate-ux-walkthrough.mjs');
  const receipt = readJson(receiptPath);
  const findings = validateWalkthrough(receipt);
  if (findings.length) throw new Error(`walkthrough receipt invalid:\n  ${findings.join('\n  ')}`);
  const copy = join(dir, 'walkthrough-receipt.json');
  writeFileSync(copy, readFileSync(receiptPath));
  writePhase(dir, 'walkthrough', { receiptSha256: createHash('sha256').update(readFileSync(copy)).digest('hex') });
  return { skipped: false };
}

// -------------------------------------------------------------- promote ----

export function atomicPointSymlink(linkPath, target) {
  const tmp = `${linkPath}.next-${process.pid}`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, linkPath); // rename over an existing symlink is atomic
}

export const pointerTarget = linkPath => {
  try {
    return lstatSync(linkPath).isSymbolicLink() ? resolve(dirname(linkPath), readlinkSync(linkPath)) : null;
  } catch {
    return null;
  }
};

// First promotion on a machine whose apps/web/dist is still a real directory:
// preserve it - AND its dist.prev rollback sibling if one exists (the
// pre-hotfix bundle) - as imported releases so neither state is orphaned.
export function importLegacyDist(root) {
  const p = paths(root);
  if (!existsSync(p.liveLink) || lstatSync(p.liveLink).isSymbolicLink()) return null;
  const importOne = (src, name) => {
    const dir = join(p.releases, name);
    mkdirSync(dir, { recursive: true });
    renameSync(src, join(dir, 'dist'));
    const assets = join(dir, 'dist', 'assets');
    const bundle = existsSync(assets) ? readdirSync(assets).find(f => /^index-.*\.js$/.test(f)) : undefined;
    writeFileSync(
      join(dir, 'meta.json'),
      `${JSON.stringify({ fullSha: name, channel: 'imported', bundle, importedAt: nowIso(), artifactSha256: hashDirectory(join(dir, 'dist')) }, null, 2)}\n`,
    );
    writePhase(dir, 'staged', { channel: 'imported' });
    return dir;
  };
  const stamp = Date.now();
  const prevReal = `${p.liveLink}.prev`;
  const prevDir = existsSync(prevReal) && !lstatSync(prevReal).isSymbolicLink() ? importOne(prevReal, `imported-prev-${stamp}`) : null;
  const liveDir = importOne(p.liveLink, `imported-${stamp}`);
  return { liveDir, prevDir };
}

export async function promote(root, fullSha, opts = {}) {
  const { channel = 'normal', by = 'unknown', reason, liveUrl } = opts;
  const p = paths(root);
  const dir = releaseDir(root, fullSha);
  if (!hasPhase(dir, 'staged')) throw new Error(`release ${fullSha} is not staged`);
  const meta = readJson(join(dir, 'meta.json'));

  if (channel === 'normal') {
    const gate = readPhase(dir, 'gate');
    if (!gate) throw new Error('promote refused: no gate phase (run the visual gate against staging first)');
    if (!hasPhase(dir, 'approved')) throw new Error(`promote refused: no approval - a non-builder must post "${APPROVAL_PREFIX} ${fullSha}" in the room`);
    if (!hasPhase(dir, 'walkthrough')) throw new Error('promote refused: no walkthrough phase (validate a receipt or record an explicit skip with a reason)');
  } else if (channel === 'hotfix') {
    mkdirSync(p.gateState, { recursive: true });
    writeFileSync(p.hotfixPending, `${fullSha}\n`);
    writeFileSync(p.hotfixLog, `${readFileSafe(p.hotfixLog)}${nowIso()} ${fullSha} by=${by} reason=${reason ?? 'unspecified'}\n`);
  } else {
    throw new Error(`unknown channel: ${channel}`);
  }

  verifyArtifact(root, fullSha); // build-once proof: never flip onto a mutated artifact

  const legacy = importLegacyDist(root);
  const previousTarget = pointerTarget(p.current) ?? legacy?.liveDir ?? null;
  mkdirSync(p.releases, { recursive: true });
  if (previousTarget) atomicPointSymlink(p.previous, previousTarget);
  atomicPointSymlink(p.current, dir);
  atomicPointSymlink(p.liveLink, join(dir, 'dist'));

  if (liveUrl) {
    const healthy = await waitForHealth(`${liveUrl}/healthz`, { attempts: 10, delayMs: 300 });
    const bundleHash = meta.bundle?.replace(/^index-|\.js$/g, '');
    let serving = false;
    if (healthy && bundleHash) {
      try {
        serving = (await (await fetch(`${liveUrl}/`)).text()).includes(bundleHash);
      } catch {
        serving = false;
      }
    }
    if (!healthy || !serving) {
      if (previousTarget) {
        atomicPointSymlink(p.liveLink, join(previousTarget, 'dist'));
        atomicPointSymlink(p.current, previousTarget);
      } else {
        // First-ever promote with nothing to fall back to: restore the
        // pre-promote absence rather than leave a failed release live.
        rmSync(p.liveLink, { force: true });
        rmSync(p.current, { force: true });
      }
      throw new Error(`live verification failed after promote (healthy=${healthy} serving=${serving}) - pointer restored`);
    }
  }

  // Hotfix debt settles ONLY when a fully-green normal promote ships a
  // release that contains the hotfix commit (gap 6 + contract item 7).
  if (channel === 'normal' && readPhase(dir, 'gate')?.exitCode === 0 && existsSync(p.hotfixPending)) {
    const marker = readFileSync(p.hotfixPending, 'utf8').trim();
    if (debtSettledBy(root, marker, fullSha)) rmSync(p.hotfixPending);
    else writeFileSync(p.releaseLog, `${readFileSafe(p.releaseLog)}${nowIso()} hotfix debt ${marker} NOT settled by ${fullSha} (not an ancestor)\n`);
  }
  writePhase(dir, 'promoted', { channel, by, reason });
  writeFileSync(p.releaseLog, `${readFileSafe(p.releaseLog)}${nowIso()} promote ${fullSha} channel=${channel} by=${by}\n`);
  return { dir, previousTarget };
}

const readFileSafe = file => (existsSync(file) ? readFileSync(file, 'utf8') : '');

// -------------------------------------------------------------- rollback ---

export async function rollback(root, { liveUrl, by = 'unknown' } = {}) {
  const p = paths(root);
  const from = pointerTarget(p.current);
  const to = pointerTarget(p.previous);
  if (!to) throw new Error('no previous release pointer - nothing to roll back to');
  atomicPointSymlink(p.liveLink, join(to, 'dist'));
  atomicPointSymlink(p.current, to);
  if (from) atomicPointSymlink(p.previous, from);
  if (liveUrl) {
    const healthy = await waitForHealth(`${liveUrl}/healthz`, { attempts: 10, delayMs: 300 });
    if (!healthy) throw new Error('live unhealthy after rollback - investigate immediately');
    // Served-hash check (contract item 8): the page must reference the
    // rolled-back release's bundle, not merely answer healthz.
    const bundleHash = readJson(join(to, 'meta.json')).bundle?.replace(/^index-|\.js$/g, '');
    if (bundleHash) {
      const serving = (await (await fetch(`${liveUrl}/`)).text()).includes(bundleHash);
      if (!serving) throw new Error(`live is healthy but not serving the rolled-back bundle index-${bundleHash}.js - investigate immediately`);
    }
  }
  writeFileSync(p.releaseLog, `${readFileSafe(p.releaseLog)}${nowIso()} rollback to=${to} from=${from ?? 'none'} by=${by}\n`);
  return { from, to };
}

// ---------------------------------------------------------------- status ---

export function status(root) {
  const p = paths(root);
  const out = {
    current: pointerTarget(p.current),
    previous: pointerTarget(p.previous),
    liveLink: pointerTarget(p.liveLink),
    hotfixPending: existsSync(p.hotfixPending) ? readFileSync(p.hotfixPending, 'utf8').trim() : null,
    releases: [],
  };
  if (existsSync(p.releases)) {
    for (const name of readdirSync(p.releases).sort()) {
      const dir = join(p.releases, name);
      if (!statSync(dir).isDirectory()) continue;
      const phases = existsSync(join(dir, 'phases'))
        ? readdirSync(join(dir, 'phases')).map(f => f.replace(/\.json$/, ''))
        : [];
      out.releases.push({ name, phases });
    }
  }
  return out;
}

// ------------------------------------------------------------------ CLI ----

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const root = resolve(process.env.RP_ROOT ?? process.cwd());
  const liveUrl = process.env.RP_LIVE_URL ?? 'http://127.0.0.1:8210';
  const MUTATING = ['stage', 'gate', 'walkthrough', 'promote', 'rollback'];
  let release = () => {};
  try {
    if (MUTATING.includes(cmd)) release = acquireLock(root, cmd);
    if (cmd === 'verify') {
      const { fullSha, artifactSha256 } = verifyArtifact(root, args[0] ?? gitInfo(root).fullSha);
      console.log(`verified ${fullSha} artifact ${artifactSha256}`);
    } else if (cmd === 'stage') {
      const { meta, reused } = await stage(root, {
        channel: process.env.DEPLOY_HOTFIX === '1' ? 'hotfix' : 'normal',
        allowDirty: process.env.DEPLOY_ALLOW_DIRTY === '1',
        reuse: true,
      });
      console.log(`${reused ? 'reusing staged' : 'staged'} ${meta.fullSha} bundle=${meta.bundle} artifact=${meta.artifactSha256.slice(0, 12)}`);
    } else if (cmd === 'gate') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      const dir = releaseDir(root, sha);
      recordGate(root, dir, {
        exitCode: Number(args[1] ?? 0),
        acked: process.env.VISUAL_GATE_ACK === '1',
        base: process.env.VISUAL_GATE_BASE,
      });
      console.log(`gate recorded for ${sha}`);
    } else if (cmd === 'approve-check') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      const approval = await fetchApproval(root, releaseDir(root, sha), {
        apiBase: liveUrl,
        roomCode: process.env.RELEASE_ROOM ?? readFileSafe(join(root, '.visual-gate', 'release-room.txt')).trim(),
      });
      if (!approval) {
        console.log(`no approval yet: a non-builder must post "${APPROVAL_PREFIX} ${sha}" in the room`);
        process.exitCode = 6;
      } else console.log(`approved by ${approval.approver} (msg ${approval.messageId})`);
    } else if (cmd === 'walkthrough') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      await recordWalkthrough(root, releaseDir(root, sha), {
        receiptPath: process.env.WALKTHROUGH_RECEIPT,
        skipReason: process.env.WALKTHROUGH_SKIP_REASON,
      });
      console.log(`walkthrough recorded for ${sha}`);
    } else if (cmd === 'promote') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      await promote(root, sha, {
        channel: process.env.DEPLOY_HOTFIX === '1' ? 'hotfix' : 'normal',
        by: process.env.DEPLOY_BY ?? gitInfo(root).builder,
        reason: process.env.DEPLOY_REASON,
        liveUrl,
      });
      console.log(`promoted ${sha}`);
    } else if (cmd === 'rollback') {
      const { to } = await rollback(root, { liveUrl, by: process.env.DEPLOY_BY ?? 'unknown' });
      console.log(`rolled back to ${to}`);
    } else if (cmd === 'status') {
      console.log(JSON.stringify(status(root), null, 2));
    } else {
      console.error('usage: release-pipeline.mjs <stage|gate|approve-check|walkthrough|verify|promote|rollback|status> [sha]');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exitCode = 1;
  } finally {
    release();
  }
}

if (process.argv[1]?.endsWith('release-pipeline.mjs')) await main();
