import { describe, expect, it } from 'vitest';
import {
  matchScore,
  searchMessages,
  searchRooms,
  searchTasks,
  snippetAround,
  SEARCH_MESSAGE_HITS,
  SEARCH_MESSAGE_WINDOW,
} from './search.js';

describe('matchScore', () => {
  it('ranks exact > prefix > word-prefix > substring > none', () => {
    expect(matchScore('facepile', 'facepile')).toBe(100);
    expect(matchScore('facepile spec', 'face')).toBe(80);
    expect(matchScore('the facepile spec', 'face')).toBe(60);
    expect(matchScore('interface', 'face')).toBe(40);
    expect(matchScore('nothing here', 'face')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(matchScore('Build: WakiChat', 'wakichat')).toBeGreaterThan(0);
  });
});

describe('snippetAround', () => {
  it('centers on the match and bounds length', () => {
    const long = `${'a '.repeat(100)}NEEDLE${' b'.repeat(100)}`;
    const s = snippetAround(long, 'needle');
    expect(s).toContain('NEEDLE');
    expect(s.length).toBeLessThanOrEqual(94); // span + ellipses
    expect(s.startsWith('…')).toBe(true);
  });
});

describe('searchRooms', () => {
  it('matches topics, ranks, and bounds to five', () => {
    const rooms = Array.from({ length: 10 }, (_, i) => ({ code: `c-${i}`, topic: `probe room ${i}`, lastActivityAt: i }));
    const hits = searchRooms(rooms, 'probe');
    expect(hits).toHaveLength(5);
    // Recency breaks the tie: newest activity first.
    expect(hits[0]!.roomCode).toBe('c-9');
    expect(hits[0]!.type).toBe('room');
  });
});

describe('searchMessages', () => {
  const msg = (id: number, text: string, time = id) => ({ id, name: 'Codex', text, time, type: 'msg' });

  it('matches text and sender, bounds hits, skips system rows', () => {
    const messages = [
      ...Array.from({ length: 30 }, (_, i) => msg(i, `facepile note ${i}`)),
      { id: 99, name: 'system', text: 'facepile sys', time: 99, type: 'sys' },
    ];
    const hits = searchMessages(messages, 'facepile', 'abc');
    expect(hits).toHaveLength(SEARCH_MESSAGE_HITS);
    expect(hits.every(h => h.messageId !== 99)).toBe(true);
    expect(hits[0]!.snippet).toContain('facepile');
  });

  it('prefers newer messages via the recency bonus', () => {
    const old = msg(1, 'facepile old', 1_000);
    const fresh = msg(2, 'facepile new', 1_000 + 48 * 60 * 60 * 1000);
    const hits = searchMessages([old, fresh], 'facepile', 'abc');
    expect(hits[0]!.messageId).toBe(2);
  });

  it('searches only the bounded newest window', () => {
    const messages = Array.from({ length: SEARCH_MESSAGE_WINDOW + 50 }, (_, i) => msg(i, i < 50 ? 'needle early' : `filler ${i}`));
    const hits = searchMessages(messages, 'needle', 'abc');
    expect(hits).toHaveLength(0); // the matches fell outside the window
  });
});

describe('searchTasks', () => {
  it('matches title or id and deep-links by taskId', () => {
    const tasks = [
      { id: 'T-59', title: 'Server search API' },
      { id: 'T-58', title: 'Command bar' },
      { id: 'T-01', title: 'Unrelated' },
    ];
    expect(searchTasks(tasks, 'search', 'abc')[0]!.taskId).toBe('T-59');
    expect(searchTasks(tasks, 't-58', 'abc')[0]!.taskId).toBe('T-58');
    expect(searchTasks(tasks, 'zzz', 'abc')).toHaveLength(0);
  });
});

describe('stripMarkdown in snippets', () => {
  it('renders plain prose, never source (UX polish on T-58 review)', () => {
    const s = snippetAround('**The v2 treatment:** the `facepile` takes [the slot](url).', 'facepile');
    expect(s).toContain('The v2 treatment: the facepile takes the slot.');
    expect(s).not.toMatch(/[*`[\]]/);
  });
});
