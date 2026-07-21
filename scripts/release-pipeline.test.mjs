// T-95 slice 1: release-pipeline state machine tests. Each test builds a
// throwaway git repo with a fake buildFn, so no npm build, no server, no
// network - promote/rollback verification URLs are simply omitted.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  APPROVAL_PREFIX,
  acquireLock,
  approvalLine,
  atomicPointSymlink,
  debtSettledBy,
  hashDirectory,
  hasPhase,
  importLegacyDist,
  parseApproval,
  paths,
  pointerTarget,
  promote,
  readDebt,
  readPhase,
  reconcile,
  recordGate,
  recordWalkthrough,
  releaseDir,
  rollback,
  stage,
  status,
  verifyArtifact,
  writePhase,
} from './release-pipeline.mjs';

const roots = [];
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'rp-'));
  roots.push(root);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@test']);
  git(['config', 'user.name', 'Builder']);
  writeFileSync(join(root, 'seed.txt'), 'seed\n');
  // Mirror the real repo's ignore rules: pipeline state never dirties the tree.
  writeFileSync(join(root, '.gitignore'), 'releases/\n.visual-gate/\napps/\n');
  const fixture = join(root, 'fixture.mjs');
  writeFileSync(fixture, '// fixture manifest stand-in\n');
  git(['add', '.']);
  git(['commit', '-qm', 'seed']);
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });
  return { root, git, fixture, fullSha: git(['rev-parse', 'HEAD']).trim() };
}
test.after(() => {
  for (const root of roots) {
    // chmod -R (no symlink following) so the read-only artifacts can be removed.
    execFileSync('chmod', ['-R', 'u+rwX', root]);
    rmSync(root, { recursive: true, force: true });
  }
});

const fakeBuild = (marker = 'app') => async dist => {
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), `<script src="/assets/index-${marker}123.js"></script>\n`);
  writeFileSync(join(dist, 'assets', `index-${marker}123.js`), `console.log('${marker}');\n`);
};

const stageOpts = (repo, extra = {}) => ({ buildFn: fakeBuild(), fixtureFiles: [repo.fixture], ...extra });

test('stage produces an immutable, hashed, phase-marked release', async () => {
  const repo = makeRepo();
  const { dir, meta } = await stage(repo.root, stageOpts(repo));
  assert.equal(meta.fullSha, repo.fullSha);
  assert.equal(meta.bundle, 'index-app123.js');
  assert.equal(meta.artifactSha256, hashDirectory(join(dir, 'dist')));
  assert.match(meta.fixtureManifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(hasPhase(dir, 'staged'));
  // Immutability is enforced, not aspirational: writing into the artifact fails.
  assert.throws(() => writeFileSync(join(dir, 'dist', 'index.html'), 'tamper'));
  // And a second stage of the same SHA is refused outright.
  await assert.rejects(() => stage(repo.root, stageOpts(repo)), /immutable/);
});

test('stage refuses a dirty tree - no bypass exists', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo.root, 'wip.txt'), 'uncommitted\n');
  await assert.rejects(() => stage(repo.root, stageOpts(repo)), /dirty/);
  await assert.rejects(() => stage(repo.root, stageOpts(repo, { allowDirty: true })), /dirty/, 'the removed escape hatch must stay removed');
});

test('normal promote demands gate, approval, and walkthrough phases', async () => {
  const repo = makeRepo();
  const { dir } = await stage(repo.root, stageOpts(repo));
  await assert.rejects(() => promote(repo.root, repo.fullSha), /no gate phase/);
  writePhase(dir, 'gate', { exitCode: 0 });
  await assert.rejects(() => promote(repo.root, repo.fullSha), /no approval/);
  writePhase(dir, 'approved', { approver: 'Reviewer', messageId: 1 });
  await assert.rejects(() => promote(repo.root, repo.fullSha), /no walkthrough/);
  writePhase(dir, 'walkthrough', { skipped: true, reason: 'drill' });
  await promote(repo.root, repo.fullSha);
  assert.ok(hasPhase(dir, 'promoted'));
  const p = paths(repo.root);
  assert.equal(pointerTarget(p.current), dir);
  assert.equal(pointerTarget(p.liveLink), join(dir, 'dist'));
});

test('gate recording enforces the exit-code policy', () => {
  const repo = makeRepo();
  const dir = releaseDir(repo.root, repo.fullSha);
  mkdirSync(dir, { recursive: true });
  assert.throws(() => recordGate(repo.root, dir, { exitCode: 2, acked: false }), /VISUAL_GATE_ACK/);
  assert.throws(() => recordGate(repo.root, dir, { exitCode: 4, acked: true }), /never acknowledgeable/);
  assert.throws(() => recordGate(repo.root, dir, { exitCode: 5, acked: true }), /never acknowledgeable/);
  recordGate(repo.root, dir, { exitCode: 2, acked: true });
  assert.equal(readPhase(dir, 'gate').acked, true);
});

test('approval binds digests + nonce, and only registered non-lineage identities count', () => {
  const fullSha = 'a'.repeat(40);
  const artifactSha256 = 'b'.repeat(64);
  const gateResultSha256 = 'c'.repeat(64);
  const nonce = 'deadbeefdeadbeef';
  const registry = {
    approvers: [{ label: 'Verifier', name: 'UX-Adversary (2)', client: 'cc' }],
    builderLineages: [{ label: 'Claude', baseNames: ['Claude', 'ClaudeUI'] }],
  };
  const participants = [
    { name: 'Claude', client: 'cc' },
    { name: 'ClaudeUI (3)', client: 'web' },
    { name: 'UX-Adversary (2)', client: 'cc' },
  ];
  const bind = { fullSha, artifactSha256, gateResultSha256, nonce, registry, participants };
  const line = approvalLine({ fullSha, artifactSha256, gateResultSha256, nonce });

  // Builder and suffixed builder-lineage identities can never approve.
  assert.equal(parseApproval([{ id: 1, name: 'Claude', text: line }], bind), null);
  assert.equal(parseApproval([{ id: 2, name: 'ClaudeUI (3)', text: line }], bind), null);
  // An unregistered identity - even posting the exact line - is refused.
  assert.equal(parseApproval([{ id: 3, name: 'Random Agent', text: line }], bind), null);
  // A registered name with no live participant row of the registered client is refused.
  assert.equal(parseApproval([{ id: 4, name: 'UX-Adversary (2)', text: line }], { ...bind, participants: [] }), null);
  // Wrong nonce, wrong artifact digest, plain-SHA approvals: all replay-dead.
  assert.equal(parseApproval([{ id: 5, name: 'UX-Adversary (2)', text: approvalLine({ fullSha, artifactSha256, gateResultSha256, nonce: 'ffffffffffffffff' }) }], bind), null);
  assert.equal(parseApproval([{ id: 6, name: 'UX-Adversary (2)', text: approvalLine({ fullSha, artifactSha256: 'd'.repeat(64), gateResultSha256, nonce }) }], bind), null);
  assert.equal(parseApproval([{ id: 7, name: 'UX-Adversary (2)', text: `${APPROVAL_PREFIX} ${fullSha}` }], bind), null);
  // The registered verifier posting the exact challenge line passes.
  const ok = parseApproval([{ id: 8, name: 'UX-Adversary (2)', text: `${line} staging reviewed` }], bind);
  assert.equal(ok.approver, 'UX-Adversary (2)');
  assert.equal(ok.messageId, 8);
});

test('hotfix promote records debt; only a green normal promote clears it', async () => {
  const repo = makeRepo();
  const { dir } = await stage(repo.root, stageOpts(repo, { channel: 'hotfix' }));
  await promote(repo.root, repo.fullSha, { channel: 'hotfix', by: 'Builder', reason: 'host-critical' });
  const p = paths(repo.root);
  const debt = readDebt(repo.root);
  assert.deepEqual(debt.commits, [repo.fullSha]);
  assert.match(debt.artifactSha256, /^[a-f0-9]{64}$/, 'debt records the deployed artifact digest');
  assert.match(readFileSync(p.hotfixLog, 'utf8'), /host-critical/);

  // A second commit goes through the normal lane and settles the debt.
  writeFileSync(join(repo.root, 'seed.txt'), 'v2\n');
  repo.git(['commit', '-aqm', 'v2']);
  const sha2 = repo.git(['rev-parse', 'HEAD']).trim();
  const { dir: dir2 } = await stage(repo.root, { buildFn: fakeBuild('vtwo'), fixtureFiles: [repo.fixture] });
  writePhase(dir2, 'gate', { exitCode: 0 });
  writePhase(dir2, 'approved', { approver: 'Reviewer' });
  writePhase(dir2, 'walkthrough', { skipped: true, reason: 'drill' });
  await promote(repo.root, sha2);
  assert.equal(existsSync(p.hotfixPending), false);
  assert.equal(pointerTarget(p.previous), dir);
  assert.equal(pointerTarget(p.current), dir2);
});

test('an acked-pixel normal promote does NOT clear hotfix debt', async () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  mkdirSync(p.gateState, { recursive: true });
  writeFileSync(p.hotfixPending, 'deadbeef\n');
  const { dir } = await stage(repo.root, stageOpts(repo));
  writePhase(dir, 'gate', { exitCode: 2, acked: true });
  writePhase(dir, 'approved', { approver: 'Reviewer' });
  writePhase(dir, 'walkthrough', { skipped: true, reason: 'drill' });
  await promote(repo.root, repo.fullSha);
  assert.equal(existsSync(p.hotfixPending), true, 'acked diffs are not a green gate; debt must survive');
});

test('rollback flips the pointer pair and is itself reversible', async () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  const { dir } = await stage(repo.root, stageOpts(repo));
  for (const [name, data] of [['gate', { exitCode: 0 }], ['approved', {}], ['walkthrough', { skipped: true, reason: 'drill' }]])
    writePhase(dir, name, data);
  await promote(repo.root, repo.fullSha);

  writeFileSync(join(repo.root, 'seed.txt'), 'v2\n');
  repo.git(['commit', '-aqm', 'v2']);
  const sha2 = repo.git(['rev-parse', 'HEAD']).trim();
  const { dir: dir2 } = await stage(repo.root, { buildFn: fakeBuild('vtwo'), fixtureFiles: [repo.fixture] });
  for (const [name, data] of [['gate', { exitCode: 0 }], ['approved', {}], ['walkthrough', { skipped: true, reason: 'drill' }]])
    writePhase(dir2, name, data);
  await promote(repo.root, sha2);

  const first = await rollback(repo.root, { by: 'Builder' });
  assert.equal(first.to, dir);
  assert.equal(pointerTarget(p.liveLink), join(dir, 'dist'));
  assert.equal(pointerTarget(p.previous), dir2, 'rollback keeps a path back forward');
  const second = await rollback(repo.root, { by: 'Builder' });
  assert.equal(second.to, dir2, 'roll forward works because rollback swapped the pair');
  assert.match(readFileSync(p.releaseLog, 'utf8'), /rollback/);
});

test('first promotion imports a legacy real-directory dist as a release', async () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  mkdirSync(join(p.liveLink, 'assets'), { recursive: true });
  writeFileSync(join(p.liveLink, 'assets', 'index-old999.js'), 'legacy\n');
  const { dir } = await stage(repo.root, stageOpts(repo));
  for (const [name, data] of [['gate', { exitCode: 0 }], ['approved', {}], ['walkthrough', { skipped: true, reason: 'drill' }]])
    writePhase(dir, name, data);
  await promote(repo.root, repo.fullSha);
  assert.ok(lstatSync(p.liveLink).isSymbolicLink(), 'live path became a pointer');
  const previous = pointerTarget(p.previous);
  assert.match(previous, /imported-/);
  assert.ok(existsSync(join(previous, 'dist', 'assets', 'index-old999.js')), 'legacy bundle preserved for rollback');
  await rollback(repo.root, { by: 'Builder' });
  assert.equal(pointerTarget(p.liveLink), join(previous, 'dist'));
});

test('importLegacyDist is a no-op once the pointer exists', () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  mkdirSync(p.releases, { recursive: true });
  const target = join(p.releases, 'x');
  mkdirSync(join(target, 'dist'), { recursive: true });
  atomicPointSymlink(p.liveLink, join(target, 'dist'));
  assert.equal(importLegacyDist(repo.root), null);
});

test('atomicPointSymlink replaces an existing pointer in place', () => {
  const root = mkdtempSync(join(tmpdir(), 'rp-link-'));
  roots.push(root);
  const link = join(root, 'ptr');
  mkdirSync(join(root, 'a'));
  mkdirSync(join(root, 'b'));
  atomicPointSymlink(link, join(root, 'a'));
  assert.equal(pointerTarget(link), join(root, 'a'));
  atomicPointSymlink(link, join(root, 'b'));
  assert.equal(pointerTarget(link), join(root, 'b'));
});

test('a green normal promote of an UNRELATED SHA leaves hotfix debt standing', async () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  mkdirSync(p.gateState, { recursive: true });
  // Marker points at a commit that is NOT an ancestor of HEAD (an orphan).
  repo.git(['checkout', '-q', '--orphan', 'stray']);
  writeFileSync(join(repo.root, 'stray.txt'), 'stray\n');
  repo.git(['add', 'stray.txt']);
  repo.git(['commit', '-qm', 'stray']);
  const straySha = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['checkout', '-qf', 'main']);
  writeFileSync(p.hotfixPending, `${straySha}\n`);

  const { dir } = await stage(repo.root, stageOpts(repo));
  for (const [name, data] of [['gate', { exitCode: 0 }], ['approved', {}], ['walkthrough', { skipped: true, reason: 'drill' }]])
    writePhase(dir, name, data);
  await promote(repo.root, repo.fullSha);
  assert.equal(existsSync(p.hotfixPending), true, 'unrelated green promote must not settle the debt');
  assert.equal(debtSettledBy(repo.root, { commits: [straySha] }, repo.fullSha), false);
  assert.equal(debtSettledBy(repo.root, { commits: [repo.fullSha] }, repo.fullSha), true, 'a release containing the commit settles it');
  assert.equal(debtSettledBy(repo.root, { commits: ['not-a-sha'] }, repo.fullSha), false, 'unresolvable commits fail closed');
  assert.equal(debtSettledBy(repo.root, { commits: [repo.fullSha, straySha] }, repo.fullSha), false, 'ALL commits must be contained');
  // Legacy bare-SHA markers still parse.
  writeFileSync(p.hotfixPending, 'cafebabe\n');
  assert.deepEqual(readDebt(repo.root), { commits: ['cafebabe'], legacy: true });
});

test('promote refuses a mutated artifact (manifest re-verification)', async () => {
  const repo = makeRepo();
  const { dir } = await stage(repo.root, stageOpts(repo));
  for (const [name, data] of [['gate', { exitCode: 0 }], ['approved', {}], ['walkthrough', { skipped: true, reason: 'drill' }]])
    writePhase(dir, name, data);
  verifyArtifact(repo.root, repo.fullSha); // clean artifact verifies
  // Tamper past the read-only bits the way an attacker (or stray build) would.
  execFileSync('chmod', ['-R', 'u+rwX', join(dir, 'dist')]);
  writeFileSync(join(dir, 'dist', 'index.html'), 'tampered\n');
  assert.throws(() => verifyArtifact(repo.root, repo.fullSha), /mutated/);
  await assert.rejects(() => promote(repo.root, repo.fullSha), /mutated/);
  const p = paths(repo.root);
  assert.equal(pointerTarget(p.current), null, 'pointer never moved onto the tampered artifact');
});

test('the atomic lock is exclusive; dead-pid and recycled-pid locks are reclaimed', () => {
  const repo = makeRepo();
  const lockDir = join(paths(repo.root).releases, '.lock');
  const release = acquireLock(repo.root, 'promote');
  assert.throws(() => acquireLock(repo.root, 'stage'), /holds the lock/);
  release();
  const release2 = acquireLock(repo.root, 'stage'); // released lock reacquires
  release2();
  // Dead pid: reclaimed and logged.
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'holder.json'), JSON.stringify({ pid: 999999999, start: 'gone', cmd: 'gate', at: 'x' }));
  acquireLock(repo.root, 'rollback')();
  assert.match(readFileSync(paths(repo.root).releaseLog, 'utf8'), /stale-lock reclaimed \(pid 999999999 dead/);
  // Recycled pid: a LIVE pid whose start time differs from the record is
  // not the holder - reclaimed, not honored.
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'holder.json'), JSON.stringify({ pid: process.pid, start: 'Thu Jan  1 00:00:00 1970', cmd: 'gate', at: 'x' }));
  acquireLock(repo.root, 'promote')();
  assert.match(readFileSync(paths(repo.root).releaseLog, 'utf8'), /pid-reused/);
  // A crashed creator (lock dir without holder.json) is treated as stale.
  mkdirSync(lockDir);
  acquireLock(repo.root, 'stage')();
});

test('a walkthrough receipt must digest-match the release, and there is no skip', async () => {
  const repo = makeRepo();
  const { dir, meta } = await stage(repo.root, stageOpts(repo));
  writePhase(dir, 'gate', { exitCode: 0, gateResultSha256: 'e'.repeat(64) });
  await assert.rejects(() => recordWalkthrough(repo.root, dir, {}), /no skip/);
  // A receipt whose digests point at a different artifact refuses mechanically.
  const receiptPath = join(repo.root, 'receipt.json');
  const receipt = {
    schemaVersion: 1,
    release: { fullSha: meta.fullSha, artifactSha256: 'f'.repeat(64), fixtureManifestSha256: meta.fixtureManifestSha256, gateResultSha256: 'e'.repeat(64) },
  };
  writeFileSync(receiptPath, JSON.stringify(receipt));
  await assert.rejects(() => recordWalkthrough(repo.root, dir, { receiptPath }), /invalid|does not match/);
});

test('reconcile completes a verified interrupted promote and restores an unverified one', async () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  // Simulate the crash window: all phases done, pointer flipped, but the
  // promoted phase was never written.
  const { dir } = await stage(repo.root, stageOpts(repo));
  writePhase(dir, 'gate', { exitCode: 0 });
  writePhase(dir, 'approved', { approver: 'UX-Adversary (2)' });
  writePhase(dir, 'walkthrough', { receiptSha256: 'a'.repeat(64) });
  mkdirSync(p.releases, { recursive: true });
  atomicPointSymlink(p.current, dir);
  atomicPointSymlink(p.liveLink, join(dir, 'dist'));
  const completed = await reconcile(repo.root, {});
  assert.equal(completed.state, 'completed');
  assert.ok(hasPhase(dir, 'promoted'));
  assert.match(readFileSync(p.releaseLog, 'utf8'), /reconcile completed promote/);
  // Now a SECOND interrupted promote whose preconditions do NOT hold
  // (no approval): reconcile must restore the previous pointer, not guess.
  writeFileSync(join(repo.root, 'seed.txt'), 'v2\n');
  repo.git(['commit', '-aqm', 'v2']);
  const sha2 = repo.git(['rev-parse', 'HEAD']).trim();
  const { dir: dir2 } = await stage(repo.root, { buildFn: fakeBuild('vtwo'), fixtureFiles: [repo.fixture] });
  atomicPointSymlink(p.previous, dir);
  atomicPointSymlink(p.current, dir2);
  atomicPointSymlink(p.liveLink, join(dir2, 'dist'));
  const restored = await reconcile(repo.root, {});
  assert.equal(restored.state, 'restored');
  assert.equal(pointerTarget(p.current), dir, 'pointer went back to the last verified release');
  assert.equal(pointerTarget(p.liveLink), join(dir, 'dist'));
  assert.equal(hasPhase(dir2, 'promoted'), false, 'the unverified release was never blessed');
  // Idempotence: a second reconcile reports consistent and changes nothing.
  assert.equal((await reconcile(repo.root, {})).state, 'consistent');
});

test('migration preserves BOTH the served hotfix dist and its dist.prev sibling', async () => {
  const repo = makeRepo();
  const p = paths(repo.root);
  mkdirSync(join(p.liveLink, 'assets'), { recursive: true });
  writeFileSync(join(p.liveLink, 'assets', 'index-hotfix77.js'), 'hotfix\n');
  mkdirSync(join(`${p.liveLink}.prev`, 'assets'), { recursive: true });
  writeFileSync(join(`${p.liveLink}.prev`, 'assets', 'index-prehot66.js'), 'prehotfix\n');

  const { dir } = await stage(repo.root, stageOpts(repo));
  for (const [name, data] of [['gate', { exitCode: 0 }], ['approved', {}], ['walkthrough', { skipped: true, reason: 'drill' }]])
    writePhase(dir, name, data);
  await promote(repo.root, repo.fullSha);

  const names = status(repo.root).releases.map(r => r.name);
  const imported = names.find(n => /^imported-\d+$/.test(n));
  const importedPrev = names.find(n => /^imported-prev-/.test(n));
  assert.ok(imported && importedPrev, `both legacy dists imported (got ${names.join(', ')})`);
  assert.ok(existsSync(join(p.releases, imported, 'dist', 'assets', 'index-hotfix77.js')));
  assert.ok(existsSync(join(p.releases, importedPrev, 'dist', 'assets', 'index-prehot66.js')));
  // previous points at the displaced LIVE bundle (the hotfix), so one
  // rollback restores exactly what users had before this promote.
  assert.equal(pointerTarget(p.previous), join(p.releases, imported));
  assert.equal(JSON.parse(readFileSync(join(p.releases, imported, 'meta.json'))).bundle, 'index-hotfix77.js');
});

test('status reports pointers, phases, and hotfix debt truthfully', async () => {
  const repo = makeRepo();
  const { dir } = await stage(repo.root, stageOpts(repo));
  writePhase(dir, 'gate', { exitCode: 0 });
  const s = status(repo.root);
  assert.equal(s.current, null);
  assert.equal(s.hotfixPending, null);
  const row = s.releases.find(r => r.name === repo.fullSha);
  assert.deepEqual(row.phases.sort(), ['gate', 'staged']);
});
