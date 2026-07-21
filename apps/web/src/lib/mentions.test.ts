import { describe, expect, it } from 'vitest';
import { MENTION_SOURCE, filterMentionCandidates, insertMention, isSelfMention, mentionQueryAt, mentionToken } from './mentions.js';

describe('MENTION_SOURCE', () => {
  const re = () => new RegExp(MENTION_SOURCE, 'g');

  it('matches simple names', () => {
    expect('ping @Waqas please'.match(re())).toEqual(['@Waqas']);
  });

  it('matches multiple mentions and hyphen/underscore names', () => {
    expect('@code-x and @wa_2 review'.match(re())).toEqual(['@code-x', '@wa_2']);
  });

  it('does not match a bare @ or emails beyond the name rule', () => {
    expect('a @ b'.match(re())).toBeNull();
  });
});

describe('isSelfMention', () => {
  it('matches the exact name case-insensitively', () => {
    expect(isSelfMention('@waqas', 'Waqas')).toBe(true);
  });

  it('matches the first word of a suffixed display name', () => {
    expect(isSelfMention('@Claude', 'Claude (2)')).toBe(true);
    expect(isSelfMention('@ClaudeUI', 'ClaudeUI (3)')).toBe(true);
  });

  it('rejects other names and prefix look-alikes', () => {
    expect(isSelfMention('@Claude', 'ClaudeUI')).toBe(false);
    expect(isSelfMention('@Codex', 'Claude')).toBe(false);
  });

  it('handles missing self name', () => {
    expect(isSelfMention('@Waqas', undefined)).toBe(false);
    expect(isSelfMention('@Waqas', '')).toBe(false);
  });
});

// T-09: composer autocomplete helpers.
describe('mentionToken', () => {
  it('takes the first word and strips suffixes', () => {
    expect(mentionToken('ClaudeUI (2)')).toBe('ClaudeUI');
    expect(mentionToken('Waqas')).toBe('Waqas');
  });
});

describe('mentionQueryAt', () => {
  it('detects a bare @ at the caret', () => {
    expect(mentionQueryAt('hello @', 7)).toEqual({ start: 6, query: '' });
  });

  it('detects a partial query', () => {
    expect(mentionQueryAt('ping @Wa', 8)).toEqual({ start: 5, query: 'Wa' });
  });

  it('requires the @ to start a word', () => {
    expect(mentionQueryAt('user@host', 9)).toBeNull();
  });

  it('is inactive once the mention is completed with a space', () => {
    expect(mentionQueryAt('ping @Waqas ', 12)).toBeNull();
  });

  it('only considers text before the caret', () => {
    expect(mentionQueryAt('@Wa later text', 3)).toEqual({ start: 0, query: 'Wa' });
  });
});

describe('filterMentionCandidates', () => {
  const names = ['Waqas', 'Codex', 'Claude', 'ClaudeUI'];

  it('returns everyone for an empty query', () => {
    expect(filterMentionCandidates(names, '')).toEqual(names);
  });

  it('ranks prefix matches before infix matches, case-insensitively', () => {
    expect(filterMentionCandidates(names, 'cla')).toEqual(['Claude', 'ClaudeUI']);
    expect(filterMentionCandidates(names, 'de')).toEqual(['Codex', 'Claude', 'ClaudeUI']);
  });

  it('dedupes case-insensitively', () => {
    expect(filterMentionCandidates(['Waqas', 'waqas'], '')).toEqual(['Waqas']);
  });
});

describe('insertMention', () => {
  it('replaces the query with the token and a trailing space', () => {
    const out = insertMention('ping @Wa now', 8, 5, 'Waqas');
    expect(out.text).toBe('ping @Waqas  now');
    expect(out.caret).toBe(12);
  });

  it('uses the single-word token for suffixed names', () => {
    const out = insertMention('@Cla', 4, 0, 'ClaudeUI (2)');
    expect(out.text).toBe('@ClaudeUI ');
    expect(out.caret).toBe(10);
  });
});
