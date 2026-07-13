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

import { readFileSync, existsSync, realpathSync, statSync, unlinkSync, readdirSync, openSync, closeSync, readSync, fstatSync, ftruncateSync, writeSync, fsyncSync, constants as fsConstants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const LOCK_STALE_MS = 30_000;

// ---------- no-follow filesystem primitives (Codex T-18 round 4) ----------
//
// The round-4 finding: creating the lock/tmp and renaming through a
// LEXICAL path lets a parent-symlink swap between operations land
// artifacts outside the project root — an fs.watch probe caught
// transient outside events. Node has no openat/renameat, so the fix is
// Darwin's O_NOFOLLOW_ANY: the kernel refuses to traverse a symlink in
// ANY path component of the open. Every write below goes through a file
// descriptor obtained with that flag — once the fd is open, later path
// swaps are irrelevant because writes address the fd, not the path.
// There is deliberately NO tmp+rename anymore: rename is inherently
// lexical and unfixable without renameat. Losing rename atomicity is
// covered by (a) the advisory lock serializing writers and (b) the
// embedded section hash turning any torn write into a detected
// conflict that `force` repairs.
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
function writeFdText(fd: number, text: string): void {
  ftruncateSync(fd, 0);
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    off += writeSync(fd, buf, off, buf.length - off, off);
  }
  fsyncSync(fd);
}

/**
 * Advisory per-ledger lock: `<file>.lock` created with wx (fails if it
 * exists). Contents = pid + timestamp; a lock older than LOCK_STALE_MS
 * is taken over with a warning (crashed writer). The server itself is a
 * single synchronous writer, so this guards external tooling and any
 * future second process, not the event loop.
 */
function acquireFileLock(target: string, mustBeUnder?: string): string {
  const lockPath = `${target}.lock`;
  const payload = JSON.stringify({ pid: process.pid, at: Date.now() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // wx + no-follow-any: cannot land through a swapped parent.
      const fd = openNoFollow(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600, mustBeUnder);
      let realLock: string;
      try {
        writeFdText(fd, payload);
        // Capture the REAL path now, while it provably points inside; the
        // finally-unlink uses this so a later parent swap can't redirect
        // the deletion at an attacker-chosen file.
        realLock = realpathSync(lockPath);
      } catch (e) {
        closeSync(fd);
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          // Our fresh lock vanished: another writer misjudged and stole it.
          throw projErr('LedgerConflictError', 'Lost a lock takeover race; retry shortly.');
        }
        throw e;
      }
      closeSync(fd);
      return realLock;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // Staleness judged by the FILE's mtime, not its content — the
      // create(wx) and payload write are two steps, so a reader can see
      // an empty-but-fresh lock and must NOT treat it as crashed.
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
      } catch {
        continue; // vanished between EEXIST and stat: holder released; retry create
      }
      if (!stale) {
        throw projErr('LedgerConflictError', 'Another writer holds the ledger lock; retry shortly.');
      }
      console.warn(`[project] taking over stale ledger lock ${lockPath}`);
      try { unlinkSync(lockPath); } catch { /* raced with the owner's cleanup */ }
    }
  }
  throw projErr('LedgerConflictError', 'Could not acquire the ledger lock.');
}

/**
 * Write the board into the project's task ledger. Conflict detection is
 * FILE-derived (sectionIntegrity): a hand edit inside the markers, or a
 * pre-hash "legacy" section, refuses the write unless `force` — no
 * external state, so it survives Redis loss and room expiry. The whole
 * read → integrity check → write sequence runs synchronously INSIDE an
 * advisory lock; the tmp file is wx-created 0600 and cleaned up on any
 * failure.
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
  const lockPath = acquireFileLock(abs, rootRealForIo);
  // Open the ledger ITSELF with no-follow-any before reading: from here
  // on every byte moves through this fd, so the read → integrity check →
  // write sequence cannot be redirected by any path/parent swap.
  let ledgerFd: number | null = null;
  try {
    let before = `# Task ledger — ${cfg.name}\n\nDurable record of WakiChat room task boards for this project. The\nfenced section below is machine-managed; write anything you like\noutside it.\n\n`;
    let after = '\n';
    ledgerFd = openNoFollow(abs, fsConstants.O_CREAT | fsConstants.O_RDWR, 0o644, rootRealForIo);
    const current = readFdText(ledgerFd);
    if (current.length > 0) {
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
      } else {
        // File exists but has no managed section yet: append one, keep
        // every existing byte.
        before = current.endsWith('\n') ? current + '\n' : current + '\n\n';
        after = '\n';
      }
    }

    const next = before + section + after;
    // Belt-and-suspenders containment check (load-bearing on non-Darwin
    // where O_NOFOLLOW_ANY degrades): the fd we already hold must live
    // inside the project root.
    const realNow = realpathSync(abs);
    const rootReal = realpathSync(cfg.root);
    if (realNow !== rootReal && !realNow.startsWith(rootReal + sep)) {
      throw projErr('BadRequestError', 'Ledger path escaped the project root between check and write.');
    }
    // fd-anchored write: truncate + write + fsync through the descriptor
    // opened above. No tmp file, no rename, no lexical-path window. A
    // crash mid-write leaves a torn section, which the embedded hash
    // classifies as a conflict on the next sync — repaired with force.
    writeFdText(ledgerFd, next);
    return { rel, bytes: Buffer.byteLength(next), changed: true, hash: sectionHash(section) };
  } finally {
    if (ledgerFd !== null) { try { closeSync(ledgerFd); } catch { /* closed */ } }
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

/** Read the embedded machine state back out of the ledger (board resume). */
export function loadLedgerBoard(projectId: string): { roomCode: string; syncedAt: number; board: LedgerBoardShape } | null {
  const { abs } = resolveDocPath(projectId, 'tasks');
  if (!existsSync(abs)) return null;
  const slice = managedSlice(readFileSync(abs, 'utf8'));
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

  // Round-3 item 4: registry writes hold the same advisory lock as the
  // ledger, and the raw file is re-read INSIDE the lock (CAS), so two
  // concurrent registrations can't lose each other's entries.
  const registryDirReal = realpathSync(dirname(REGISTRY_PATH));
  const lockPath = acquireFileLock(REGISTRY_PATH, registryDirReal);
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
      writeFdText(regFd, JSON.stringify(rawObj, null, 2) + '\n');
    } finally {
      closeSync(regFd);
    }
    issuedCandidates.delete(key);
    console.log(`[project] registered "${id}" -> ${absReal}`);
    return { id, name, docs: Object.keys(docs) };
  } finally {
    try { unlinkSync(lockPath); } catch { /* gone */ }
  }
}

function projErr(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}
