import { describe, it, expect, beforeEach } from 'vitest';
import { RELEASE_NOTES, LATEST_RELEASE_DATE, hasUnseenReleaseNotes, markReleaseNotesSeen, formatReleaseDate } from './releaseNotes.js';

describe('release notes', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* noop */ } });

  it('has newest-first, non-empty, jargon-free entries', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    for (const n of RELEASE_NOTES) {
      expect(n.items.length).toBeGreaterThan(0);
      expect(n.title.length).toBeGreaterThan(0);
      for (const item of n.items) {
        expect(item).not.toMatch(/\bT-\d+\b/); // no task-id jargon in owner-facing notes
        expect(item).not.toMatch(/\b[0-9a-f]{7,40}\b/); // no commit hashes
      }
    }
    // newest first
    const dates = RELEASE_NOTES.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(LATEST_RELEASE_DATE).toBe(dates[0]);
  });

  it('tracks seen/unseen across the latest release', () => {
    expect(hasUnseenReleaseNotes()).toBe(true); // nothing seen yet
    markReleaseNotesSeen();
    expect(hasUnseenReleaseNotes()).toBe(false);
  });

  it('formats an ISO date as a short human label', () => {
    expect(formatReleaseDate('2026-07-23')).toBe('Jul 23, 2026');
    expect(formatReleaseDate('bad')).toBe('bad');
  });
});
