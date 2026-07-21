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

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  linkSync,
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

// Concurrent-invocation lock (contract item 3). Acquisition is an atomic
// mkdir - exactly one of N simultaneous processes can create the directory.
// The holder records pid AND process start time, so a recycled pid does not
// impersonate the holder. Stale reclaim is serialized through an atomic
// rename: only the process that wins the rename may retry the mkdir.
const processStart = pid => {
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null; // null = no such process
};

export function acquireLock(root, cmd = 'pipeline') {
  const p = paths(root);
  mkdirSync(p.releases, { recursive: true });
  const lockDir = join(p.releases, '.lock');
  const metaFile = join(lockDir, 'holder.json');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(lockDir); // atomic: exactly one creator
      writeFileSync(metaFile, `${JSON.stringify({ pid: process.pid, start: processStart(process.pid), cmd, at: nowIso() }, null, 2)}\n`);
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const readHolder = () => {
        try {
          return JSON.parse(readFileSync(metaFile, 'utf8'));
        } catch {
          return null;
        }
      };
      let held = readHolder();
      if (!held) {
        // A LIVE creator sits between mkdir and its holder write for a few
        // milliseconds - grace-wait and re-read before calling it crashed,
        // or a concurrent acquirer could rob a healthy holder.
        spawnSync('sleep', ['0.15']);
        held = readHolder();
      }
      const liveStart = held ? processStart(held.pid) : null;
      const holderAlive = held && liveStart !== null && liveStart === held.start;
      if (holderAlive) throw new Error(`another pipeline run holds the lock (pid ${held.pid}, cmd ${held.cmd}, since ${held.at})`);
      // Stale (dead pid, or a recycled pid with a different start time).
      // Serialize the reclaim: rename is atomic, only one process wins.
      const tomb = join(p.releases, `.lock-reclaimed-${process.pid}-${attempt}`);
      try {
        renameSync(lockDir, tomb);
      } catch {
        continue; // another process won the reclaim; retry acquisition
      }
      rmSync(tomb, { recursive: true, force: true });
      writeFileSync(
        p.releaseLog,
        `${readFileSafe(p.releaseLog)}${nowIso()} stale-lock reclaimed (pid ${held?.pid ?? 'unknown'} ${held ? (liveStart === null ? 'dead' : 'pid-reused') : 'no-holder-record'}, cmd ${held?.cmd ?? '?'})\n`,
      );
    }
  }
  throw new Error('could not acquire the pipeline lock after contended reclaim attempts');
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

// Hotfix debt marker: JSON recording EVERY unaudited hotfix commit plus the
// served-artifact digest at the time of recording. (The v1 marker was a bare
// short SHA written only on the first hotfix - it under-recorded; legacy
// bare-SHA markers are still parsed.) Debt settles only when the promoted
// release contains ALL recorded commits AND its gate is fully green - a
// green promote of unrelated work leaves the debt standing, and an
// unresolvable commit fails closed (debt survives).
export function readDebt(root) {
  const p = paths(root);
  if (!existsSync(p.hotfixPending)) return null;
  const raw = readFileSync(p.hotfixPending, 'utf8').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { commits: [raw], legacy: true };
  }
}

export function recordDebt(root, { fullSha, artifactSha256 }) {
  const p = paths(root);
  mkdirSync(p.gateState, { recursive: true });
  const existing = readDebt(root) ?? { commits: [] };
  const commits = [...new Set([...existing.commits, fullSha])];
  writeFileSync(p.hotfixPending, `${JSON.stringify({ commits, artifactSha256, recordedAt: nowIso() }, null, 2)}\n`);
}

export function debtSettledBy(root, debt, promotedSha) {
  const run = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const commits = debt?.commits ?? [];
  if (!commits.length) return false;
  return commits.every(commit => {
    const expanded = run(['rev-parse', '--verify', `${commit.trim()}^{commit}`]);
    if (expanded.status !== 0) return false;
    return run(['merge-base', '--is-ancestor', expanded.stdout.trim(), promotedSha]).status === 0;
  });
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
  const { channel = 'normal', buildFn, fixtureFiles } = opts;
  const git = opts.gitInfo ?? gitInfo(root);
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
    // Build from an ISOLATED clean worktree of exactly this commit - the
    // shared checkout is never read, so uncommitted changes there (another
    // builder's WIP) cannot enter the artifact, and a dirty tree is simply
    // irrelevant rather than a blocker.
    const wt = join(paths(root).releases, `.build-${git.fullSha}`);
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
    const add = spawnSync('git', ['worktree', 'add', '--detach', wt, git.fullSha], { cwd: root, encoding: 'utf8' });
    if (add.status !== 0) throw new Error(`could not create build worktree: ${add.stderr}`);
    try {
      if (existsSync(join(root, 'node_modules')) && !existsSync(join(wt, 'node_modules'))) {
        symlinkSync(join(root, 'node_modules'), join(wt, 'node_modules'));
      }
      if (process.env.RP_CRASH_POINT === 'mid-build') process.exit(137); // test hook: only ever makes runs FAIL
      const build = spawnSync('npm', ['-w', 'apps/web', 'run', 'build', '--', '--outDir', dist, '--emptyOutDir'], {
        cwd: wt,
        stdio: 'inherit',
      });
      if (build.status !== 0) throw new Error(`build failed (exit ${build.status})`);
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
    }
  }

  const bundle = readdirSync(join(dist, 'assets')).find(f => /^index-.*\.js$/.test(f));
  if (!bundle) throw new Error('staged dist has no assets/index-*.js bundle');

  const fixtures = fixtureFiles ?? [join(root, 'scripts', 'visual-gate.mjs'), join(root, 'scripts', 'visual-gate-assertions.mjs')];
  const meta = {
    fullSha: git.fullSha,
    shortSha: git.shortSha,
    channel,
    builder: git.builder,
    bundle,
    artifactSha256: hashDirectory(dist),
    fixtureManifestSha256: hashFiles(fixtures.filter(existsSync)),
    stagedAt: nowIso(),
  };
  writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  readOnlyTree(dist);
  writePhase(dir, 'staged', { channel, bundle, artifactSha256: meta.artifactSha256 });
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

export function killStaging(dir) {
  const info = stagingInfo(dir);
  if (!info) return false;
  try {
    process.kill(-info.pid);
  } catch {
    try {
      process.kill(info.pid);
    } catch {
      /* already gone */
    }
  }
  return true;
}

// Collision-safe port allocation: probe a bounded range and take the first
// port nothing answers on. Anything answering - ours or not - is skipped.
export async function allocStagingPort(base = 8220, span = 30) {
  for (let port = base; port < base + span; port++) {
    try {
      await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(300) });
    } catch {
      return port; // connection refused/timeout = free
    }
  }
  throw new Error(`no free staging port in ${base}..${base + span - 1}`);
}

// The preview is bound to the exact release: staging.json records the full
// SHA and artifact digest, and verifyStagingServing proves the port is
// serving THIS release's bundle - "still serving" something is not enough.
export async function serveStaging(root, dir, { port, serverCmd } = {}) {
  const meta = readJson(join(dir, 'meta.json'));
  const running = stagingInfo(dir);
  if (running) {
    if (await verifyStagingServing(dir, running)) return running;
    killStaging(dir); // stale process serving the wrong thing: clean it up
  }
  const stagingPort = port ?? Number(process.env.STAGING_PORT ?? (await allocStagingPort()));
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
  const info = { pid: child.pid, port: stagingPort, fullSha: meta.fullSha, artifactSha256: meta.artifactSha256, startedAt: nowIso(), log };
  writeFileSync(join(dir, 'staging.json'), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

export async function verifyStagingServing(dir, info) {
  const meta = readJson(join(dir, 'meta.json'));
  const bundleHash = meta.bundle?.replace(/^index-|\.js$/g, '');
  try {
    const html = await (await fetch(`http://127.0.0.1:${info.port}/`, { signal: AbortSignal.timeout(2000) })).text();
    return Boolean(bundleHash && html.includes(bundleHash));
  } catch {
    return false;
  }
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

// Release approval model.
//
// Identity attestation is the SERVER's: authenticateSender refuses any send
// for a keyed row without that row's memberKey ("a display name alone cannot
// authenticate"), and it throws BEFORE the message is stored. So a message
// in the log from a keyed participant was necessarily posted by the key
// holder. What the pipeline enforces on top:
//   - the approval text must bind the FULL SHA, the artifact digest, the
//     gate-result digest, and a per-release challenge nonce - so an approval
//     can never be replayed against a rebuilt, tampered, or different
//     release, and a stale approval from last week matches nothing;
//   - the approver must be a (name, client) pair from the committed
//     approvers registry (scripts/release-approvers.json) with a live
//     participant row - an impostor joining under a taken name gets a
//     suffixed row and matches nothing;
//   - no identity in the builder's registered lineage (base-name match, so
//     "ClaudeUI (3)" is still the builder's operator) can approve.
// Residual gap, held openly: the public room payload strips credential
// hashes, so the pipeline cannot itself see whether a row is keyed. The
// verifier's live wrong-key probe covers that today; a server-exposed
// per-row `keyed` flag is the T-96 closure.
export const approvalLine = ({ fullSha, artifactSha256, gateResultSha256, nonce, policyDigest }) =>
  `${APPROVAL_PREFIX} ${fullSha} artifact=${artifactSha256} gate=${gateResultSha256} policy=${policyDigest} nonce=${nonce}`;

// The policy file lives in the builder-writable repo, so the line binds its
// digest: the approver attests the exact policy version the approval was
// granted under, and a builder-tampered registry produces a digest the
// approver will refuse to post. (Server-held policy is the T-96 closure.)
export const policyDigestOf = root => createHash('sha256').update(readFileSync(join(root, 'scripts', 'release-approvers.json'))).digest('hex');

const baseName = name => (name ?? '').trim().replace(/ \(\d+\)$/, '');

export function parseApproval(messages, { fullSha, artifactSha256, gateResultSha256, nonce, policyDigest, registry, participants }) {
  const expected = approvalLine({ fullSha, artifactSha256, gateResultSha256, nonce, policyDigest });
  const builderBases = new Set((registry.builderLineages ?? []).flatMap(l => l.baseNames));
  for (const msg of [...messages].reverse()) {
    const text = (msg.text ?? '').trim();
    if (!(text === expected || text.startsWith(`${expected} `))) continue;
    const name = (msg.name ?? '').trim();
    if (builderBases.has(baseName(name))) continue; // builder lineage can never approve
    const entry = (registry.approvers ?? []).find(a => a.name === name);
    if (!entry) continue; // not an authorized approver
    if (participants && !participants.some(p => (p.name ?? '').trim() === name && p.client === entry.client)) continue;
    return { approver: name, client: entry.client, messageId: msg.id, messageTime: msg.time, text };
  }
  return null;
}

export function issueChallenge(root, dir) {
  const meta = readJson(join(dir, 'meta.json'));
  const gate = readPhase(dir, 'gate');
  if (!gate?.gateResultSha256) throw new Error('challenge refused: run the gate first (approval binds the gate-result digest)');
  const existing = readPhase(dir, 'challenge');
  if (existing) return existing;
  const nonce = randomBytes(8).toString('hex');
  const policyDigest = policyDigestOf(root);
  const line = approvalLine({ fullSha: meta.fullSha, artifactSha256: meta.artifactSha256, gateResultSha256: gate.gateResultSha256, nonce, policyDigest });
  writePhase(dir, 'challenge', { nonce, policyDigest, line });
  return { nonce, policyDigest, line };
}

export function loadRegistry(root) {
  return readJson(join(root, 'scripts', 'release-approvers.json'));
}

export async function fetchApproval(root, dir, { apiBase, roomCode, registry }) {
  const meta = readJson(join(dir, 'meta.json'));
  const gate = readPhase(dir, 'gate');
  const challenge = readPhase(dir, 'challenge');
  if (!challenge) throw new Error('no challenge issued for this release - run challenge first and post its line for the approver');
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
  const livePolicyDigest = policyDigestOf(root);
  if (livePolicyDigest !== challenge.policyDigest) {
    throw new Error(`approver policy changed since the challenge was issued (${challenge.policyDigest.slice(0, 12)} -> ${livePolicyDigest.slice(0, 12)}) - re-ratify the policy and reissue the challenge`);
  }
  const approval = parseApproval(messages, {
    fullSha: meta.fullSha,
    artifactSha256: meta.artifactSha256,
    gateResultSha256: gate?.gateResultSha256,
    nonce: challenge.nonce,
    policyDigest: challenge.policyDigest,
    registry: registry ?? loadRegistry(root),
    participants,
  });
  if (!approval) return null;
  writePhase(dir, 'approved', { ...approval, roomCode, nonce: challenge.nonce, policyDigest: challenge.policyDigest });
  return approval;
}

// ------------------------------------------------------------ walkthrough --

// No skip path: a normal promote requires a schema-valid receipt whose
// digests match THIS release - a receipt written against any other artifact,
// fixture set, or gate result refuses mechanically.
export async function recordWalkthrough(root, dir, { receiptPath }) {
  if (!receiptPath) throw new Error('walkthrough receipt required (WALKTHROUGH_RECEIPT=path) - there is no skip');
  const { validateWalkthrough } = await import('./validate-ux-walkthrough.mjs');
  const receipt = readJson(receiptPath);
  const findings = validateWalkthrough(receipt);
  if (findings.length) throw new Error(`walkthrough receipt invalid:\n  ${findings.join('\n  ')}`);
  const meta = readJson(join(dir, 'meta.json'));
  const gate = readPhase(dir, 'gate');
  const mismatches = [
    ['fullSha', meta.fullSha],
    ['artifactSha256', meta.artifactSha256],
    ['fixtureManifestSha256', meta.fixtureManifestSha256],
    ['gateResultSha256', gate?.gateResultSha256],
  ].filter(([field, expected]) => receipt.release?.[field] !== expected);
  if (mismatches.length) {
    throw new Error(
      `walkthrough receipt does not match this release: ${mismatches.map(([f, e]) => `${f} (expected ${e ?? 'unset-gate'})`).join(', ')}`,
    );
  }
  const copy = join(dir, 'walkthrough-receipt.json');
  writeFileSync(copy, readFileSync(receiptPath));
  writePhase(dir, 'walkthrough', { receiptSha256: createHash('sha256').update(readFileSync(copy)).digest('hex') });
  return { bound: true };
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

// An atomic directory pointer is not an atomic PAGE LOAD: a client can fetch
// the old index.html, the pointer flips, and its subsequent asset requests
// would 404 in the new release. Each promotion therefore serves a derived
// serve/ dir: the release's own dist plus hard links to the previous
// release's content-hashed assets (retained asset union, additive only).
// The immutable dist/ is untouched - the artifact digest covers it alone;
// serve/ is derived, rebuildable, and recorded with its own digest.
export function buildServeDir(dir, previousTarget) {
  const serve = join(dir, 'serve');
  rmSync(serve, { recursive: true, force: true });
  cpSync(join(dir, 'dist'), serve, { recursive: true });
  const walkAssets = base => {
    const assets = join(base, 'assets');
    return existsSync(assets) ? readdirSync(assets) : [];
  };
  let retained = 0;
  if (previousTarget) {
    const prevBase = existsSync(join(previousTarget, 'serve')) ? join(previousTarget, 'serve') : join(previousTarget, 'dist');
    mkdirSync(join(serve, 'assets'), { recursive: true });
    for (const name of walkAssets(prevBase)) {
      const dest = join(serve, 'assets', name);
      if (!existsSync(dest)) {
        linkSync(join(prevBase, 'assets', name), dest);
        retained++;
      }
    }
  }
  writeFileSync(
    join(dir, 'serve-manifest.json'),
    `${JSON.stringify({ serveSha256: hashDirectory(serve), retainedAssets: retained, unionFrom: previousTarget ?? null, builtAt: nowIso() }, null, 2)}\n`,
  );
  return serve;
}

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
  if (hasPhase(dir, 'promoted') && pointerTarget(p.current) === dir) {
    return { dir, previousTarget: pointerTarget(p.previous), alreadyPromoted: true };
  }
  const meta = readJson(join(dir, 'meta.json'));

  if (channel === 'normal') {
    const gate = readPhase(dir, 'gate');
    if (!gate) throw new Error('promote refused: no gate phase (run the visual gate against staging first)');
    if (!hasPhase(dir, 'approved')) throw new Error(`promote refused: no approval - a non-builder must post "${APPROVAL_PREFIX} ${fullSha}" in the room`);
    if (!hasPhase(dir, 'walkthrough')) throw new Error('promote refused: no walkthrough phase (a digest-matching T-89 receipt is required; there is no skip)');
  } else if (channel === 'hotfix') {
    recordDebt(root, { fullSha, artifactSha256: meta.artifactSha256 });
    writeFileSync(p.hotfixLog, `${readFileSafe(p.hotfixLog)}${nowIso()} ${fullSha} by=${by} reason=${reason ?? 'unspecified'}\n`);
  } else {
    throw new Error(`unknown channel: ${channel}`);
  }

  verifyArtifact(root, fullSha); // build-once proof: never flip onto a mutated artifact

  const legacy = importLegacyDist(root);
  const previousTarget = pointerTarget(p.current) ?? legacy?.liveDir ?? null;
  mkdirSync(p.releases, { recursive: true });
  const serve = buildServeDir(dir, previousTarget);
  if (previousTarget) atomicPointSymlink(p.previous, previousTarget);
  atomicPointSymlink(p.current, dir);
  atomicPointSymlink(p.liveLink, serve);
  if (process.env.RP_CRASH_POINT === 'after-pointer-flip') process.exit(137); // test hook: only ever makes runs FAIL

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
        atomicPointSymlink(p.liveLink, buildServeDir(previousTarget, dir));
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
  // release containing EVERY recorded hotfix commit (gap 6 + contract 7).
  const debt = channel === 'normal' && readPhase(dir, 'gate')?.exitCode === 0 ? readDebt(root) : null;
  if (debt) {
    if (debtSettledBy(root, debt, fullSha)) rmSync(p.hotfixPending);
    else
      writeFileSync(
        p.releaseLog,
        `${readFileSafe(p.releaseLog)}${nowIso()} hotfix debt [${debt.commits.join(', ')}] NOT settled by ${fullSha} (not all ancestors)\n`,
      );
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
  // Union from the release being left, so in-flight pages loaded from it
  // can still resolve their hashed assets after the flip.
  atomicPointSymlink(p.liveLink, buildServeDir(to, from));
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

// -------------------------------------------------------------- reconcile --

// Crash repair for the dangerous window between the pointer rename and the
// promoted-phase write (and during automatic restore). Reads the actual
// pointer, the phase journal, and - when a live URL is given - the served
// bundle, then either completes the interrupted promote (only if every
// precondition still verifies) or restores the previous pointer. Never
// guesses, never double-flips.
export async function reconcile(root, { liveUrl } = {}) {
  const p = paths(root);
  const target = pointerTarget(p.current);
  if (!target) return { state: 'clean', detail: 'no current pointer' };
  const dir = target;
  const meta = readJson(join(dir, 'meta.json'));
  if (hasPhase(dir, 'promoted')) return { state: 'consistent', release: meta.fullSha };

  // Pointer moved but the promote never finished. Re-verify everything the
  // promote itself would have demanded.
  const preconditions =
    meta.channel === 'hotfix' || meta.channel === 'imported'
      ? hasPhase(dir, 'staged')
      : hasPhase(dir, 'staged') && hasPhase(dir, 'gate') && hasPhase(dir, 'approved') && hasPhase(dir, 'walkthrough');
  let artifactOk = false;
  try {
    verifyArtifact(root, meta.fullSha);
    artifactOk = true;
  } catch {
    artifactOk = false;
  }
  let servingOk = true;
  if (liveUrl) {
    const bundleHash = meta.bundle?.replace(/^index-|\.js$/g, '');
    try {
      servingOk = Boolean(bundleHash) && (await (await fetch(`${liveUrl}/`)).text()).includes(bundleHash);
    } catch {
      servingOk = false;
    }
  }
  if (preconditions && artifactOk && servingOk && pointerTarget(p.liveLink) === join(dir, 'serve')) {
    writePhase(dir, 'promoted', { channel: meta.channel, by: 'reconcile', reason: 'completed after interrupted promote' });
    writeFileSync(p.releaseLog, `${readFileSafe(p.releaseLog)}${nowIso()} reconcile completed promote ${meta.fullSha}\n`);
    return { state: 'completed', release: meta.fullSha };
  }
  const previous = pointerTarget(p.previous);
  if (previous) {
    atomicPointSymlink(p.liveLink, buildServeDir(previous, dir));
    atomicPointSymlink(p.current, previous);
    // The failed release is not a valid rollback target, and the true
    // previous-previous is unknown: drop the pointer rather than leave a
    // degenerate current==previous pair that makes rollback a no-op.
    rmSync(p.previous, { force: true });
  } else {
    rmSync(p.liveLink, { force: true });
    rmSync(p.current, { force: true });
  }
  writeFileSync(
    p.releaseLog,
    `${readFileSafe(p.releaseLog)}${nowIso()} reconcile restored ${previous ?? '(absence)'} - interrupted promote of ${meta.fullSha} failed verification (preconditions=${preconditions} artifact=${artifactOk} serving=${servingOk})\n`,
  );
  return { state: 'restored', release: meta.fullSha, to: previous ?? null };
}

// ---------------------------------------------------------------- status ---

export function status(root) {
  const p = paths(root);
  const out = {
    current: pointerTarget(p.current),
    previous: pointerTarget(p.previous),
    liveLink: pointerTarget(p.liveLink),
    hotfixPending: readDebt(root),
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
  const MUTATING = ['stage', 'serve', 'gate', 'challenge', 'walkthrough', 'promote', 'rollback', 'reconcile'];
  let release = () => {};
  try {
    if (MUTATING.includes(cmd)) release = acquireLock(root, cmd);
    // Test hook for contention drills: hold the lock for a while. Can only
    // slow a run down, never let one through.
    if (process.env.RP_SLOW_MS) await new Promise(r => setTimeout(r, Number(process.env.RP_SLOW_MS)));
    if (cmd === 'verify') {
      const { fullSha, artifactSha256 } = verifyArtifact(root, args[0] ?? gitInfo(root).fullSha);
      console.log(`verified ${fullSha} artifact ${artifactSha256}`);
    } else if (cmd === 'stage') {
      const { meta, reused } = await stage(root, {
        channel: process.env.DEPLOY_HOTFIX === '1' ? 'hotfix' : 'normal',
        reuse: true,
      });
      console.log(`${reused ? 'reusing staged' : 'staged'} ${meta.fullSha} bundle=${meta.bundle} artifact=${meta.artifactSha256.slice(0, 12)}`);
    } else if (cmd === 'serve') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      const dir = releaseDir(root, sha);
      const info = await serveStaging(root, dir);
      const healthy = await waitForHealth(`http://127.0.0.1:${info.port}/healthz`);
      const bound = healthy && (await verifyStagingServing(dir, info));
      if (!bound) {
        console.error(`ERROR: staging not serving release ${sha} (healthy=${healthy}; log ${info.log})`);
        process.exitCode = 1;
      } else console.log(`staging: ${sha} on http://127.0.0.1:${info.port} (pid ${info.pid}, artifact ${info.artifactSha256.slice(0, 12)}, persists until ruling)`);
    } else if (cmd === 'challenge') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      const { line } = issueChallenge(root, releaseDir(root, sha));
      console.log(`approval line for a registered approver to post verbatim:\n${line}`);
    } else if (cmd === 'reconcile') {
      const result = await reconcile(root, { liveUrl });
      console.log(`reconcile: ${result.state}${result.release ? ` (${result.release})` : ''}`);
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
        console.log(`no approval yet: a REGISTERED approver must post the challenge line verbatim (run: release-pipeline challenge ${sha})`);
        process.exitCode = 6;
      } else console.log(`approved by ${approval.approver} (${approval.client}, msg ${approval.messageId})`);
    } else if (cmd === 'walkthrough') {
      const sha = args[0] ?? gitInfo(root).fullSha;
      await recordWalkthrough(root, releaseDir(root, sha), { receiptPath: process.env.WALKTHROUGH_RECEIPT });
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
      console.error('usage: release-pipeline.mjs <stage|serve|gate|challenge|approve-check|walkthrough|verify|promote|rollback|reconcile|status> [sha]');
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
