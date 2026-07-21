// T-12: @mention parsing shared by the message renderer (and later the
// composer autocomplete, T-09). Kept pure so the matching rules are testable
// without React.

// A mention is `@` followed by a name word: letters/digits, then letters/
// digits/underscore/hyphen. Display names with spaces ("ClaudeUI (2)") are
// matched by their first word — that is what people actually type.
export const MENTION_SOURCE = '@[A-Za-z0-9][A-Za-z0-9_-]*';

/**
 * Does this mention token target the signed-in user?
 * Token is the raw match including the `@`. Matching is case-insensitive and
 * accepts either the full display name (when it is a single word) or the
 * first word of a multi-word / suffixed display name, so "@Claude" reaches
 * "Claude", "claude", and "Claude (2)".
 */
export function isSelfMention(token: string, selfName: string | undefined | null): boolean {
  if (!selfName) return false;
  const target = token.replace(/^@/, '').toLowerCase();
  if (!target) return false;
  const self = selfName.trim().toLowerCase();
  if (self === target) return true;
  const firstWord = self.split(/[\s(]+/, 1)[0];
  return firstWord === target;
}

// ---------- T-09: composer autocomplete ----------

/** The single-word token the mention grammar inserts for a display name:
 *  "ClaudeUI (2)" -> "ClaudeUI". */
export function mentionToken(displayName: string): string {
  return (displayName.trim().split(/[\s(]+/, 1)[0] ?? '').replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Is the caret inside an active mention query? Looks backward from the caret:
 * an `@` at the start of a word with only name characters between it and the
 * caret. Returns the index of the `@` and the typed query (may be empty,
 * i.e. the user just typed `@`).
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const match = /(^|[\s(])@([A-Za-z0-9_-]*)$/.exec(upto);
  if (!match) return null;
  const start = caret - (match[2]?.length ?? 0) - 1;
  return { start, query: match[2] ?? '' };
}

/** Participants whose display name matches the typed query (prefix first). */
export function filterMentionCandidates(names: string[], query: string): string[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const unique = names.filter(n => {
    const k = n.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!q) return unique;
  const prefix = unique.filter(n => n.toLowerCase().startsWith(q));
  const infix = unique.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...prefix, ...infix];
}

/** Replace the active query with the chosen mention plus a trailing space. */
export function insertMention(
  text: string,
  caret: number,
  start: number,
  displayName: string,
): { text: string; caret: number } {
  const token = `@${mentionToken(displayName)} `;
  const next = text.slice(0, start) + token + text.slice(caret);
  return { text: next, caret: start + token.length };
}
