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
  atomicPointSymlink,
  hashDirectory,
  hasPhase,
  importLegacyDist,
  parseApproval,
  paths,
  pointerTarget,
  promote,
  readPhase,
  recordGate,
  releaseDir,
  rollback,
  stage,
  status,
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

test('stage refuses a dirty tree unless the dirt is recorded explicitly', async () => {
  const repo = makeRepo();
  writeFileSync(join(repo.root, 'wip.txt'), 'uncommitted\n');
  await assert.rejects(() => stage(repo.root, stageOpts(repo)), /dirty/);
  const { meta } = await stage(repo.root, stageOpts(repo, { allowDirty: true }));
  assert.deepEqual(meta.dirty, ['wip.txt']);
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

test('approval parsing requires the exact SHA and a non-builder sender', () => {
  const fullSha = 'a'.repeat(40);
  const messages = [
    { id: 1, name: 'Builder', text: `${APPROVAL_PREFIX} ${fullSha}` }, // self-approval
    { id: 2, name: 'Reviewer', text: `${APPROVAL_PREFIX} ${'b'.repeat(40)}` }, // wrong SHA
    { id: 3, name: 'Reviewer', text: 'looks good to me' }, // prose is not approval
  ];
  assert.equal(parseApproval(messages, { fullSha, builder: 'Builder' }), null);
  messages.push({ id: 4, name: 'Reviewer', text: `${APPROVAL_PREFIX} ${fullSha} frames reviewed on staging` });
  const approval = parseApproval(messages, { fullSha, builder: 'Builder' });
  assert.equal(approval.approver, 'Reviewer');
  assert.equal(approval.messageId, 4);
});

test('hotfix promote records debt; only a green normal promote clears it', async () => {
  const repo = makeRepo();
  const { dir } = await stage(repo.root, stageOpts(repo, { channel: 'hotfix' }));
  await promote(repo.root, repo.fullSha, { channel: 'hotfix', by: 'Builder', reason: 'host-critical' });
  const p = paths(repo.root);
  assert.equal(readFileSync(p.hotfixPending, 'utf8').trim(), repo.fullSha);
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
