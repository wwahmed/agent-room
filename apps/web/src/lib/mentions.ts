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
