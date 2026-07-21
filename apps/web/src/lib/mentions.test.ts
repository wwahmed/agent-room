import { describe, expect, it } from 'vitest';
import { MENTION_SOURCE, isSelfMention } from './mentions.js';

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
