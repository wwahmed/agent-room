import { CODE_CHARS, CODE_SEGMENT_LEN, CODE_SEGMENTS } from './constants.js';
import { CODE_WORDS_FOUR, CODE_WORDS_THREE } from './codeWords.js';

// T-47: room codes come in two formats that coexist forever:
//
//   legacy — 3×3 of an unambiguous alphanumeric alphabet, e.g. "D64-2UJ-FNR".
//            Every room created before word codes uses this. Canonical form is
//            UPPERCASE-dashed, because existing rooms are stored under that key
//            — validation/lookup MUST NOT lowercase them or they stop resolving.
//
//   words  — human-speakable FOUR-THREE-FOUR, e.g. "door-cat-hall". New codes.
//            Canonical form is lowercase-dashed.
//
// The two shapes never collide (3-char vs 4/3/4-char segments), so a code
// parses to exactly one format. `parseCode` is the single source of truth;
// everything else (isValidCode, canonicalizeCode) is derived from it.

// ---------------------------------------------------------------- legacy

function randomChar(): string {
  const idx = Math.floor(Math.random() * CODE_CHARS.length);
  return CODE_CHARS[idx]!;
}

function legacySegment(): string {
  let out = '';
  for (let i = 0; i < CODE_SEGMENT_LEN; i++) out += randomChar();
  return out;
}

/**
 * Legacy generator, retained for backward-compat and tests. New rooms use
 * {@link generateRoomCode}. Produces an UPPERCASE 3×3 code.
 */
export function generateCode(): string {
  const parts: string[] = [];
  for (let i = 0; i < CODE_SEGMENTS; i++) parts.push(legacySegment());
  return parts.join('-');
}

const LEGACY_RE = new RegExp(
  `^[${CODE_CHARS}]{${CODE_SEGMENT_LEN}}(-[${CODE_CHARS}]{${CODE_SEGMENT_LEN}}){${CODE_SEGMENTS - 1}}$`,
);

// ---------------------------------------------------------------- words

const WORD_RE = /^[a-z]{4}-[a-z]{3}-[a-z]{4}$/;

// Combo-level guard: the individual words are curated clean, but adjacent words
// (or the de-dashed run) can still read badly. Reject any code whose letters —
// with separators removed — contain one of these. Deliberately small and
// clinical; expand as needed. Generation retries on a hit, so a blocked combo
// is simply never issued.
const BAD_SUBSTRINGS: readonly string[] = [
  'anal', 'anus', 'arse', 'butt', 'clit', 'cock', 'coon', 'crap', 'cum',
  'damn', 'dick', 'dyke', 'fag', 'fuck', 'gook', 'jism', 'jizz', 'kike',
  'kkk', 'nazi', 'nigg', 'paki', 'penis', 'piss', 'poop', 'porn', 'pube',
  'puss', 'rape', 'scum', 'sex', 'shit', 'slut', 'spic', 'tit', 'turd',
  'twat', 'vag', 'wank', 'whore',
];

function isEmbarrassingCombo(words: readonly string[]): boolean {
  const run = words.join('');
  return BAD_SUBSTRINGS.some((bad) => run.includes(bad));
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export interface GenerateRoomCodeOptions {
  /** Return true if the given canonical code is already in use; the generator
   *  retries until this returns false (or attempts are exhausted). */
  isTaken?: (canonical: string) => boolean;
  /** Max attempts before giving up (collision or combo filter). Default 50. */
  maxAttempts?: number;
}

/**
 * Generate a fresh human-friendly word code (canonical lowercase-dashed
 * FOUR-THREE-FOUR, e.g. "door-cat-hall"), skipping embarrassing combos and any
 * code the caller reports as taken. Throws if it cannot find a free code within
 * `maxAttempts` — the caller should surface that as an allocation failure.
 */
export function generateRoomCode(opts: GenerateRoomCodeOptions = {}): string {
  const maxAttempts = opts.maxAttempts ?? 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const words = [pick(CODE_WORDS_FOUR), pick(CODE_WORDS_THREE), pick(CODE_WORDS_FOUR)];
    if (isEmbarrassingCombo(words)) continue;
    const canonical = words.join('-');
    if (opts.isTaken && opts.isTaken(canonical)) continue;
    return canonical;
  }
  throw new Error('generateRoomCode: could not allocate a free code');
}

// ---------------------------------------------------------------- parse / validate

export type CodeFormat = 'words' | 'legacy';

export interface ParsedCode {
  /** The form used for storage + routing. Legacy → UPPER-dashed; words →
   *  lower-dashed. Feed THIS to room lookups. */
  canonical: string;
  format: CodeFormat;
}

/**
 * Parse a user-entered code in EITHER format into its canonical routing form,
 * or null if it is structurally invalid. Case-insensitive and separator-
 * tolerant on input; the canonical case is format-aware (see file header).
 */
export function parseCode(input: string): ParsedCode | null {
  if (typeof input !== 'string') return null;
  // Normalize separators: trim, collapse spaces/underscores to dashes, squeeze
  // repeats. Does not touch case — format detection sets that.
  const s = input.trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
  if (!s) return null;

  const lower = s.toLowerCase();
  if (WORD_RE.test(lower)) return { canonical: lower, format: 'words' };

  const upper = s.toUpperCase();
  if (LEGACY_RE.test(upper)) return { canonical: upper, format: 'legacy' };

  return null;
}

/** True if `input` is a structurally valid code in either format. */
export function isValidCode(input: string): boolean {
  return parseCode(input) !== null;
}

/** Canonical routing form for a code, or null if invalid. Thin wrapper over
 *  {@link parseCode} for callers (e.g. the web CodeInput) that only need the
 *  string to route on. */
export function canonicalizeCode(input: string): string | null {
  return parseCode(input)?.canonical ?? null;
}
