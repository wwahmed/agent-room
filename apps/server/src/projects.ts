// T-18: project-backed rooms. A server-side allowlisted registry maps
// stable project ids to local repo roots and named doc roles. Browsers
// and MCP clients only ever submit project IDS — every filesystem path
// below is resolved and containment-checked HERE.
//
// Durability model (documented in SELFHOST.md):
//   - The room's Redis task board stays the fast live view (24h TTL).
//   - docs/TASKS.md (role "tasks") in the project repo is the durable
//     ledger: a human-readable managed section plus an embedded machine
//     JSON block, so a future room can resume the exact board after the
//     Redis copy expires.
//   - Writes are fd-anchored (no-follow open, truncate+write+fsync under
//     an advisory lock — see the no-follow primitives below) and touch
//     ONLY the marker-fenced managed section; every byte outside the
//     markers is preserved (dirty-work preservation).
//   - No automatic git commits: the ledger diff stays visible in normal
//     git for audit, and committing remains a deliberate act.
//
// Registry file (PROJECTS_FILE env, default deploy/projects.json):
//   { "<id>": { "name": "...", "root": "/abs/path",
//               "docs": { "tasks": "docs/TASKS.md", "features": "FEATURES.md", ... } } }
// The "tasks" role is the ONLY writable role; all other docs are
// read-only through the API.

import { readFileSync, existsSync, realpathSync, statSync, unlinkSync, readdirSync, mkdirSync, openSync, closeSync, readSync, fstatSync, ftruncateSync, writeSync, fsyncSync, constants as fsConstants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export interface ProjectConfig {
  name: string;
  root: string;
  docs: Record<string, string>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  docs: string[]; // role names only — never paths
}

// Anchor the default to the module location, not cwd — the LaunchAgent's
// working directory is not guaranteed to be the repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = process.env.PROJECTS_FILE || join(HERE, '..', '..', '..', 'deploy', 'projects.json');
const MAX_DOC_BYTES = 300_000;

const BEGIN_MARK = '<!-- wakichat:tasks:begin v1 — machine-managed section; edit OUTSIDE the markers -->';
const END_MARK = '<!-- wakichat:tasks:end -->';
const STATE_BEGIN = '<!-- wakichat:state:begin';
const STATE_END = 'wakichat:state:end -->';
// Integrity line embedded INSIDE the managed section: the hash of the
// section with this line normalized to the placeholder. Conflict
// detection is therefore derived purely from the file — surviving Redis
// restarts, restores, and room TTL expiry (Codex T-18 review, item 3).
const HASH_LINE_RE = /<!-- wakichat:hash:[0-9a-f]{16} -->/;
const HASH_PLACEHOLDER = '<!-- wakichat:hash:0000000000000000 -->';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Strict registry loader (Codex T-18 gate 1): a missing file is a valid
 * empty registry, but a malformed file or ANY invalid entry throws a
 * ProjectRegistryError naming the problem — no silent skips, so a typo
 * can't quietly hide a project or route writes somewhere unexpected.
 */
export function loadRegistry(): Record<string, ProjectConfig> {
  if (!existsSync(REGISTRY_PATH)) return {};
  let raw: string;
  try {
    raw = readFileSync(REGISTRY_PATH, 'utf8');
  } catch (e) {
    throw projErr('ProjectRegistryError', `Project registry ${REGISTRY_PATH} is unreadable: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw projErr('ProjectRegistryError', `Project registry ${REGISTRY_PATH} is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw projErr('ProjectRegistryError', `Project registry ${REGISTRY_PATH} must be a JSON object of id -> config.`);
  }
  const out: Record<string, ProjectConfig> = {};
  for (const [id, cfgU] of Object.entries(parsed as Record<string, unknown>)) {
    if (id.startsWith('_')) continue; // _comment and friends are allowed
    const cfg = cfgU as Partial<ProjectConfig>;
    if (!ID_RE.test(id)) throw projErr('ProjectRegistryError', `Registry entry "${id}": ids must be slugs matching ${ID_RE}.`);
    if (!cfg || typeof cfg !== 'object') throw projErr('ProjectRegistryError', `Registry entry "${id}" must be an object.`);
    if (typeof cfg.name !== 'string' || !cfg.name.trim()) throw projErr('ProjectRegistryError', `Registry entry "${id}": "name" must be a non-empty string.`);
    if (typeof cfg.root !== 'string' || !cfg.root.startsWith('/')) throw projErr('ProjectRegistryError', `Registry entry "${id}": "root" must be an absolute path.`);
    if (!cfg.docs || typeof cfg.docs !== 'object' || Array.isArray(cfg.docs)) throw projErr('ProjectRegistryError', `Registry entry "${id}": "docs" must be an object of role -> relative path.`);
    for (const [role, rel] of Object.entries(cfg.docs)) {
      if (typeof rel !== 'string' || !rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\0')) {
        throw projErr('ProjectRegistryError', `Registry entry "${id}", doc role "${role}": path must be a safe relative path (got ${JSON.stringify(rel)}).`);
      }
    }
    out[id] = { name: cfg.name, root: cfg.root, docs: { ...cfg.docs } };
  }
  return out;
}

/** Startup validation: log actionable problems without killing the chat core. */
export function validateRegistryAtStartup(): void {
  try {
    const reg = loadRegistry();
    console.log(`[project] registry OK: ${Object.keys(reg).length} project(s) from ${REGISTRY_PATH}`);
  } catch (e) {
    console.error(`[project] REGISTRY INVALID — project features will fail closed until fixed: ${(e as Error).message}`);
  }
}

export function listProjects(): ProjectSummary[] {
  return Object.entries(loadRegistry()).map(([id, cfg]) => ({
    id,
    name: cfg.name,
    docs: Object.keys(cfg.docs),
  }));
}

export function getProject(id: string): ProjectConfig | null {
  return loadRegistry()[id] ?? null;
}

/**
 * Resolve a doc role to an absolute path, guaranteed inside the project
 * root. Throws on unknown project/role, traversal (`..` in config), or
 * symlink escape (realpath of the containing dir must stay under the
 * realpath of the root).
 */
export function resolveDocPath(projectId: string, role: string): { abs: string; rel: string; cfg: ProjectConfig } {
  const cfg = getProject(projectId);
  if (!cfg) throw projErr('RoomNotFoundError', `Unknown project "${projectId}".`);
  const rel = cfg.docs[role];
  if (!rel) throw projErr('RoomNotFoundError', `Project "${projectId}" has no doc role "${role}".`);
  if (rel.includes('..') || rel.startsWith('/') || rel.includes('\0')) {
    throw projErr('BadRequestError', `Doc path for role "${role}" is not a safe relative path.`);
  }
  const rootReal = realpathSync(cfg.root);
  const abs = resolve(rootReal, rel);
  // Containment on the LEXICAL path first…
  if (abs !== rootReal && !abs.startsWith(rootReal + sep)) {
    throw projErr('BadRequestError', 'Doc path escapes the project root.');
  }
  // …then on the REAL path of the nearest existing ancestor, so a
  // symlinked subdirectory can't tunnel writes/reads outside the root.
  let probe = existsSync(abs) ? abs : dirname(abs);
  while (!existsSync(probe)) probe = dirname(probe);
  const probeReal = realpathSync(probe);
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + sep)) {
    throw projErr('BadRequestError', 'Doc path resolves outside the project root (symlink).');
  }
  return { abs, rel, cfg };
}

export function readDoc(projectId: string, role: string): { role: string; rel: string; content: string; truncated: boolean } {
  const { abs, rel } = resolveDocPath(projectId, role);
  if (!existsSync(abs)) return { role, rel, content: '', truncated: false };
  const st = statSync(abs);
  if (!st.isFile()) throw projErr('BadRequestError', `Doc role "${role}" is not a regular file.`);
  const buf = readFileSync(abs);
  const truncated = buf.length > MAX_DOC_BYTES;
  return { role, rel, content: buf.subarray(0, MAX_DOC_BYTES).toString('utf8'), truncated };
}

// ---------- task ledger ----------

interface LedgerTaskShape {
  id: string;
  title: string;
  state: string;
  [k: string]: unknown;
}
export interface LedgerBoardShape { tasks: LedgerTaskShape[] }

function iso(ms?: number): string {
  return ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/</g, '&lt;');
}

function renderTask(t: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`### ${t.id} · ${t.title}`);
  const stamps = [
    t.createdAt ? `created ${iso(t.createdAt as number)}` : '',
    t.claimedAt ? `claimed ${iso(t.claimedAt as number)}` : '',
    t.submittedAt ? `submitted ${iso(t.submittedAt as number)}` : '',
    t.verifiedAt ? `verified ${iso(t.verifiedAt as number)}` : '',
  ].filter(Boolean).join(' · ');
  lines.push(`- **status:** ${t.state}${t.verdict ? ` (verdict: ${t.verdict})` : ''}`);
  lines.push(`- **owner:** ${t.owner ?? '—'}${t.ownerClient ? ` (${t.ownerClient})` : ''} · **verifier:** ${t.verifier ?? '—'} · **created by:** ${t.createdBy ?? '—'}`);
  if (stamps) lines.push(`- **timeline:** ${stamps}`);
  if (t.dod) lines.push(`- **DoD:** ${esc(t.dod)}`);
  const ev = t.evidence as Record<string, unknown> | undefined;
  if (ev) {
    lines.push('');
    lines.push('<details><summary>evidence</summary>');
    lines.push('');
    if (ev.fileListing) lines.push(`- **files:** ${esc(ev.fileListing)}`);
    if (ev.fileExcerpt) lines.push(`- **excerpt:** ${esc(ev.fileExcerpt)}`);
    if (ev.runOutput) lines.push(`- **run:** ${esc(ev.runOutput)}`);
    if (ev.exitCode !== undefined) lines.push(`- **exit:** ${ev.exitCode}`);
    lines.push('');
    lines.push('</details>');
  }
  if (t.note) {
    lines.push('');
    lines.push(`> **${t.verifiedBy ?? 'verifier'}:** ${esc(t.note)}`);
  }
  return lines.join('\n');
}

export function renderManagedSection(board: LedgerBoardShape, roomCode: string, syncedAtMs: number): string {
  const counts = new Map<string, number>();
  for (const t of board.tasks) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  const summary = [...counts.entries()].map(([s, n]) => `${n} ${s}`).join(', ') || 'no tasks';
  const body = board.tasks.map(t => renderTask(t as Record<string, unknown>)).join('\n\n');
  const stateJson = JSON.stringify({ v: 1, roomCode, syncedAt: syncedAtMs, board });
  const withPlaceholder = [
    BEGIN_MARK,
    HASH_PLACEHOLDER,
    '',
    `_Last sync: ${iso(syncedAtMs)} from room ${roomCode} · ${board.tasks.length} tasks (${summary})_`,
    '',
    body,
    '',
    `${STATE_BEGIN}`,
    '```json',
    stateJson,
    '```',
    `${STATE_END}`,
    END_MARK,
  ].join('\n');
  const h = sectionHash(withPlaceholder);
  return withPlaceholder.replace(HASH_PLACEHOLDER, `<!-- wakichat:hash:${h} -->`);
}

/**
 * File-derived integrity check: 'clean' when the embedded hash matches
 * the section content, 'tampered' when it doesn't (hand edit inside the
 * markers), 'legacy' when no hash line exists. Legacy is FAIL-CLOSED at
 * the sync layer: an ordinary sync refuses to overwrite it; an explicit
 * force migrates it to the hashed format.
 */
export function sectionIntegrity(section: string): 'clean' | 'tampered' | 'legacy' {
  const m = HASH_LINE_RE.exec(section);
  if (!m) return 'legacy';
  const recorded = /<!-- wakichat:hash:([0-9a-f]{16}) -->/.exec(m[0])![1];
  const normalized = section.replace(HASH_LINE_RE, HASH_PLACEHOLDER);
  return sectionHash(normalized) === recorded ? 'clean' : 'tampered';
}

function managedSlice(content: string): { before: string; section: string; after: string } | null {
  const b = content.indexOf(BEGIN_MARK);
  if (b === -1) return null;
  const e = content.indexOf(END_MARK, b);
  if (e === -1) return null;
  return {
    before: content.slice(0, b),
    section: content.slice(b, e + END_MARK.length),
    after: content.slice(e + END_MARK.length),
  };
}

export function sectionHash(section: string): string {
  return createHash('sha256').update(section).digest('hex').slice(0, 16);
}

export interface SyncResult {
  rel: string;
  bytes: number;
  changed: boolean;
  hash: string;
  conflict?: string;
}


// ---------- server-owned state dir: locks + write-ahead journal (T-18 r6) ----------
//
// Round-5 finding: the lock and the truncate-in-place write both still
// touched the repo (the attacker-swappable parent), and truncate-in-place
// is not crash-atomic — a crash mid-write left a torn ledger that the next
// sync silently appended to (two BEGIN markers). Node has no
// openat/renameat, so we cannot make a same-dir rename swap-proof. Instead:
//
//   1. Lock + journal live in a SERVER-OWNED dir (LEDGER_STATE_DIR, 0700),
//      keyed by the canonical ledger realpath. No lock/journal path op ever
//      addresses the repo parent, so a parent/lock swap cannot redirect
//      create/stat/unlink outside anything the server owns.
//   2. A write-ahead journal makes the (non-atomic) fd write crash-safe:
//      the FULL next content is fsync'd to the journal BEFORE the ledger is
//      touched, then re-applied idempotently by recovery. A crash at ANY
//      point leaves the ledger either exactly pre-write or exactly the
//      intended next state — never a torn ledger exposed as success.
//   3. recoverLedger() runs before every read AND write; a torn ledger with
//      no usable journal FAILS CLOSED (throws) rather than appending.
const STATE_DIR = (() => {
  const dir = process.env.LEDGER_STATE_DIR || join(homedir(), '.wakichat', 'ledger-state');
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* exists */ }
  try { return realpathSync(dir); } catch { return dir; }
})();

// Idempotent — the state dir may be absent (fresh box, cleaned, or a test
// tmp). Ensure it before every lock/journal write.
function ensureStateDir(): void {
  try { mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }); } catch { /* exists */ }
}

// Exported for tests (lock/journal live in the server-owned STATE_DIR now).
export function stateKeyFor(canonicalLedgerPath: string): string {
  return createHash('sha256').update(canonicalLedgerPath).digest('hex').slice(0, 32);
}
export function lockPathFor(key: string): string { return join(STATE_DIR, `${key}.lock`); }
function journalPathFor(key: string): string { return join(STATE_DIR, `${key}.journal`); }

// Test-only deterministic crash injection. Set WAKICHAT_TEST_CRASH_AT to a
// stage name; the write throws right after that stage's durability point so
// tests can assert recovery from every crash boundary. No effect unset.
function crashPoint(stage: string): void {
  if (process.env.WAKICHAT_TEST_CRASH_AT === stage) {
    const err = new Error(`injected crash at ${stage}`);
    err.name = 'InjectedCrash';
    throw err;
  }
}

interface LedgerJournal { v: 1; target: string; contentHash: string; content: string }

function writeFileFsync(path: string, data: string, mode: number): void {
  const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_WRONLY, mode);
  try {
    const buf = Buffer.from(data, 'utf8');
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off, off);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

// T-18 r7 (T-32 F1): fsync the CONTAINING DIRECTORY so a file's create/unlink
// (its directory entry, i.e. the journal's NAME) is durable — data fsync
// alone does not guarantee the dirent survives a crash. Best-effort: a
// platform that rejects dir fsync (rare) degrades to data-only durability.
// HONEST BOUNDARY (Codex "report, don't approximate"): on macOS `fsync(2)`
// — which is all Node exposes — flushes to the drive but NOT necessarily to
// the platter (that needs fcntl F_FULLFSYNC, which Node cannot issue). So
// against SUDDEN POWER LOSS on a macOS host a residual window remains where
// the journal dirent may be lost; recovery then finds no journal and the
// ledger stays a FAIL-CLOSED conflict (operator `force` rebuilds) — never
// silent corruption or a partial ledger exposed as success.
function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(dir, fsConstants.O_RDONLY);
    fsyncSync(fd);
  } catch { /* platform without dir-fsync: data fsync still applied */ }
  finally { if (fd !== null) { try { closeSync(fd); } catch { /* closed */ } } }
}

/**
 * Recovery: automatic + idempotent, run before every ledger read/write. If a
 * committed journal exists for this ledger, reconcile the on-disk ledger to
 * the journal's intended content. Safe to run any number of times.
 *   - journal absent            -> nothing to do.
 *   - journal unparseable/torn   -> a pre-mutation partial (the ledger was
 *                                   never touched); discard it.
 *   - ledger already == journal  -> the write finished; clear the journal.
 *   - ledger != journal          -> torn write; re-apply the journal content
 *                                   to the ledger fd, fsync, verify, clear.
 * A ledger open that fails containment/no-follow throws (fail closed).
 */
function recoverLedger(abs: string, rootReal: string, key: string): void {
  const jp = journalPathFor(key);
  if (!existsSync(jp)) return;
  let journal: LedgerJournal | null = null;
  try {
    const raw = readFileSync(jp, 'utf8');
    const j = JSON.parse(raw) as LedgerJournal;
    if (j && j.v === 1 && typeof j.content === 'string' && typeof j.contentHash === 'string'
        && sectionHash(j.content) === j.contentHash && j.target === abs) {
      journal = j;
    }
  } catch { journal = null; }
  if (!journal) { try { unlinkSync(jp); } catch { /* gone */ } return; }

  const fd = openNoFollow(abs, fsConstants.O_CREAT | fsConstants.O_RDWR, 0o644, rootReal);
  try {
    const cur = readFdText(fd);
    if (sectionHash(cur) !== journal.contentHash) {
      // Torn or pre-write ledger: re-apply the durable intended content.
      writeFdTextRaw(fd, journal.content);
    }
  } finally { closeSync(fd); }
  try { unlinkSync(jp); fsyncDir(STATE_DIR); } catch { /* gone */ }
}

// ---------- no-follow filesystem primitives (Codex T-18 round 4) ----------
//
// The round-4 finding: creating the lock/tmp and renaming through a
// LEXICAL path lets a parent-symlink swap between operations land
// artifacts outside the project root — an fs.watch probe caught
// transient outside events. Node has no openat/renameat, so the fix is
// Darwin's O_NOFOLLOW_ANY: the kernel refuses to traverse a symlink in
// ANY path component of the open. Every ledger write goes through a file
// descriptor obtained with that flag — once the fd is open, later path
// swaps cannot redirect writes (they address the inode, not the path).
// Rename is inherently lexical and unfixable without renameat, so we do
// NOT rename. CRASH-ATOMICITY instead comes from the write-ahead journal
// (see STATE_DIR / recoverLedger): the full next content is fsync'd to a
// server-owned journal BEFORE the fd truncate+write, and recovery
// re-applies it idempotently, so a crash never exposes a torn ledger.
// On non-Darwin platforms the flag degrades to O_NOFOLLOW (final
// component only) plus the realpath pre-checks — documented weaker.
const O_NOFOLLOW_ANY = process.platform === 'darwin' ? 0x20000000 : fsConstants.O_NOFOLLOW;

/**
 * Open with symlink traversal refused in every path component (Darwin).
 * The parent is canonicalized FIRST — benign system symlinks like
 * /var -> /private/var would otherwise trip the flag. After
 * canonicalization the path contains no links at that instant, so any
 * symlink the kernel then encounters is a hostile post-check swap.
 */
function openNoFollow(path: string, flags: number, mode?: number, mustBeUnder?: string): number {
  const canonical = join(realpathSync(dirname(path)), path.split(sep).pop()!);
  // Containment binds HERE, to the canonical path the kernel will
  // actually use. A swapped parent canonicalizes to its target, so an
  // escape is caught before any inode is touched — zero outside events.
  if (mustBeUnder && canonical !== mustBeUnder && !canonical.startsWith(mustBeUnder + sep)) {
    throw projErr('BadRequestError', 'Refused: target path resolves outside the permitted root.');
  }
  try {
    return openSync(canonical, flags | O_NOFOLLOW_ANY, mode);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENOTDIR') {
      throw projErr('BadRequestError', 'Refused: a symlink appeared in the target path.');
    }
    throw e;
  }
}

function readFdText(fd: number): string {
  const size = fstatSync(fd).size;
  const buf = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = readSync(fd, buf, off, size - off, off);
    if (n <= 0) break;
    off += n;
  }
  return buf.subarray(0, off).toString('utf8');
}

/** Truncate + write + fsync through the fd. Path swaps after open cannot redirect this. */
function writeFdTextRaw(fd: number, text: string): void {
  ftruncateSync(fd, 0);
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    off += writeSync(fd, buf, off, buf.length - off, off);
  }
  fsyncSync(fd);
}

/** As writeFdTextRaw, with test-only crash points across the torn window. */
function writeFdTextHooked(fd: number, text: string): void {
  ftruncateSync(fd, 0);
  crashPoint('after-ledger-truncate'); // ledger empty; only the journal holds `text`
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off, off);
  crashPoint('before-ledger-fsync');
  fsyncSync(fd);
}

/**
 * Advisory per-ledger lock, held in the SERVER-OWNED state dir (0700),
 * keyed by the canonical ledger identity. Because the dir is the server's
 * own — not the attacker-swappable repo parent — plain O_EXCL create /
 * stat / unlink are safe here; a parent/lock swap in the repo cannot
 * redirect any of these operations. A lock older than LOCK_STALE_MS is a
 * crashed writer and is taken over.
 */
// ---------- liveness-based lock reclaim (T-18 r9, Codex T-32 F4) ----------
//
// Time-based stealing is fundamentally racy: however narrow the window, a
// slow-but-ALIVE owner can be descheduled past the timeout, its lock stolen,
// and then resume and clobber the taker (the assert→write TOCTOU). Codex's
// prescription: NEVER reclaim on time. Reclaim a lock ONLY when its owning
// process is PROVABLY DEAD; otherwise fail closed (conflict / manual
// recovery) even if the lock is old. A live owner is therefore never stolen
// from, so the gap cannot be exploited.
//
// "Provably dead" = the recorded PID is not running, OR it is running but is
// a DIFFERENT process instance (PID reuse) — disambiguated by the OS process
// start time. ASSUMPTION (documented): a single host. The lock lives on the
// local fs (~/.wakichat) and these checks are host-local; a shared-fs /
// multi-host deployment would need a different fencing primitive.

interface LockRecord { pid: number; start: string; owner: string }

export function procStartTime(pid: number): string {
  try {
    // `ps -o lstart=` is portable (macOS + Linux); the start time defeats
    // PID reuse. Empty when the pid is not running.
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000 }).trim();
  } catch { return ''; }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } // EPERM = exists (other uid); ESRCH = dead
}

/**
 * Pure decision (unit-tested): may we reclaim a lock held by `rec`?
 * Reclaim ONLY if the owner is provably dead — not running, or a different
 * process instance now occupies its PID. A live same-instance owner is
 * NEVER reclaimable, no matter how old.
 */
export function isLockReclaimable(rec: LockRecord, alive: (pid: number) => boolean, startOf: (pid: number) => string): boolean {
  if (!alive(rec.pid)) return true;              // owner process gone
  if (rec.start && startOf(rec.pid) !== rec.start) return true; // PID reused by a new process
  return false;                                   // alive, same instance → hands off
}

interface LedgerLock { lockPath: string; owner: string }

function acquireLedgerLock(key: string): LedgerLock {
  ensureStateDir();
  const lockPath = lockPathFor(key);
  const owner = randomBytes(16).toString('hex'); // unforgeable ownership nonce
  const rec: LockRecord = { pid: process.pid, start: procStartTime(process.pid), owner };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileFsyncExcl(lockPath, JSON.stringify(rec), 0o600);
      return { lockPath, owner };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let held: LockRecord | null = null;
      try { held = JSON.parse(readFileSync(lockPath, 'utf8')) as LockRecord; }
      catch { continue; } // vanished/garbage between EEXIST and read: retry create
      if (!held || typeof held.pid !== 'number') {
        // Malformed lock with no identifiable owner: cannot prove death →
        // fail closed rather than steal.
        throw projErr('LedgerConflictError', 'Ledger lock is malformed; manual recovery needed (remove the stale .lock after confirming no writer is running).');
      }
      if (!isLockReclaimable(held, pidAlive, procStartTime)) {
        throw projErr('LedgerConflictError', `Ledger lock is held by a live writer (pid ${held.pid}); retry shortly.`);
      }
      console.warn(`[project] reclaiming ledger lock ${key} from dead owner pid ${held.pid}`);
      try { unlinkSync(lockPath); } catch { /* raced */ }
    }
  }
  throw projErr('LedgerConflictError', 'Could not acquire the ledger lock.');
}

// T-18 r8 (T-32 F4, Codex): OBSERVABLE stale-takeover invariant. A slow
// writer whose lock was taken over (stale takeover by a second process)
// MUST fail closed at commit rather than silently overwrite the taker's
// completed write. We re-read the lock immediately before each durable
// step; if it no longer carries our ownership nonce, the lock was stolen —
// abort with a conflict. Cheap (a small read) and the check→write window is
// synchronous and sub-millisecond, far inside the 30s staleness threshold.
function assertLockOwner(lock: LedgerLock): void {
  let held: { owner?: string } | null = null;
  try { held = JSON.parse(readFileSync(lock.lockPath, 'utf8')) as { owner?: string }; } catch { held = null; }
  if (!held || held.owner !== lock.owner) {
    throw projErr('LedgerConflictError', 'Lock was taken over by another writer (stale takeover); this write was aborted to avoid overwriting a concurrent completed write — retry.');
  }
}

// Release ONLY if we still own it — never unlink a successor's lock.
function releaseLedgerLock(lock: LedgerLock): void {
  try {
    const held = JSON.parse(readFileSync(lock.lockPath, 'utf8')) as { owner?: string };
    if (held.owner === lock.owner) { unlinkSync(lock.lockPath); fsyncDir(STATE_DIR); }
  } catch { /* gone or not ours */ }
}

function writeFileFsyncExcl(path: string, data: string, mode: number): void {
  const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, mode);
  try {
    const buf = Buffer.from(data, 'utf8');
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off, off);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/**
 * Write the board into the project's task ledger. Conflict detection is
 * FILE-derived (sectionIntegrity): a hand edit inside the markers, a
 * pre-hash "legacy" section, or a torn/incomplete section refuses the
 * write unless `force` — no external state, so it survives Redis loss and
 * room expiry. The whole recover → read → integrity check → journalled
 * write runs synchronously INSIDE the server-owned advisory lock.
 */
export function syncTaskLedger(
  projectId: string,
  roomCode: string,
  board: LedgerBoardShape,
  force = false,
): SyncResult {
  const { abs, rel, cfg } = resolveDocPath(projectId, 'tasks');
  const now = Date.now();
  const section = renderManagedSection(board, roomCode, now);

  const rootRealForIo = realpathSync(cfg.root);
  // Canonical ledger identity keys the server-owned lock + journal. The
  // repo parent is swappable; the state dir is ours.
  const canonical = join(realpathSync(dirname(abs)), abs.split(sep).pop()!);
  if (canonical !== rootRealForIo && !canonical.startsWith(rootRealForIo + sep)) {
    throw projErr('BadRequestError', 'Ledger path resolves outside the project root.');
  }
  const key = stateKeyFor(canonical);
  const lock = acquireLedgerLock(key);
  // Test-only: die HARD right after acquiring, leaving the lock behind, to
  // simulate a crashed writer (a dead owner whose lock must be reclaimable).
  if (process.env.WAKICHAT_TEST_ABANDON_LOCK) { process.exit(37); }
  // Test-only: hold the lock synchronously (alive) so a second process
  // observes a LIVE owner and must NOT steal it. No effect unset.
  const holdMs = Number(process.env.WAKICHAT_TEST_HOLD_MS || 0);
  if (holdMs > 0) { const until = Date.now() + holdMs; while (Date.now() < until) { /* busy-hold */ } }
  let ledgerFd: number | null = null;
  try {
    // Recover FIRST: reconcile any journal from a crashed prior write so we
    // always read/write a consistent ledger, never a torn one.
    recoverLedger(abs, rootRealForIo, key);

    let before = `# Task ledger — ${cfg.name}\n\nDurable record of WakiChat room task boards for this project. The\nfenced section below is machine-managed; write anything you like\noutside it.\n\n`;
    let after = '\n';
    ledgerFd = openNoFollow(abs, fsConstants.O_CREAT | fsConstants.O_RDWR, 0o644, rootRealForIo);
    const current = readFdText(ledgerFd);
    if (current.length > 0) {
      const hasBegin = current.includes(BEGIN_MARK);
      const hasEnd = current.includes(END_MARK);
      const slice = managedSlice(current);
      if (slice) {
        const integrity = sectionIntegrity(slice.section);
        if (integrity === 'tampered' && !force) {
          return { rel, bytes: 0, changed: false, hash: sectionHash(slice.section), conflict: 'managed section was modified outside WakiChat since the last sync; review the file and re-sync with force' };
        }
        if (integrity === 'legacy' && !force) {
          // Fail closed: missing integrity metadata is not a license to
          // overwrite. An explicit force migrates to the hashed format.
          return { rel, bytes: 0, changed: false, hash: sectionHash(slice.section), conflict: 'managed section has no integrity hash (pre-hash format); review the file and run projectSync with force to migrate it' };
        }
        // Idempotence: identical board on a clean section => no write, no
        // timestamp churn. A forced repair must always rewrite.
        if (integrity === 'clean' && !force) {
          const jsonMatch = /```json\n([\s\S]*?)\n```/.exec(slice.section);
          if (jsonMatch) {
            try {
              const prev = JSON.parse(jsonMatch[1]) as { board?: LedgerBoardShape };
              if (prev.board && JSON.stringify(prev.board) === JSON.stringify(board)) {
                return { rel, bytes: Buffer.byteLength(current), changed: false, hash: sectionHash(slice.section) };
              }
            } catch { /* fall through to a fresh write */ }
          }
        }
        before = slice.before;
        after = slice.after;
      } else if (hasBegin || hasEnd) {
        // TORN: exactly one marker present (recovery found no usable
        // journal). Do NOT append a second section — fail closed. `force`
        // rewrites the whole ledger from scratch as an operator repair.
        if (!force) {
          return { rel, bytes: 0, changed: false, hash: sectionHash(current), conflict: 'ledger has an incomplete managed section (torn write); review the file and run projectSync with force to rebuild it' };
        }
        before = `# Task ledger — ${cfg.name}\n\n`;
        after = '\n';
      } else {
        // Genuinely no managed section (user file, both markers absent):
        // append one, preserving every existing byte.
        before = current.endsWith('\n') ? current + '\n' : current + '\n\n';
        after = '\n';
      }
    }

    const next = before + section + after;

    // ---- crash-safe commit (write-ahead journal) ----
    // 1. Persist the FULL intended content to the journal and fsync it
    //    BEFORE touching the ledger. A crash before this point leaves the
    //    ledger exactly pre-write.
    ensureStateDir();
    // CAS: we must still own the lock. If a stale takeover happened while we
    // were slow, abort fail-closed rather than clobber the taker's write.
    assertLockOwner(lock);
    const jp = journalPathFor(key);
    const journal: LedgerJournal = { v: 1, target: abs, contentHash: sectionHash(next), content: next };
    writeFileFsync(jp, JSON.stringify(journal), 0o600);
    fsyncDir(STATE_DIR); // the journal's NAME must be durable before we touch the ledger
    crashPoint('after-journal-fsync');
    // 2. Apply to the ledger fd (truncate+write+fsync). A crash anywhere in
    //    here leaves a torn ledger, but the journal above holds the full
    //    next content, so recovery re-applies it idempotently. Re-check
    //    ownership one last time immediately before the mutation.
    assertLockOwner(lock);
    // Test-only: pause in the assert→write gap (the exact TOCTOU Codex
    // named). Liveness-based reclaim means a LIVE owner is never stolen, so
    // even a long pause here cannot let a second writer commit and be
    // clobbered — the second writer fails closed instead.
    const holdAfter = Number(process.env.WAKICHAT_TEST_HOLD_AFTER_ASSERT_MS || 0);
    if (holdAfter > 0) { const until = Date.now() + holdAfter; while (Date.now() < until) { /* busy-hold */ } }
    writeFdTextHooked(ledgerFd, next);
    crashPoint('after-ledger-fsync');
    // 3. Clear the journal; a crash here just leaves recovery to notice the
    //    ledger already matches and drop the journal (idempotent).
    try { unlinkSync(jp); fsyncDir(STATE_DIR); } catch { /* gone */ }
    crashPoint('after-journal-cleanup');
    return { rel, bytes: Buffer.byteLength(next), changed: true, hash: sectionHash(section) };
  } finally {
    if (ledgerFd !== null) { try { closeSync(ledgerFd); } catch { /* closed */ } }
    releaseLedgerLock(lock); // only unlinks if we still own it
  }
}

/** Read the embedded machine state back out of the ledger (board resume). */
export function loadLedgerBoard(projectId: string): { roomCode: string; syncedAt: number; board: LedgerBoardShape } | null {
  const { abs, cfg } = resolveDocPath(projectId, 'tasks');
  if (!existsSync(abs)) return null;
  // Recovery runs before this READ too (Codex guardrail): a torn ledger left
  // by a crashed write is reconciled from the journal under the lock before
  // we parse it, so a resume never sees a partially-written board.
  const rootReal = realpathSync(cfg.root);
  const canonical = join(realpathSync(dirname(abs)), abs.split(sep).pop()!);
  if (canonical !== rootReal && !canonical.startsWith(rootReal + sep)) return null;
  // T-32 F3: recover AND read the ledger while HOLDING the lock, via the same
  // no-follow fd — so a concurrent writer can't slip a torn/partial state
  // between recovery and the parse.
  const key = stateKeyFor(canonical);
  const lock = acquireLedgerLock(key);
  let content: string;
  try {
    recoverLedger(abs, rootReal, key);
    const fd = openNoFollow(abs, fsConstants.O_CREAT | fsConstants.O_RDONLY, 0o644, rootReal);
    try { content = readFdText(fd); } finally { closeSync(fd); }
  } finally { releaseLedgerLock(lock); }
  const slice = managedSlice(content);
  if (!slice) return null;
  const sb = slice.section.indexOf(STATE_BEGIN);
  const se = slice.section.indexOf(STATE_END, sb);
  if (sb === -1 || se === -1) return null;
  const jsonMatch = /```json\n([\s\S]*?)\n```/.exec(slice.section.slice(sb, se));
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1]) as { v: number; roomCode: string; syncedAt: number; board: LedgerBoardShape };
    if (!parsed.board || !Array.isArray(parsed.board.tasks)) return null;
    return { roomCode: parsed.roomCode, syncedAt: parsed.syncedAt, board: parsed.board };
  } catch {
    return null;
  }
}

// ---------- safe project onboarding (Codex T-18 gate 4) ----------
//
// The browser still NEVER supplies a filesystem path. The server scans
// PROJECT_SCAN_ROOTS (explicit allowlist; unset disables onboarding)
// for git repositories, mints single-use random candidate tokens, and
// creation accepts only those tokens. Registry writes go through the
// same lock + no-follow fd discipline as the ledger.

// EXPLICIT allowlist only (Codex round-3, item 6): no default. Unset =>
// onboarding surface is disabled entirely.
const SCAN_ROOTS = (process.env.PROJECT_SCAN_ROOTS || '').split(':').filter(Boolean);
const SCAN_DEPTH = 2;

export interface ProjectCandidate {
  key: string;       // server-issued random token — carries no path data
  dirName: string;   // display: repo directory name only
  suggestedId: string;
}

// Round-3 item 1: candidate keys are single-use random tokens minted at
// discovery time and resolved through this in-memory map. The browser
// never sees (or can fabricate) anything path-shaped; create refuses any
// token discovery did not issue. Tokens expire and die with the process.
const CANDIDATE_TTL_MS = 10 * 60 * 1000;
const issuedCandidates = new Map<string, { abs: string; dirName: string; at: number }>();

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return ID_RE.test(s) ? s : `repo-${s}`.slice(0, 63);
}

export function listProjectCandidates(): ProjectCandidate[] {
  if (SCAN_ROOTS.length === 0) return []; // onboarding disabled without an explicit allowlist
  const registered = new Set<string>();
  try {
    for (const cfg of Object.values(loadRegistry())) {
      try { registered.add(realpathSync(cfg.root)); } catch { /* root missing */ }
    }
  } catch { /* invalid registry: still list candidates so it can be rebuilt */ }

  // Expire stale tokens on every listing.
  const now = Date.now();
  for (const [tok, v] of issuedCandidates) if (now - v.at > CANDIDATE_TTL_MS) issuedCandidates.delete(tok);

  const out: ProjectCandidate[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    let rootReal: string;
    try { rootReal = realpathSync(scanRoot); } catch { continue; }
    const walk = (dir: string, depth: number) => {
      if (depth > SCAN_DEPTH) return;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      if (entries.includes('.git')) {
        let real: string;
        try { real = realpathSync(dir); } catch { return; }
        if (!real.startsWith(rootReal + sep) && real !== rootReal) return; // symlinked out — skip
        if (registered.has(real)) return;
        const dirName = real.split(sep).pop() || 'repo';
        const token = randomBytes(16).toString('hex');
        issuedCandidates.set(token, { abs: real, dirName, at: now });
        out.push({ key: token, dirName, suggestedId: slugify(dirName) });
        return; // don't descend into repos
      }
      for (const e of entries) {
        if (e.startsWith('.') || e === 'node_modules') continue;
        const p = join(dir, e);
        try { if (statSync(p).isDirectory()) walk(p, depth + 1); } catch { /* unreadable */ }
      }
    };
    walk(rootReal, 0);
  }
  return out.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

/**
 * Create a registry entry from a server-issued candidate token. Raw or
 * fabricated keys are refused outright — only tokens minted by
 * listProjectCandidates() in this process resolve to anything.
 */
export function createProjectFromCandidate(key: string, requestedId?: string, requestedName?: string): ProjectSummary {
  if (SCAN_ROOTS.length === 0) throw projErr('BadRequestError', 'Project onboarding is disabled: PROJECT_SCAN_ROOTS is not configured.');
  const issued = issuedCandidates.get(key || '');
  if (!issued || Date.now() - issued.at > CANDIDATE_TTL_MS) {
    throw projErr('BadRequestError', 'Unknown or expired candidate key; refresh the candidate list.');
  }
  // Re-validate at use time: still under an allowed root, still a repo.
  const absReal = realpathSync(issued.abs); // throws if gone
  const underAllowedRoot = SCAN_ROOTS.some(r => {
    try { const rr = realpathSync(r); return absReal === rr || absReal.startsWith(rr + sep); } catch { return false; }
  });
  if (!underAllowedRoot) throw projErr('BadRequestError', 'Candidate escaped the scan roots since discovery.');
  if (!existsSync(join(absReal, '.git'))) throw projErr('BadRequestError', 'Candidate is not a git repository.');

  // Registry writes hold the same server-owned lock as the ledger (keyed by
  // the canonical registry dir), and re-read INSIDE the lock (CAS) so two
  // concurrent registrations can't lose each other's entries. A torn
  // registry write fails CLOSED on the next strict loadRegistry (503), never
  // a silent partial — so it does not need the ledger's journal.
  const registryDirReal = realpathSync(dirname(REGISTRY_PATH));
  const regKey = stateKeyFor('registry:' + join(registryDirReal, REGISTRY_PATH.split(sep).pop()!));
  const lock = acquireLedgerLock(regKey);
  try {
    const registry = loadRegistry(); // strict: malformed registry blocks creation
    for (const cfg of Object.values(registry)) {
      try { if (realpathSync(cfg.root) === absReal) throw projErr('BadRequestError', 'That repository is already registered.'); } catch (e) { if ((e as Error).name === 'BadRequestError') throw e; }
    }
    const dirName = issued.dirName;
    const id = requestedId ? requestedId.trim().toLowerCase() : slugify(dirName);
    if (!ID_RE.test(id)) throw projErr('BadRequestError', `Project id must match ${ID_RE}.`);
    if (registry[id]) throw projErr('BadRequestError', `Project id "${id}" is already taken.`);
    const name = (requestedName || dirName).trim().slice(0, 80) || dirName;

    const docs: Record<string, string> = { tasks: 'docs/TASKS.md' };
    if (existsSync(join(absReal, 'README.md'))) docs.brief = 'README.md';
    if (existsSync(join(absReal, 'FEATURES.md'))) docs.features = 'FEATURES.md';

    // fd-anchored registry write, same no-follow discipline as the ledger.
    const regFd = openNoFollow(REGISTRY_PATH, fsConstants.O_CREAT | fsConstants.O_RDWR, 0o600, registryDirReal);
    try {
      const rawText = readFdText(regFd);
      const rawObj: Record<string, unknown> = rawText.trim() ? JSON.parse(rawText) as Record<string, unknown> : {};
      rawObj[id] = { name, root: absReal, docs };
      writeFdTextRaw(regFd, JSON.stringify(rawObj, null, 2) + '\n');
    } finally {
      closeSync(regFd);
    }
    issuedCandidates.delete(key);
    console.log(`[project] registered "${id}" -> ${absReal}`);
    return { id, name, docs: Object.keys(docs) };
  } finally {
    releaseLedgerLock(lock);
  }
}

function projErr(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}
