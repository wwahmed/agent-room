import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getProject, roomDataDir } from './projects.js';

// T-23: promote a pinned outcome into the room's DURABLE decision log —
// "transient conversation, durable outcomes" made real. Entries are
// append-only markdown in the room's data root (and, when a project is
// attached, mirrored into the repo's docs/DECISIONS.md), each carrying an
// idempotence marker so re-promoting the same message is a no-op, never a
// duplicate.

export interface DecisionEntry {
  /** id of the promoted message — the idempotence key. */
  messageId: number;
  /** Original author of the promoted message. */
  author: string;
  /** Full message text (or the pin snippet when history trimmed it). */
  text: string;
  /** Who promoted it. */
  promotedBy: string;
  /** Epoch ms of the promotion. */
  at: number;
}

const marker = (messageId: number) => `<!-- decision:${messageId} -->`;

export function decisionMarkdown(roomCode: string, e: DecisionEntry): string {
  const when = new Date(e.at).toISOString();
  return [
    '',
    `## ${when} — ${e.author}`,
    marker(e.messageId),
    '',
    `_Promoted by ${e.promotedBy} from room ${roomCode.toLowerCase()}._`,
    '',
    e.text.trim(),
    '',
  ].join('\n');
}

function header(roomCode: string): string {
  return [
    `# Decision log — room ${roomCode.toLowerCase()}`,
    '',
    'Outcomes promoted from the room\'s pinned strip. Append-only; each entry',
    'carries a `decision:<messageId>` marker that makes promotion idempotent.',
    '',
  ].join('\n');
}

export interface AppendOutcome {
  file: string;
  /** true when this message id was already in the log — nothing written. */
  already: boolean;
}

/** Core append against an explicit file path (testable without env games). */
export function appendDecisionAt(abs: string, roomCode: string, e: DecisionEntry): AppendOutcome {
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (existing !== null && existing.includes(marker(e.messageId))) {
    return { file: abs, already: true };
  }
  mkdirSync(dirname(abs), { recursive: true });
  const base = existing ?? header(roomCode);
  writeFileSync(abs, base + decisionMarkdown(roomCode, e), 'utf8');
  return { file: abs, already: false };
}

export interface PromoteResult {
  file: string;
  already: boolean;
  /** Repo overlay path when a project is attached and the write succeeded. */
  overlay?: string;
}

/** Promote into the room's data root; mirror into the attached project's
 *  repo (docs/DECISIONS.md) best-effort — an unwritable repo must never
 *  fail the durable room-side write that already happened. */
export function promoteDecision(roomCode: string, e: DecisionEntry, projectId?: string): PromoteResult {
  const roomFile = join(roomDataDir(roomCode), 'DECISIONS.md');
  const primary = appendDecisionAt(roomFile, roomCode, e);
  let overlay: string | undefined;
  if (projectId) {
    try {
      const cfg = getProject(projectId);
      if (cfg) {
        const out = appendDecisionAt(join(cfg.root, 'docs', 'DECISIONS.md'), roomCode, e);
        overlay = out.file;
      }
    } catch { /* overlay is best-effort */ }
  }
  return { ...primary, ...(overlay ? { overlay } : {}) };
}
