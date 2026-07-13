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
//   - Writes are atomic (tmp + rename in the same directory) and touch
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

import { readFileSync, existsSync, renameSync, writeFileSync, realpathSync, statSync } from 'node:fs';
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

export function loadRegistry(): Record<string, ProjectConfig> {
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ProjectConfig>;
    const out: Record<string, ProjectConfig> = {};
    for (const [id, cfg] of Object.entries(parsed)) {
      if (!cfg || typeof cfg.root !== 'string' || typeof cfg.name !== 'string') continue;
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) continue; // ids are slugs, never paths
      out[id] = { name: cfg.name, root: cfg.root, docs: cfg.docs && typeof cfg.docs === 'object' ? cfg.docs : {} };
    }
    return out;
  } catch {
    return {};
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
 * markers), 'legacy' when no hash line exists (pre-hash section — treat
 * as clean once, the next write adds the line).
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

/**
 * Write the board into the project's task ledger. Conflict detection is
 * FILE-derived (sectionIntegrity): a hand edit inside the markers makes
 * the embedded hash mismatch and the write is refused unless `force` —
 * no external state, so it survives Redis loss and room expiry.
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

  let before = `# Task ledger — ${cfg.name}\n\nDurable record of WakiChat room task boards for this project. The\nfenced section below is machine-managed; write anything you like\noutside it.\n\n`;
  let after = '\n';
  if (existsSync(abs)) {
    const current = readFileSync(abs, 'utf8');
    const slice = managedSlice(current);
    if (slice) {
      const integrity = sectionIntegrity(slice.section);
      if (integrity === 'tampered' && !force) {
        return { rel, bytes: 0, changed: false, hash: sectionHash(slice.section), conflict: 'managed section was modified outside WakiChat since the last sync; review the file and re-sync with force' };
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
  // TOCTOU guard: re-verify containment of the (possibly re-created or
  // symlink-swapped) parent directory immediately before writing the tmp
  // file and renaming. Node's fs API can't hold a directory handle, so a
  // microscopic window remains; this closes the practical swap race.
  const parentReal = realpathSync(dirname(abs));
  const rootReal = realpathSync(cfg.root);
  if (parentReal !== rootReal && !parentReal.startsWith(rootReal + sep)) {
    throw projErr('BadRequestError', 'Ledger parent directory escaped the project root between check and write.');
  }
  const tmp = join(parentReal, `.tasks-sync-${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, next, 'utf8');
  renameSync(tmp, abs); // atomic on the same filesystem
  return { rel, bytes: Buffer.byteLength(next), changed: true, hash: sectionHash(section) };
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

function projErr(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}
